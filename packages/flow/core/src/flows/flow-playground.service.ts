import { BadRequestException, HttpException, Injectable, NotFoundException } from '@dangao/bun-server'
import { SnowflakeUtil } from '@cube-ai/server-base'
import type { LlmProviderPort } from '@cube-ai/contracts'
import { NoopLlmProvider } from '@cube-ai/llm-core'
import { createSseResponse } from '../http/sse-response'
import { teeCubeSseWithPersistence } from './cube-sse-tap'
import { prependWorkflowStart, transformStreamEnrichUsage } from './cube-sse-enrich'
import { createCubeLinearEngineSseStream, runCubeLinearEngineSync, type CubeEngineContext } from '../engine/cube-linear-engine'
import { FlowCrudService } from './flow-crud.service'
import { FlowLangflowSyncService } from './flow-langflow-sync.service'
import type { NormalizedRunBody } from '../contracts/cube-run'

function envTruthy(name: string): boolean {
  const v = process.env[name]
  if (!v) return false
  const s = v.trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

function shouldFallbackCubeEngine(err: unknown): boolean {
  if (!envTruthy('CUBE_AI_CUBE_ENGINE_FALLBACK')) return false
  if (!(err instanceof HttpException) || err.status !== 503) return false
  const d = err.details as { code?: string } | undefined
  return d?.code === 'EXECUTION_UNAVAILABLE'
}

function mergeRequestExtFromNorm(norm: NormalizedRunBody): Record<string, unknown> | undefined {
  if (!norm.ext || typeof norm.ext !== 'object') return undefined
  return Object.keys(norm.ext).length > 0 ? norm.ext : undefined
}

/** 与平台助手 `defaultAssistantSessionTitle` 对齐：未显式命名时使用「新对话 + 时间」。 */
function defaultPlaygroundSessionTitle(createdAtIso: string): string {
  const d = new Date(createdAtIso)
  if (Number.isNaN(d.getTime())) {
    return '新对话'
  }
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `新对话 ${m}/${day} ${hh}:${mm}`
}

/**
 * Playground 对话服务：会话 CRUD 与消息收发（含 SSE tee 持久化）。
 */
@Injectable()
export class FlowPlaygroundService {
  private readonly llm: LlmProviderPort

  constructor(
    private readonly crud: FlowCrudService,
    private readonly lfSync: FlowLangflowSyncService,
    llm?: LlmProviderPort,
  ) {
    this.llm = llm ?? new NoopLlmProvider()
  }

  private cubeEngineContext(): CubeEngineContext {
    return { llm: this.llm, tenant: 0 }
  }

  async listPlaygroundSessions(flowId: string) {
    const id = await this.crud.resolveFlowId(flowId)
    const row = await this.crud.repo.getFlow(id, this.crud.requireProjectId())
    if (!row) throw new NotFoundException(`Flow ${id} not found`)
    await this.crud.repo.ensurePlaygroundDefaultSession(id)
    return (await this.crud.repo.listPlaygroundSessions(id)).map((r) => ({
      id: r.id,
      title: r.title,
      isDefault: r.is_default === 1,
      update_time: r.update_time,
    }))
  }

  async listPlaygroundSessionsPaged(flowId: string, pageNumber = 1, pageSize = 20) {
    const items = await this.listPlaygroundSessions(flowId)
    const safePageNumber = Number.isFinite(pageNumber) && pageNumber > 0 ? Math.floor(pageNumber) : 1
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 200) : 20
    const total = items.length
    const start = (safePageNumber - 1) * safePageSize
    return {
      items: items.slice(start, start + safePageSize),
      total,
      pageNumber: safePageNumber,
      pageSize: safePageSize,
      pages: Math.ceil(total / safePageSize),
    }
  }

  async createPlaygroundSessionRow(
    flowId: string,
    body: { title?: string | null; asDefault?: boolean },
  ): Promise<{ id: string }> {
    const fid = await this.crud.resolveFlowId(flowId)
    const row = await this.crud.repo.getFlow(fid, this.crud.requireProjectId())
    if (!row) throw new NotFoundException(`Flow ${fid} not found`)
    const asDefault = body.asDefault === true
    const explicit = typeof body.title === 'string' ? body.title.trim() : ''
    const title = explicit || defaultPlaygroundSessionTitle(new Date().toISOString())
    const id = await this.crud.repo.createPlaygroundSession(fid, {
      title,
      asDefault,
    })
    return { id }
  }

  async deletePlaygroundSession(flowId: string, sessionId: string) {
    const fid = await this.crud.resolveFlowId(flowId)
    const sess = await this.crud.repo.getPlaygroundSession(fid, sessionId)
    if (!sess) throw new NotFoundException(`Session ${sessionId} not found`)
    /** Langflow `session_id` 与 `playground_sessions.id` 一致。 */
    const cubeSid = sessionId.trim()
    const remoteIds = new Set<string>()
    if (cubeSid) remoteIds.add(sess.id)
    for (const rid of remoteIds) {
      await this.lfSync.deleteLangflowChatSession(rid)
    }
    await this.crud.repo.deletePlaygroundSession(fid, sessionId)
    const list = await this.crud.repo.listPlaygroundSessions(fid)
    if (list.length === 0) {
      await this.crud.repo.ensurePlaygroundDefaultSession(fid)
    } else if (!list.some((item) => item.is_default === 1)) {
      const latest = list[0]
      if (latest) {
        await this.crud.repo.updatePlaygroundSession(fid, latest.id, {
          is_default: 1,
          update_time: new Date().toISOString(),
        })
      }
    }
    return { deleted: true as const }
  }

  async getPlaygroundSessionMessages(flowId: string, sessionId: string) {
    const fid = await this.crud.resolveFlowId(flowId)
    const sess = await this.crud.repo.getPlaygroundSession(fid, sessionId)
    if (!sess) throw new NotFoundException(`Session ${sessionId} not found`)
    return (await this.crud.repo.listPlaygroundMessages(sessionId)).map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'bot',
      content: m.content,
      create_time: m.create_time,
    }))
  }

  async playgroundMessages(
    ref: string,
    body: unknown,
  ): Promise<Response | { status: 'ok'; raw: unknown }> {
    const norm = this.crud.toNormalized(body)
    const id = await this.crud.resolveFlowId(ref)
    await this.crud.assertDeveloperApiFlowScope(id)
    const flowRow = await this.crud.repo.getFlow(id, this.crud.requireProjectId())
    if (!flowRow) throw new NotFoundException(`Flow ${id} not found`)

    const sessionId = norm.sessionId?.trim()
    if (!sessionId) {
      throw new BadRequestException('sessionId is required')
    }
    const sess = await this.crud.repo.getPlaygroundSession(id, sessionId)
    if (!sess) {
      throw new NotFoundException(`Playground session ${sessionId} not found for this flow`)
    }

    const stream = norm.stream !== false

    await this.crud.repo.appendPlaygroundMessage(sessionId, 'user', norm.input ?? '')

    if (stream && envTruthy('EXP_USE_CUBE_FLOW_ENGINE')) {
      const graph = await this.crud.loadGraphOrThrow(id)
      const inner = createCubeLinearEngineSseStream(graph, norm, id, this.cubeEngineContext(), mergeRequestExtFromNorm(norm))
      const wrapped = this.lfSync.wrapLinearCubeSse(inner, norm, id)
      const out = teeCubeSseWithPersistence(wrapped, async (text) => {
        await this.crud.repo.appendPlaygroundMessage(sessionId, 'bot', text || '')
      })
      return createSseResponse(out)
    }

    if (stream) {
      try {
        const { lf, langflowFlowId } = await this.lfSync.prepareCubeFlowForExecution(id)
        const taskId = SnowflakeUtil.nextId()
        const startMs = Date.now()
        const traceId = norm.user_context.trace_id?.trim() || taskId
        const mergeExt = mergeRequestExtFromNorm(norm)
        const graph = await this.crud.loadGraphOrThrow(id)
        let cubeStream = await this.lfSync.openLangflowCubeStream(lf, langflowFlowId, norm, graph)
        cubeStream = prependWorkflowStart(
          cubeStream,
          {
            task_id: taskId,
            trace_id: traceId,
            flow_id: id,
            flow_version: norm.flow_version,
            ext: norm.ext,
          },
          mergeExt,
        )
        cubeStream = transformStreamEnrichUsage(cubeStream, {
          task_id: taskId,
          startedAtMs: startMs,
          trace_id: traceId,
          flow_id: id,
          mergeRequestExt: mergeExt,
        })
        const out = teeCubeSseWithPersistence(cubeStream, async (text) => {
          await this.crud.repo.appendPlaygroundMessage(sessionId, 'bot', text || '')
        })
        return createSseResponse(out)
      } catch (e) {
        if (!shouldFallbackCubeEngine(e)) throw e
        const graph = await this.crud.loadGraphOrThrow(id)
        const inner = createCubeLinearEngineSseStream(graph, norm, id, this.cubeEngineContext(), mergeRequestExtFromNorm(norm))
        const wrapped = this.lfSync.wrapLinearCubeSse(inner, norm, id)
        const out = teeCubeSseWithPersistence(wrapped, async (text) => {
          await this.crud.repo.appendPlaygroundMessage(sessionId, 'bot', text || '')
        })
        return createSseResponse(out)
      }
    }

    try {
      const { lf, langflowFlowId } = await this.lfSync.prepareCubeFlowForExecution(id)
      const graph = await this.crud.loadGraphOrThrow(id)
      const sync = await this.lfSync.runSyncViaLangflowAdapter(lf, langflowFlowId, norm, graph)
      const raw = sync.raw
      const botText =
        typeof raw === 'string'
          ? raw
          : raw !== undefined
            ? JSON.stringify(raw).slice(0, 400_000)
            : ''
      await this.crud.repo.appendPlaygroundMessage(sessionId, 'bot', botText || '')
      return sync
    } catch (e) {
      if (!shouldFallbackCubeEngine(e)) throw e
      const graph = await this.crud.loadGraphOrThrow(id)
      const r = await runCubeLinearEngineSync(graph, norm, this.cubeEngineContext())
      await this.crud.repo.appendPlaygroundMessage(sessionId, 'bot', r.text || '')
      return { status: 'ok' as const, raw: r }
    }
  }
}
