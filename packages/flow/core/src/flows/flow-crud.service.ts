import { BadRequestException, HttpException, Inject, Injectable, NotFoundException } from '@dangao/bun-server'
import { APP_CONFIG_TOKEN, type AppConfig } from '@cube-ai/ai-center/platform/server-base'
import type { CubeFlowGraph, CubeFlowNode } from '../contracts/cube-flow'
import { CUBE_FLOW_SCHEMA_VERSION, emptyCubeFlowGraph } from '../contracts/cube-flow'
import { FLOW_REPOSITORY_TOKEN, type FlowRepository } from '../db/repository-contracts'
import { getLfComponentDef } from '../langflow/lf-api-all-registry'
import { normalizeRunBody, type NormalizedRunBody } from '../contracts/cube-run'
import { applyInputGuardrails } from '../guardrails/guardrails'
import { currentTenantId, isGlobalAccessEnabled } from '@cube-ai/tenant-context'

/** Keys safe to expose in playground graph summaries (no secrets). */
export const PLAYGROUND_VISIBLE_CONFIG_KEYS = [
  'system_message',
  'system_prompt',
  'model_name',
  'model',
  'temperature',
  'stream',
  'max_tokens',
  'json_mode',
  'openai_api_base',
  'input_value',
  'description',
] as const

export function isSensitivePlaygroundConfigKey(key: string): boolean {
  const k = key.toLowerCase()
  if (k.includes('secret')) return true
  if (k.includes('password')) return true
  if (k.includes('credential')) return true
  if (k.includes('token') && !k.includes('max_tokens')) return true
  if (/(^|_)api_?key$|_key$/.test(k) && k !== 'max_tokens') return true
  return false
}

export function playgroundVisibleNodeConfig(config: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!config || typeof config !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const key of PLAYGROUND_VISIBLE_CONFIG_KEYS) {
    if (isSensitivePlaygroundConfigKey(key) || !(key in config)) continue
    let v = config[key]
    if (v === undefined) continue
    if (typeof v === 'string') {
      if (key === 'input_value' && v.length > 800) v = `${v.slice(0, 800)}…`
      else if (v.length > 16_000) v = `${v.slice(0, 16_000)}…`
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[key] = v
    }
  }
  return out
}

export function parseGraph(json: string): CubeFlowGraph {
  const g = JSON.parse(json) as CubeFlowGraph
  if (g.schemaVersion !== CUBE_FLOW_SCHEMA_VERSION) {
    throw new HttpException(422, 'Unsupported graph schemaVersion', { got: g.schemaVersion })
  }
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
    throw new HttpException(422, 'Invalid graph shape')
  }
  return g
}

export function lfKeyFromCubeNode(n: CubeFlowNode): string {
  const ct = n.cubeType
  if (typeof ct === 'string' && ct.startsWith('cube.lf.')) return ct.slice('cube.lf.'.length)
  if (typeof ct === 'string' && ct.length > 0) return ct
  return ''
}

function componentLabelForLfKey(lfKey: string, apiAllPath: string): string {
  if (!lfKey || lfKey === 'unknown') return 'unknown'
  if (lfKey === 'note') return 'Note'
  const def = getLfComponentDef(lfKey, apiAllPath)
  if (def) {
    const dn = def['display_name'] ?? def['displayName']
    if (typeof dn === 'string' && dn.trim()) return dn.trim()
  }
  return lfKey
}

/**
 * 纯 CRUD 与只读查询服务：不依赖 Langflow 外部 I/O。
 * 供 FlowLangflowSyncService、FlowExecutionService、FlowPlaygroundService 注入。
 */
@Injectable()
export class FlowCrudService {
  readonly repo: FlowRepository
  readonly langflowApiAllPath: string

  constructor(
    @Inject(APP_CONFIG_TOKEN) config: AppConfig,
    @Inject(FLOW_REPOSITORY_TOKEN) repo: FlowRepository,
  ) {
    this.repo = repo
    this.langflowApiAllPath = config.paths.langflowApiAllPath
  }

  requireProjectId(): string {
    const p = currentTenantId()
    const s = typeof p === 'string' ? p.trim() : ''
    if (!s) {
      throw new HttpException(400, 'missing or invalid tenant context', { code: 'TENANT_REQUIRED' })
    }
    return s
  }

  readProjectId(): string | null {
    if (isGlobalAccessEnabled()) return null
    return this.requireProjectId()
  }

  toNormalized(body: unknown): NormalizedRunBody {
    const norm = normalizeRunBody(body)
    norm.input = applyInputGuardrails(norm.input, norm)
    return norm
  }

  async assertDeveloperApiFlowScope(_resolvedFlowPk: string): Promise<void> {
    // Developer API key scope checks removed: api-keys retired (ADR-0012 addendum)
  }

  async resolveFlowId(ref: string): Promise<string> {
    const tenantId = this.readProjectId()
    const s = ref?.trim() ?? ''
    if (!s) throw new BadRequestException('flow id or name is required')
    if (await this.repo.getFlow(s, tenantId)) return s
    const lower = s.toLowerCase()
    const matches = (await this.repo.listFlows(tenantId)).filter((r) => r.name.trim().toLowerCase() === lower)
    if (matches.length === 1) {
      const only = matches[0]
      if (!only) throw new NotFoundException(`Flow ${s} not found`)
      return only.id
    }
    if (matches.length > 1) {
      throw new BadRequestException(
        `Ambiguous flow name "${s}" (${matches.length} flows); use UUID from list_flows.`,
      )
    }
    throw new NotFoundException(`Flow ${s} not found`)
  }

