import { HttpException, Inject, Injectable, NotFoundException } from '@dangao/bun-server'
import { BadRequestException } from '@dangao/bun-server'
import { APP_CONFIG_TOKEN, SnowflakeUtil, type AppConfig } from '@cube-ai/server-base'
import type { CubeFlowGraph } from '../contracts/cube-flow'
import { emptyCubeFlowGraph } from '../contracts/cube-flow'
import { FLOW_REPOSITORY_TOKEN, type FlowRepository } from '../db/repository-contracts'
import {
  cubeGraphToLfFlowData,
  injectLfMcpToolsDynamicSlotsFromListedTools,
  lfFlowDocumentToCubeGraph,
  normalizeCubeGraphMcpDynamicSchema,
  reconcileMcpToolsToolsetTemplateInLfData,
} from '../langflow/graph-translator'
import { enrichLfFlowDataWithLiveMcpToolOptions } from '../langflow/lf-mcp-tool-options-enrich'
import { normalizeGraphMcpServersForLangflowPush } from '../langflow/lf-mcp-server-sync'
import { getLfComponentDef } from '../langflow/lf-api-all-registry'
import {
  extractBuildJobId,
  LangflowClient,
  LangflowRequestError,
  langflowConfigFromAppConfig,
} from '../langflow/langflow-client'
import { createSseResponse } from '../http/sse-response'
import { prependWorkflowStart, transformStreamEnrichUsage } from './cube-sse-enrich'
import { transformLangflowSseToCube } from '../langflow/lf-sse-stream'
import type { CubeRunInputFileRef, NormalizedRunBody } from '../contracts/cube-run'
import {
  CubeCustomComponentPrepareError,
  prepareCubeGraphLangflowExport,
} from '../custom-component/prepare-graph-for-lf'
import { validateCubeCustomComponentGraph } from '../custom-component/validate-graph'
import { parseGraph } from './flow-crud.service'
import { FlowCrudService } from './flow-crud.service'

function mergeRequestExtFromNorm(norm: NormalizedRunBody): Record<string, unknown> | undefined {
  if (!norm.ext || typeof norm.ext !== 'object') return undefined
  return Object.keys(norm.ext).length > 0 ? norm.ext : undefined
}

function isChatInputNode(n: CubeFlowGraph['nodes'][number]): boolean {
  return n.cubeType === 'cube.lf.ChatInput' || n.lfNodeId.startsWith('ChatInput-')
}

function inputFileRefPath(file: CubeRunInputFileRef): string | null {
  const path = file.file_path ?? file.path ?? file.filePath ?? file.url ?? file.id
  const trimmed = typeof path === 'string' ? path.trim() : ''
  return trimmed || null
}

