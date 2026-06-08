import { Injectable } from '@dangao/bun-server'
import { SnowflakeUtil } from '@cube-ai/server-base'
import type { LlmProviderPort } from '@cube-ai/contracts'
import { NoopLlmProvider } from '@cube-ai/llm-core'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { createSseResponse } from '../http/sse-response'
import { createCubeLinearEngineSseStream, runCubeLinearEngineSync, type CubeEngineContext } from '../engine/cube-linear-engine'
import { recordFlowExecutionSync } from '../observability/execution-metrics'
import { HttpException } from '@dangao/bun-server'
import { FlowCrudService } from './flow-crud.service'
import { FlowLangflowSyncService } from './flow-langflow-sync.service'
import type { NormalizedRunBody } from '../contracts/cube-run'

const flowTracer = trace.getTracer('@cube-ai/flow')

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

/**
 * 流程执行服务：`run`（同步）与 `runStream`（流式 SSE）。
 */
@Injectable()
export class FlowExecutionService {
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

  async run(id: string, body: unknown) {
    const norm = this.crud.toNormalized(body)
    const fid = await this.crud.resolveFlowId(id)
    await this.crud.assertDeveloperApiFlowScope(fid)
    const taskId = SnowflakeUtil.nextId()
    const traceId = norm.user_context.trace_id?.trim() || taskId
    const startMs = Date.now()

    return flowTracer.startActiveSpan('flows.run', async (span) => {
      span.setAttribute('cube.flow_id', fid)
      const fail = (err: unknown) => {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        })
        if (err instanceof Error) span.recordException(err)
      }

      if (envTruthy('EXP_USE_CUBE_FLOW_ENGINE')) {
        try {
          const graph = await this.crud.loadGraphOrThrow(fid)
          const r = await runCubeLinearEngineSync(graph, norm, this.cubeEngineContext())
          recordFlowExecutionSync({ flowId: fid, taskId, startedAtMs: startMs, ok: true })
          return { status: 'ok' as const, raw: r, task_id: taskId, trace_id: traceId }
        } catch (e) {
          recordFlowExecutionSync({ flowId: fid, taskId, startedAtMs: startMs, ok: false })
          fail(e)
          throw e
        }
      }

      try {
        const { lf, langflowFlowId } = await this.lfSync.prepareCubeFlowForExecution(fid)
        const graph = await this.crud.loadGraphOrThrow(fid)
        const r = await this.lfSync.runSyncViaLangflowAdapter(lf, langflowFlowId, norm, graph)
        recordFlowExecutionSync({ flowId: fid, taskId, startedAtMs: startMs, ok: true })
        return { ...r, task_id: taskId, trace_id: traceId }
      } catch (e) {
        if (shouldFallbackCubeEngine(e)) {
          try {
            const graph = await this.crud.loadGraphOrThrow(fid)
            const r = await runCubeLinearEngineSync(graph, norm, this.cubeEngineContext())
            recordFlowExecutionSync({ flowId: fid, taskId, startedAtMs: startMs, ok: true })
            return { status: 'ok' as const, raw: r, task_id: taskId, trace_id: traceId }
          } catch (inner) {
            recordFlowExecutionSync({ flowId: fid, taskId, startedAtMs: startMs, ok: false })
            fail(inner)
            throw inner
          }
        }
        recordFlowExecutionSync({ flowId: fid, taskId, startedAtMs: startMs, ok: false })
        fail(e)
        throw e
      }
    })
  }

  async runStream(id: string, body: unknown): Promise<Response> {
    const norm = this.crud.toNormalized(body)
    const fid = await this.crud.resolveFlowId(id)
    await this.crud.assertDeveloperApiFlowScope(fid)

    return flowTracer.startActiveSpan('flows.runStream', async (span) => {
      span.setAttribute('cube.flow_id', fid)
      try {
        if (envTruthy('EXP_USE_CUBE_FLOW_ENGINE')) {
          const graph = await this.crud.loadGraphOrThrow(fid)
          const inner = createCubeLinearEngineSseStream(
            graph,
            norm,
            fid,
            this.cubeEngineContext(),
            mergeRequestExtFromNorm(norm),
          )
          const out = this.lfSync.wrapLinearCubeSse(inner, norm, fid)
          return createSseResponse(out)
        }

        try {
          const { lf, langflowFlowId } = await this.lfSync.prepareCubeFlowForExecution(fid)
          return await this.lfSync.runStreamViaLangflowAdapter(lf, langflowFlowId, norm, fid)
        } catch (e) {
          if (!shouldFallbackCubeEngine(e)) throw e
          const graph = await this.crud.loadGraphOrThrow(fid)
          const inner = createCubeLinearEngineSseStream(
            graph,
            norm,
            fid,
            this.cubeEngineContext(),
            mergeRequestExtFromNorm(norm),
          )
          const out = this.lfSync.wrapLinearCubeSse(inner, norm, fid)
          return createSseResponse(out)
        }
      } catch (e) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: e instanceof Error ? e.message : String(e),
        })
        if (e instanceof Error) span.recordException(e)
        throw e
      }
    })
  }
}