  async list() {
    const rows = await this.repo.listFlows(this.readProjectId())
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        create_time: r.create_time,
        update_time: r.update_time,
        nodeCount: await this.listNodeCountForGraph(r.id),
        bindingStatus: r.binding_status,
        langflowFlowId: r.langflow_flow_id,
      })),
    )
  }

  async listNodeCountForGraph(flowId: string): Promise<number> {
    const j = await this.repo.getGraphJson(flowId)
    if (!j) return 0
    try {
      return (JSON.parse(j) as CubeFlowGraph).nodes.length
    } catch {
      return 0
    }
  }

  async get(ref: string) {
    const id = await this.resolveFlowId(ref)
    const row = await this.repo.getFlow(id, this.readProjectId())
    if (!row) throw new NotFoundException(`Flow ${id} not found`)
    const gj = await this.repo.getGraphJson(id)
    const graph = gj ? parseGraph(gj) : emptyCubeFlowGraph()
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      create_time: row.create_time,
      update_time: row.update_time,
      bindingStatus: row.binding_status,
      langflowFlowId: row.langflow_flow_id,
      graph,
    }
  }

  async getFlowSummary(ref: string) {
    const id = await this.resolveFlowId(ref)
    const row = await this.repo.getFlow(id, this.readProjectId())
    if (!row) throw new NotFoundException(`Flow ${id} not found`)
    const gj = await this.repo.getGraphJson(id)
    let nodeCount = 0
    let edgeCount = 0
    const nodeTypes: Record<string, number> = {}
    const nodes: Array<{
      id: string
      cubeType: string
      lfKey: string
      label: string
      config: Record<string, unknown>
    }> = []
    const apiAllPath = this.langflowApiAllPath
    if (gj) {
      try {
        const g = JSON.parse(gj) as CubeFlowGraph
        const rawNodes = Array.isArray(g.nodes) ? g.nodes : []
        nodeCount = rawNodes.length
        edgeCount = Array.isArray(g.edges) ? g.edges.length : 0
        for (const n of rawNodes) {
          let lfKey = lfKeyFromCubeNode(n)
          if (!lfKey) {
            const legacy = n as CubeFlowNode & { type?: string }
            lfKey = typeof legacy.type === 'string' && legacy.type ? legacy.type : 'unknown'
          }
          const label = componentLabelForLfKey(lfKey, apiAllPath)
          nodeTypes[label] = (nodeTypes[label] ?? 0) + 1
          const cfg =
            n.config && typeof n.config === 'object' && !Array.isArray(n.config)
              ? (n.config as Record<string, unknown>)
              : {}
          nodes.push({
            id: n.id,
            cubeType: typeof n.cubeType === 'string' ? n.cubeType : '',
            lfKey,
            label,
            config: playgroundVisibleNodeConfig(cfg),
          })
        }
      } catch {
        /* ignore */
      }
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      create_time: row.create_time,
      update_time: row.update_time,
      bindingStatus: row.binding_status,
      langflowFlowId: row.langflow_flow_id,
      nodeCount,
      edgeCount,
      nodeTypes,
      nodes,
    }
  }

  async exportSnapshot(ref: string) {
    const flow = await this.get(ref)
    return {
      cubeFlowExport: {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        name: flow.name,
        description: flow.description,
        graph: flow.graph,
      },
    }
  }

  /**
   * 仅删除本地库；HTTP 入口应使用 `FlowLangflowSyncService.deleteFlow`（会先 best-effort 删 Langflow 远端）。
   */
  async delete(ref: string) {
    const tenantId = this.requireProjectId()
    const id = await this.resolveFlowId(ref)
    const row = await this.repo.getFlow(id, tenantId)
    if (!row) throw new NotFoundException(`Flow ${id} not found`)
    await this.repo.deleteFlow(tenantId, id)
    return { deleted: true }
  }

  async loadGraphOrThrow(flowPk: string): Promise<CubeFlowGraph> {
    const tenantId = this.requireProjectId()
    if (!(await this.repo.getFlow(flowPk, tenantId))) throw new NotFoundException(`Flow ${flowPk} not found`)
    const j = await this.repo.getGraphJson(flowPk)
    if (!j?.trim()) throw new NotFoundException(`Flow ${flowPk} has no graph`)
    return parseGraph(j)
  }

  async getDefaultPlaygroundSessionId(flowId: string): Promise<string> {
    const id = await this.resolveFlowId(flowId)
    const row = await this.repo.getFlow(id, this.readProjectId())
    if (!row) throw new NotFoundException(`Flow ${id} not found`)
    return await this.repo.ensurePlaygroundDefaultSession(id)
  }

  async resolvePlaygroundSessionIdForTool(flowId: string, sessionId?: string | null): Promise<string> {
    const id = await this.resolveFlowId(flowId)
    const row = await this.repo.getFlow(id, this.readProjectId())
    if (!row) throw new NotFoundException(`Flow ${id} not found`)
    const sid = sessionId?.trim()
    if (sid) {
      const sess = await this.repo.getPlaygroundSession(id, sid)
      if (!sess) throw new NotFoundException(`Playground session ${sid} not found for flow ${id}`)
      return sid
    }
    return await this.repo.ensurePlaygroundDefaultSession(id)
  }
}