function envTruthy(name: string): boolean {
  const v = process.env[name]
  if (!v) return false
  const s = v.trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

export function mapTweaksNodeIdsForLangflow(
  tweaks: Record<string, Record<string, unknown>> | undefined,
  graph: CubeFlowGraph | undefined,
): Record<string, Record<string, unknown>> | undefined {
  if (!tweaks || Object.keys(tweaks).length === 0) return undefined
  if (!graph) return tweaks
  const idToLf = new Map<string, string>()
  for (const n of graph.nodes) {
    idToLf.set(n.id, n.lfNodeId)
    idToLf.set(n.lfNodeId, n.lfNodeId)
  }
  const out: Record<string, Record<string, unknown>> = {}
  for (const [nodeId, patch] of Object.entries(tweaks)) {
    const lfNodeId = idToLf.get(nodeId) ?? nodeId
    out[lfNodeId] = { ...(out[lfNodeId] ?? {}), ...patch }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function applyInputFilesToChatInputTweaks(
  body: NormalizedRunBody,
  graph: CubeFlowGraph,
): NormalizedRunBody {
  const files = body.input_files
  if (!files || files.length === 0) return body
  const filePaths = files.map(inputFileRefPath).filter((item): item is string => item != null)
  if (filePaths.length === 0) return body

  const chatInputs = graph.nodes.filter(isChatInputNode)
  if (chatInputs.length === 0) return body

  const nextTweaks: Record<string, Record<string, unknown>> = {}
  for (const [nodeId, patch] of Object.entries(body.tweaks ?? {})) {
    nextTweaks[nodeId] = { ...patch }
  }
  let changed = false
  for (const node of chatInputs) {
    const existingKey = nextTweaks[node.id] ? node.id : nextTweaks[node.lfNodeId] ? node.lfNodeId : node.id
    const patch = { ...(nextTweaks[existingKey] ?? {}) }
    if (patch['files'] !== undefined) continue
    patch['files'] = filePaths
    nextTweaks[existingKey] = patch
    changed = true
  }

  if (!changed) return body
  return { ...body, tweaks: nextTweaks }
}

function withMappedTweaksForLangflow(body: NormalizedRunBody, graph: CubeFlowGraph): NormalizedRunBody {
  const withFiles = applyInputFilesToChatInputTweaks(body, graph)
  const mapped = mapTweaksNodeIdsForLangflow(withFiles.tweaks, graph)
  if (mapped === withFiles.tweaks) return withFiles
  return { ...withFiles, tweaks: mapped }
}

/**
 * Langflow 绑定与同步：create/update（含 LF push）、import/export、stream adapter。
 */
@Injectable()
export class FlowLangflowSyncService {
  private readonly lf: LangflowClient | null
  private readonly langflowApiAllPath: string

  constructor(
    @Inject(APP_CONFIG_TOKEN) config: AppConfig,
    @Inject(FLOW_REPOSITORY_TOKEN) private readonly repo: FlowRepository,
    private readonly crud: FlowCrudService,
  ) {
    const cfg = langflowConfigFromAppConfig(config)
    this.lf = cfg ? new LangflowClient(cfg) : null
    this.langflowApiAllPath = config.paths.langflowApiAllPath
  }

    /**
   * 删除 Cube 流程：先 best-effort 调用 Langflow 删除远端 flow（失败仅打日志），再删本地库。
   */
  async deleteFlow(ref: string): Promise<{ deleted: true }> {
     const tenantId = this.crud.requireProjectId()
     const id = await this.crud.resolveFlowId(ref)
     const row = await this.repo.getFlow(id, tenantId)
     if (!row) throw new NotFoundException(`Flow ${id} not found`)
     await this.deleteLangflowFlowBestEffort(row.langflow_flow_id)
     await this.repo.deleteFlow(tenantId, id)
     return { deleted: true }
  }

private async deleteLangflowFlowBestEffort(langflowFlowId: string | null | undefined): Promise<void> {
     const fid = (langflowFlowId ?? '').trim()
     if (!this.lf || !fid) return
     try {
      await this.lf.deleteFlow(fid)
     } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[cube-ai] Langflow deleteFlow best-effort failed (${fid}): ${msg}`)
    }
  }

  async create(body: { name: string; description?: string }) {
    const id = SnowflakeUtil.nextId()
    const now = new Date().toISOString()
    const graph = emptyCubeFlowGraph()
    const graphJson = JSON.stringify(graph)

    let langflowFlowId: string | null = null
    let bindingStatus = 'pending'
    let snapshot: string | null = null

    if (this.lf) {
      try {
        const created = await this.lf.createFlow({
          name: body.name,
          description: body.description ?? '',
          data: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          is_component: false,
        })
        langflowFlowId = typeof created['id'] === 'string' ? created['id'] : null
        snapshot = JSON.stringify(created)
        bindingStatus = langflowFlowId ? 'linked' : 'pending'
      } catch (e) {
        bindingStatus = 'broken'
        console.error('[cube-ai] Langflow createFlow failed:', e)
      }
    }

    await this.repo.createFlow(
      this.crud.requireProjectId(),
      {
        id,
        name: body.name,
        description: body.description ?? '',
        langflow_flow_id: langflowFlowId,
        binding_status: bindingStatus,
        cube_revision: 0,
        create_time: now,
        update_time: now,
        lf_snapshot_json: snapshot,
        create_by: 'system',
        creator_id: null,
        creator_type: null,
        update_by: 'system',
        updater_id: null,
        updater_type: null,
      },
      graphJson,
    )

    return this.crud.get(id)
  }

  async update(
    ref: string,
    body: { name?: string; description?: string; graph?: CubeFlowGraph },
  ) {
    const tenantId = this.crud.requireProjectId()
    const id = await this.crud.resolveFlowId(ref)
    const row = await this.repo.getFlow(id, tenantId)
    if (!row) throw new NotFoundException(`Flow ${id} not found`)

    if (body.name !== undefined || body.description !== undefined) {
      await this.repo.updateFlowMeta(
        tenantId,
        id,
        { name: body.name, description: body.description },
        false,
      )
    }

    if (body.graph !== undefined) {
      const graph = normalizeCubeGraphMcpDynamicSchema(body.graph)
      validateCubeCustomComponentGraph(graph)
      const graphJson = JSON.stringify(graph)
      await this.repo.updateGraph(tenantId, id, graphJson)
      await this.pushToLangflow(id, graph)
      const after = await this.repo.getFlow(id, this.crud.requireProjectId())
      if (after) {
        await this.repo.archiveDefaultPlaygroundSession(id, `对话 · rev ${after.cube_revision}`)
      }
    }

    return this.crud.get(id)
  }

  private async ensureLangflowFlowBound(flowId: string): Promise<void> {
    const tenantId = this.crud.requireProjectId()
    const row = await this.repo.getFlow(flowId, tenantId)
    if (!row || !this.lf || row.langflow_flow_id) return
    try {
      const created = await this.lf.createFlow({
        name: row.name,
        description: row.description ?? '',
        data: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        is_component: false,
      })
      const lfId = typeof created['id'] === 'string' ? created['id'] : null
      if (!lfId) {
        console.error('[cube-ai] Langflow createFlow returned no id', created)
        return
      }
      await this.repo.updateFlowMeta(
        tenantId,
        flowId,
        { langflow_flow_id: lfId, binding_status: 'linked' },
        false,
      )
      await this.repo.setLfSnapshot(tenantId, flowId, JSON.stringify(created))
      console.log(`[cube-ai] Bound flow ${flowId} -> Langflow ${lfId}`)
    } catch (e) {
      await this.repo.updateFlowMeta(tenantId, flowId, { binding_status: 'broken' }, false)
      console.error('[cube-ai] ensureLangflowFlowBound failed:', e)
      throw new HttpException(502, `Cannot create Langflow flow: ${e instanceof Error ? e.message : String(e)}`, {
        code: 'LANGFLOW_CREATE_FAILED',
      })
    }
  }

  async pushToLangflow(id: string, graph: CubeFlowGraph) {
    const tenantId = this.crud.requireProjectId()
    if (!this.lf) {
      console.warn('[cube-ai] pushToLangflow skipped: LANGFLOW_BASE_URL not set or invalid')
      return
    }
    await this.ensureLangflowFlowBound(id)
    const row = await this.repo.getFlow(id, tenantId)
    if (!row?.langflow_flow_id) {
      console.warn('[cube-ai] pushToLangflow skipped: no langflow_flow_id after bind attempt')
      return
    }

    const apiAllPath = this.langflowApiAllPath

    let graphForLf: CubeFlowGraph = graph
    try {
      graphForLf = await normalizeGraphMcpServersForLangflowPush(this.lf, graph)
    } catch (e) {
      console.warn(
        '[cube-ai] ensure Langflow global MCP servers failed; MCP Tools may not resolve in LF until fixed:',
        e,
      )
      graphForLf = graph
    }

    const patchMerged = async (lfFlowId: string, snap: Record<string, unknown>) => {
      const baseData = snap['data'] as Record<string, unknown> | undefined
      if (!baseData) {
        throw new HttpException(502, 'Langflow snapshot missing data', { code: 'SYNC_FAILED' })
      }
      let exportGraph = graphForLf
      try {
        exportGraph = prepareCubeGraphLangflowExport(graphForLf)
      } catch (e) {
        if (e instanceof CubeCustomComponentPrepareError) {
          throw new HttpException(422, e.message, { code: e.code })
        }
        throw e
      }
      const mergedData = cubeGraphToLfFlowData(exportGraph, baseData, (k) => getLfComponentDef(k, apiAllPath), apiAllPath)
      const listedByLfNode = await enrichLfFlowDataWithLiveMcpToolOptions(mergedData)
      injectLfMcpToolsDynamicSlotsFromListedTools(mergedData, exportGraph, listedByLfNode)
      reconcileMcpToolsToolsetTemplateInLfData(mergedData, graphForLf, listedByLfNode)
      return this.lf!.patchFlow(lfFlowId, { data: mergedData })
    }

    const rebindAfterRemoteDelete = async (staleLfId: string) => {
      console.warn(
        `[cube-ai] Langflow id ${staleLfId} missing or unusable (404/410 or bad body); creating replacement flow and rebinding`,
      )
      try {
        const created = await this.lf!.createFlow({
          name: row.name,
          description: row.description ?? '',
          data: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          is_component: false,
        })
        const newLfId = typeof created['id'] === 'string' ? created['id'] : null
        if (!newLfId) {
          throw new Error('Langflow createFlow returned no id after remote flow was deleted')
        }
        await this.repo.updateFlowMeta(tenantId, id, { langflow_flow_id: newLfId, binding_status: 'linked' }, false)
        let fresh: Record<string, unknown>
        try {
          fresh = await this.lf!.getFlow(newLfId)
        } catch {
          fresh = created
        }
        await this.repo.setLfSnapshot(tenantId, id, JSON.stringify(fresh))
        const updated = await patchMerged(newLfId, fresh)
        await this.repo.setLfSnapshot(tenantId, id, JSON.stringify(updated))
        await this.repo.updateFlowMeta(tenantId, id, { binding_status: 'linked' }, false)
      } catch (e2) {
        await this.repo.updateFlowMeta(tenantId, id, { binding_status: 'broken' }, false)
        throw new HttpException(
          502,
          `Langflow sync failed (rebind): ${e2 instanceof Error ? e2.message : String(e2)}`,
          { code: 'LANGFLOW_SYNC_FAILED' },
        )
      }
    }

    let snapshotObj: Record<string, unknown>
    if (row.lf_snapshot_json) {
      snapshotObj = JSON.parse(row.lf_snapshot_json) as Record<string, unknown>
    } else {
      try {
        snapshotObj = await this.lf.getFlow(row.langflow_flow_id)
        await this.repo.setLfSnapshot(tenantId, id, JSON.stringify(snapshotObj))
      } catch (e) {
        const lfErr = e instanceof LangflowRequestError ? e : null
        const rebind =
          lfErr && (lfErr.status === 404 || lfErr.status === 410 || lfErr.rebindSuggested === true)
        if (rebind) {
          await rebindAfterRemoteDelete(row.langflow_flow_id)
          return
        }
        await this.repo.updateFlowMeta(tenantId, id, { binding_status: 'broken' }, false)
        throw new HttpException(502, `Langflow sync failed: ${e instanceof Error ? e.message : String(e)}`, {
          code: 'LANGFLOW_SYNC_FAILED',
        })
      }
    }

    try {
      const updated = await patchMerged(row.langflow_flow_id, snapshotObj)
      await this.repo.setLfSnapshot(tenantId, id, JSON.stringify(updated))
      await this.repo.updateFlowMeta(tenantId, id, { binding_status: 'linked' }, false)
    } catch (e) {
      const lfErr = e instanceof LangflowRequestError ? e : null
      const rebind =
        lfErr &&
        this.lf &&
        (lfErr.status === 404 || lfErr.status === 410 || lfErr.rebindSuggested === true)
      if (!rebind) {
        await this.repo.updateFlowMeta(tenantId, id, { binding_status: 'broken' }, false)
        throw new HttpException(502, `Langflow sync failed: ${e instanceof Error ? e.message : String(e)}`, {
          code: 'LANGFLOW_SYNC_FAILED',
        })
      }
      await rebindAfterRemoteDelete(row.langflow_flow_id)
    }
  }

  async importFromLangflow(ref: string, langflowFlowId: string) {
    const id = await this.crud.resolveFlowId(ref)
    const row = await this.repo.getFlow(id, this.crud.requireProjectId())
    if (!row) throw new NotFoundException(`Flow ${id} not found`)
    if (!this.lf) {
      throw new HttpException(503, 'Langflow not configured', { code: 'LANGFLOW_UNAVAILABLE' })
    }

    const tenantId = this.crud.requireProjectId()
    const doc = await this.lf.getFlow(langflowFlowId)
    const graph = lfFlowDocumentToCubeGraph(doc)
    await this.repo.updateFlowMeta(
      tenantId,
      id,
      { langflow_flow_id: langflowFlowId, binding_status: 'linked' },
      false,
    )
    await this.repo.setLfSnapshot(tenantId, id, JSON.stringify(doc))
    await this.repo.updateGraph(tenantId, id, JSON.stringify(graph))
    return this.crud.get(id)
  }

  extractGraphJsonFromImportBody(o: Record<string, unknown>): string {
    let graphRaw: unknown
    const ce = o['cubeFlowExport']
    if (ce && typeof ce === 'object' && !Array.isArray(ce)) {
      const c = ce as Record<string, unknown>
      const ver = c['version']
      if (ver !== 1 && ver !== '1') {
        throw new BadRequestException('Unsupported cubeFlowExport version')
      }
      graphRaw = c['graph']
    } else {
      graphRaw = o['graph']
    }
    if (graphRaw === undefined) {
      throw new BadRequestException('graph is required')
    }
    return typeof graphRaw === 'string' ? graphRaw : JSON.stringify(graphRaw)
  }

  parseCubeFlowImportBody(body: unknown): { name: string; description: string; graphJson: string } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('invalid import body')
    }
    const o = body as Record<string, unknown>
    let nameFromExport: string | undefined
    let description = ''
    const ce = o['cubeFlowExport']
    if (ce && typeof ce === 'object' && !Array.isArray(ce)) {
      const c = ce as Record<string, unknown>
      nameFromExport = typeof c['name'] === 'string' ? c['name'] : undefined
      description = typeof c['description'] === 'string' ? c['description'] : ''
    } else {
      nameFromExport = typeof o['name'] === 'string' ? o['name'] : undefined
      description = typeof o['description'] === 'string' ? o['description'] : ''
    }
    if (typeof o['description'] === 'string') {
      description = o['description']
    }
    const nameOverride = typeof o['name'] === 'string' ? o['name'].trim() : ''
    const finalName = (nameOverride.length > 0 ? nameOverride : nameFromExport?.trim()) ?? ''
    if (!finalName) {
      throw new BadRequestException('name is required (top-level name or cubeFlowExport.name)')
    }
    const graphJson = this.extractGraphJsonFromImportBody(o)
    return { name: finalName, description, graphJson }
  }

  async importFlow(body: unknown) {
    const parsed = this.parseCubeFlowImportBody(body)
    const graph = normalizeCubeGraphMcpDynamicSchema(parseGraph(parsed.graphJson))
    validateCubeCustomComponentGraph(graph)
    const created = await this.create({ name: parsed.name, description: parsed.description })
    await this.update(created.id, { graph })
    return this.crud.get(created.id)
  }

  async importGraphIntoExistingFlow(ref: string, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('invalid import body')
    }
    const o = body as Record<string, unknown>
    const graphJson = this.extractGraphJsonFromImportBody(o)
    const graph = normalizeCubeGraphMcpDynamicSchema(parseGraph(graphJson))
    validateCubeCustomComponentGraph(graph)
    return this.update(ref, { graph })
  }

  /** Persist current graph and ensure execution backend binding. */
  async prepareCubeFlowForExecution(id: string): Promise<{
    lf: LangflowClient
    langflowFlowId: string
  }> {
    const detail = await this.crud.get(id)
    await this.update(id, { graph: detail.graph })
    const refreshed = await this.crud.get(id)
    if (!this.lf || !refreshed.langflowFlowId) {
      throw new HttpException(
        503,
        'Execution backend not available: set LANGFLOW_BASE_URL to run via Langflow, or EXP_USE_CUBE_FLOW_ENGINE=1 to use the built-in cube-linear-engine',
        { code: 'EXECUTION_UNAVAILABLE' },
      )
    }
    return { lf: this.lf, langflowFlowId: refreshed.langflowFlowId }
  }

  async deleteLangflowChatSession(sessionId: string): Promise<void> {
    const sid = sessionId.trim()
    if (!sid || !this.lf) return
    try {
      await this.lf.deleteChatSession(sid)
    } catch (e) {
      console.error('[cube-ai] Langflow deleteChatSession failed:', e)
      const lfErr = e instanceof LangflowRequestError ? e : null
      if (lfErr?.status === 404) return
      throw new HttpException(502, e instanceof Error ? e.message : String(e), {
        code: 'LANGFLOW_DELETE_CHAT_FAILED',
      })
    }
  }

  /**
   * Langflow 对 monitor 接口常做 flow 归属校验；401/403 原样返回便于与 502 区分。
   */
  private mapLangflowMonitorError(e: unknown, code: string): never {
    if (!(e instanceof LangflowRequestError)) {
      throw e
    }
    const status = e.status
    const lfBody = e.bodyText.length > 1200 ? `${e.bodyText.slice(0, 1200)}…` : e.bodyText
    const deniedHint =
      status === 401 || status === 403
        ? '执行后端拒绝访问：请核对 LANGFLOW_API_KEY / LANGFLOW_BEARER_TOKEN 在 Langflow 侧是否有权读取该 flow；新版本 Langflow 会对 monitor 校验归属。'
        : ''
    const message = deniedHint ? `${e.message} ${deniedHint}` : e.message

    if (status === 401 || status === 403 || status === 404) {
      throw new HttpException(status, message, {
        code,
        lf_status: status,
        lf_body: lfBody,
      })
    }
    throw new HttpException(502, message, {
      code,
      lf_status: status,
      lf_body: lfBody,
    })
  }

  /**
   * 透传 Langflow `GET /api/v1/monitor/traces`；`flow_id` 由绑定关系注入，与请求上其它 query 合并。
   */
  async fetchMonitorTracesForFlow(langflowFlowId: string, incomingQuery: URLSearchParams): Promise<Record<string, unknown>> {
    if (!this.lf) {
      throw new HttpException(503, 'Execution backend not available', {
        code: 'EXECUTION_UNAVAILABLE',
      })
    }
    const p = new URLSearchParams(incomingQuery.toString())
    p.set('flow_id', langflowFlowId.trim())
    try {
      return await this.lf.getMonitorTraces(p)
    } catch (e) {
      return this.mapLangflowMonitorError(e, 'LANGFLOW_MONITOR_TRACES')
    }
  }

  /**
   * 透传 Langflow `GET /api/v1/monitor/builds`（顶点级耗时等）。
   */
  async fetchMonitorBuildsForFlow(langflowFlowId: string, incomingQuery: URLSearchParams): Promise<Record<string, unknown>> {
    if (!this.lf) {
      throw new HttpException(503, 'Execution backend not available', {
        code: 'EXECUTION_UNAVAILABLE',
      })
    }
    const p = new URLSearchParams(incomingQuery.toString())
    p.set('flow_id', langflowFlowId.trim())
    try {
      return await this.lf.getMonitorBuilds(p)
    } catch (e) {
      return this.mapLangflowMonitorError(e, 'LANGFLOW_MONITOR_BUILDS')
    }
  }

  buildLangflowInputRequest(body: NormalizedRunBody): Record<string, unknown> {
    const inputRequest: Record<string, unknown> = {
      input_value: body.input ?? '',
      input_type: body.inputType ?? 'chat',
      output_type: body.outputType ?? 'chat',
    }
    if (body.sessionId != null && body.sessionId !== '') {
      inputRequest['session_id'] = body.sessionId
    }
    if (body.tweaks && Object.keys(body.tweaks).length > 0) {
      inputRequest['tweaks'] = body.tweaks
    }
    const cubeRuntime: Record<string, unknown> = {}
    if (body.runtime_config.max_iterations != null) {
      cubeRuntime['max_iterations'] = body.runtime_config.max_iterations
    }
    if (body.runtime_config.timeout_ms != null) {
      cubeRuntime['timeout_ms'] = body.runtime_config.timeout_ms
    }
    const meta: Record<string, unknown> =
      body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? { ...body.metadata }
        : {}
    if (Object.keys(cubeRuntime).length > 0) {
      meta['cube_runtime'] = cubeRuntime
    }
    if (Object.keys(meta).length > 0) {
      inputRequest['metadata'] = meta
    }
    return inputRequest
  }

  async runSyncViaLangflowAdapter(
    lf: LangflowClient,
    langflowFlowId: string,
    body: NormalizedRunBody,
    graph?: CubeFlowGraph,
  ): Promise<{ status: 'ok'; raw: unknown }> {
    try {
      const mappedBody = graph ? withMappedTweaksForLangflow(body, graph) : body
      const inputRequest = this.buildLangflowInputRequest(mappedBody)
      const payload: Record<string, unknown> = { input_request: inputRequest }
      const raw = await lf.runFlow(langflowFlowId, payload)
      return { status: 'ok' as const, raw }
    } catch (e) {
      throw new HttpException(502, e instanceof Error ? e.message : String(e), { code: 'RUN_FAILED' })
    }
  }

  async openLangflowCubeStream(
    lf: LangflowClient,
    langflowFlowId: string,
    body: NormalizedRunBody,
    graph?: CubeFlowGraph,
  ): Promise<ReadableStream<Uint8Array>> {
    const mappedBody = graph ? withMappedTweaksForLangflow(body, graph) : body
    const mergeRequestExt = mergeRequestExtFromNorm(body)
    if (envTruthy('CUBE_AI_LF_PLAYGROUND_USE_BUILD_EVENTS')) {
      return this.openLangflowCubeStreamBuildEvents(lf, langflowFlowId, mappedBody, mergeRequestExt)
    }

    const inputRequest = this.buildLangflowInputRequest(mappedBody)
    const payload: Record<string, unknown> = { input_request: inputRequest }

    let runRes: Response
    try {
      runRes = await lf.openRunStream(langflowFlowId, payload)
    } catch (e) {
      throw new HttpException(502, e instanceof Error ? e.message : String(e), { code: 'RUN_STREAM_FAILED' })
    }

    if (!runRes.ok) {
      const t = await runRes.text()
      throw new HttpException(502, `Langflow run stream ${runRes.status}: ${t}`, { code: 'RUN_STREAM_HTTP' })
    }
    if (!runRes.body) {
      throw new HttpException(502, 'Langflow run stream body empty', { code: 'RUN_STREAM_EMPTY' })
    }

    return transformLangflowSseToCube(runRes.body, { mergeRequestExt })
  }

  private async openLangflowCubeStreamBuildEvents(
    lf: LangflowClient,
    langflowFlowId: string,
    body: NormalizedRunBody,
    mergeRequestExt?: Record<string, unknown>,
  ): Promise<ReadableStream<Uint8Array>> {
    const streamType = body.inputType ?? 'chat'
    let buildResp: Record<string, unknown>
    try {
      const buildBody: Record<string, unknown> = {
        inputs: {
          input_value: body.input ?? '',
          session: body.sessionId ?? '',
          type: streamType,
        },
      }
      if (body.outputType) buildBody['output_type'] = body.outputType
      if (body.tweaks && Object.keys(body.tweaks).length > 0) buildBody['tweaks'] = body.tweaks
      const cubeRuntime: Record<string, unknown> = {}
      if (body.runtime_config.max_iterations != null) {
        cubeRuntime['max_iterations'] = body.runtime_config.max_iterations
      }
      if (body.runtime_config.timeout_ms != null) {
        cubeRuntime['timeout_ms'] = body.runtime_config.timeout_ms
      }
      const meta: Record<string, unknown> =
        body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? { ...body.metadata }
          : {}
      if (Object.keys(cubeRuntime).length > 0) meta['cube_runtime'] = cubeRuntime
      if (Object.keys(meta).length > 0) buildBody['metadata'] = meta
      buildResp = await lf.startBuildFlow(langflowFlowId, buildBody)
    } catch (e) {
      throw new HttpException(502, e instanceof Error ? e.message : String(e), { code: 'BUILD_START_FAILED' })
    }

    const jobId = extractBuildJobId(buildResp)
    if (!jobId) {
      throw new HttpException(502, 'Langflow build response missing job id', {
        code: 'BUILD_JOB_UNKNOWN',
        hint: JSON.stringify(buildResp).slice(0, 500),
      })
    }

    let evRes: Response
    try {
      evRes = await lf.openBuildEventsStream(jobId)
    } catch (e) {
      throw new HttpException(502, e instanceof Error ? e.message : String(e), { code: 'BUILD_EVENTS_FAILED' })
    }

    if (!evRes.ok) {
      const t = await evRes.text()
      throw new HttpException(502, `Langflow events ${evRes.status}: ${t}`, { code: 'BUILD_EVENTS_HTTP' })
    }
    if (!evRes.body) {
      throw new HttpException(502, 'Langflow events body empty', { code: 'BUILD_EVENTS_EMPTY' })
    }

    return transformLangflowSseToCube(evRes.body, { mergeRequestExt })
  }

  wrapLinearCubeSse(
    inner: ReadableStream<Uint8Array>,
    norm: NormalizedRunBody,
    flowPk: string,
  ): ReadableStream<Uint8Array> {
    const taskId = SnowflakeUtil.nextId()
    const startMs = Date.now()
    const traceId = norm.user_context.trace_id?.trim() || taskId
    const mergeExt = mergeRequestExtFromNorm(norm)
    let out = prependWorkflowStart(
      inner,
      {
        task_id: taskId,
        trace_id: traceId,
        flow_id: flowPk,
        flow_version: norm.flow_version,
        ext: norm.ext,
      },
      mergeExt,
    )
    out = transformStreamEnrichUsage(out, {
      task_id: taskId,
      startedAtMs: startMs,
      trace_id: traceId,
      flow_id: flowPk,
      mergeRequestExt: mergeExt,
    })
    return out
  }

  async runStreamViaLangflowAdapter(
    lf: LangflowClient,
    langflowFlowId: string,
    body: NormalizedRunBody,
    flowPk: string,
  ): Promise<Response> {
    const taskId = SnowflakeUtil.nextId()
    const startMs = Date.now()
    const traceId = body.user_context.trace_id?.trim() || taskId
    const mergeExt = mergeRequestExtFromNorm(body)
    const graph = await this.crud.loadGraphOrThrow(flowPk)
    let out = await this.openLangflowCubeStream(lf, langflowFlowId, body, graph)
    out = prependWorkflowStart(
      out,
      {
        task_id: taskId,
        trace_id: traceId,
        flow_id: flowPk,
        flow_version: body.flow_version,
        ext: body.ext,
      },
      mergeExt,
    )
    out = transformStreamEnrichUsage(out, {
      task_id: taskId,
      startedAtMs: startMs,
      trace_id: traceId,
      flow_id: flowPk,
      mergeRequestExt: mergeExt,
    })
    return createSseResponse(out)
  }
}
