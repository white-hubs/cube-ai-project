import { BadRequestException, Injectable, NotFoundException } from '@dangao/bun-server'
import { currentTenantId } from '@cube-ai/tenant-context'
import type { CubeFlowGraph } from '@cube-ai/flow-core'
import {
  TenantLlmModelRepository,
  TenantLlmProviderRepository,
  type LlmRequestSchema,
  type LlmResponseSchema,
} from '@cube-ai/llm-core'
import type {
  FlowExecutionRequest,
  FlowFileUploadResponse,
  FlowMonitorBuildsResponse,
  FlowMonitorQueryParams,
  FlowMonitorTracesResponse,
  RunResponse,
} from './engine/engine-dtos'
import { FlowEngineBridge, isEngineFlowNotFound } from './engine/flow-engine.bridge'
import type { FlowStudioFlowRow, FlowStudioResourceRefRow } from './db/rows'
import {
  FlowStudioFlowRepository,
  FlowStudioReleaseRepository,
  FlowStudioResourceRefRepository,
  formatMysqlDateTimeShanghai,
} from './db'
import { generateNumericId } from './util/generate-id'
import type { FlowComponentCatalogItem } from './compile/flow-component.service'
import {
  FlowComponentService,
  mergeProtocolPortsForCompile,
  parseEditorEdgeOutputBasename,
  smartRouterCompileOutputNamesForGraph,
} from './compile/flow-component.service'
import { inferWireDefaults } from './compile/wire-defaults'
import {
  AGENT_MCP_SYNTHETIC_EDGE_PREFIX,
  agentCompanionLlmNodeId,
  agentCompanionMcpNodeId,
  buildImageGenerationDslDashscope,
  buildImageGenerationDslOpenAi,
  resolveOpenAiImagesGenerationUrl,
  buildLanguageModelDslAzure,
  buildLanguageModelDslOpenAi,
  buildMcpToolsSyntheticCubeConfigFromAgentPayload,
  buildRuntimeNode,
  CUBE_AGENT_MODEL_INPUT,
  CUBE_SMART_ROUTER_MODEL_INPUT,
  extractAgentCompanionLlmEditorConfig,
  extractSmartRouterCompanionLlmEditorConfig,
  isAgentCompanionLanguageModelNodeId,
  isSmartRouterCompanionLanguageModelNodeId,
  MULTIMODAL_MESSAGE_MERGE_COMPONENT_KEY,
  normalizeEditorKnowledgeSources,
  padSmartRouterCubeConfigRoutesMinRows,
  parseAgentMcpServiceConfig,
  smartRouterCompanionLlmNodeId,
  type FlowRuntimeContext,
  type ImageGenerationRuntimeConfig,
  type LanguageModelRuntimeConfig,
} from './compile/flow-runtime-mapper'

export interface FlowEditorNode {
  id: string
  componentKey: string
  label?: string | null
  position?: { x?: number; y?: number } | null
  data?: Record<string, unknown> | null
}

export interface FlowEditorEdge {
  id: string
  source: string
  target: string
  sourcePort?: string | null
  targetPort?: string | null
  data?: Record<string, unknown> | null
}

export interface FlowEditorGraph {
  schemaVersion?: string
  nodes: FlowEditorNode[]
  edges: FlowEditorEdge[]
  metadata?: Record<string, unknown> | null
}

const MAX_EDITOR_FLOW_NODES = 200
const MAX_EDITOR_FLOW_EDGES = 500

export interface FlowSaveBody {
  name?: string | null
  description?: string | null
  editorFlowJson?: FlowEditorGraph | null
  enabled?: boolean | null
  remark?: string | null
}

export interface FlowPublishBody {
  releaseNote?: string | null
}

export interface FlowDebugBody {
  input?: FlowExecutionRequest['input'] | null
  sessionId?: string | null
  inputType?: string | null
  outputType?: string | null
  tweaks?: Record<string, unknown> | null
  variables?: Record<string, unknown> | null
}

export interface FlowImportBody {
  name?: string | null
  description?: string | null
  enabled?: boolean | null
  remark?: string | null
  editorFlowJson?: FlowEditorGraph | null
}

export interface FlowRunBody extends FlowDebugBody {}

function flowInputText(input: FlowExecutionRequest['input'] | null | undefined): string | null {
  if (typeof input === 'string') return input
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return typeof input.query === 'string' ? input.query : null
  }
  return null
}

export interface FlowDebugResult {
  ok: boolean
  mode: 'compile-preview' | 'remote-run'
  issues: FlowIssueVo[]
  input: string | null
  outputText: string | null
  outputCount: number
  durationMs: number
}

export interface FlowEngineRunEnvelope {
  scheduled: true
  jobId: string
  remoteFlowRunId?: string
  estimatedDurationMs: number
  statusUrl: string
}

export interface FlowMonitorQuery extends FlowMonitorQueryParams {}

export interface FlowResourceReferenceVo {
  id: string
  flowId: string
  nodeId: string
  componentKey: string
  resourceType: string
  resourceId: string
  resourceSubId: string | null
  resourceNameSnapshot: string | null
  resourceStatusSnapshot: string | null
  required: boolean
  invalid: boolean
  invalidReason: string | null
}

function safeParseObject<T extends Record<string, unknown>>(raw: string | null | undefined): T | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as T
      : null
  } catch {
    return null
  }
}

export interface FlowIssueVo {
  code: string
  level: 'error' | 'warning'
  message: string
  nodeId?: string
  resourceType?: string
  resourceId?: string
}

export interface FlowSummaryVo {
  id: string
  tenant: string
  name: string
  description: string | null
  compileStatus: string
  compileError: string | null
  compileRevision: string
  publishedReleaseId: string | null
  publishedRevision: string | null
  enabled: boolean | null
  remark: string | null
  /** 创建时间，Unix 毫秒时间戳，与网关标准 Pagination 等接口时间字段一致 */
  createTime: number | null
  /** 更新时间，Unix 毫秒时间戳 */
  updateTime: number | null
}

/** 与 standard/gateway `Pagination<T>` 字段一致：total、pages、currentPage、pageSize、records */
export interface FlowListPageVo {
  total: number
  pages: number
  currentPage: number
  pageSize: number
  records: FlowSummaryVo[]
}

export interface FlowDetailVo extends FlowSummaryVo {
  editorFlowJson: FlowEditorGraph
  compiledFlowJson: Record<string, unknown> | null
  componentSnapshotJson: Record<string, unknown> | null
  remoteFlowId: string | null
  remoteBindingStatus: string | null
  /** Unix 毫秒时间戳 */
  lastCompiledTime: number | null
  /** Unix 毫秒时间戳 */
  lastSyncedTime: number | null
  references: FlowResourceReferenceVo[]
}

export interface FlowExportVo {
  schemaVersion: string
  /** Unix 毫秒时间戳 */
  exportedAt: number
  flow: {
    id: string
    name: string
    description: string | null
    enabled: boolean | null
    remark: string | null
    compileStatus: string
    compileRevision: string
    publishedRevision: string | null
  }
  editorFlowJson: FlowEditorGraph
  compiledFlowJson: Record<string, unknown> | null
  componentSnapshotJson: Record<string, unknown> | null
}

interface CompiledFlowResult {
  compiledGraph: CubeFlowGraph
  componentSnapshot: Record<string, unknown>
  refs: Array<{
    nodeId: string
    componentKey: string
    resourceType: string
    resourceId: string
    resourceSubId: string | null
    resourceNameSnapshot: string | null
    resourceStatusSnapshot: string | null
    required: boolean
  }>
  /** 编译期图级问题（如语言模型租户端点不可用） */
  extraIssues: FlowIssueVo[]
}

function entityDateToTimestampMs(value: Date | string | null | undefined): number | null {
  if (value == null) {
    return null
  }
  const d = value instanceof Date ? value : new Date(value)
  const ms = d.getTime()
  return Number.isFinite(ms) ? ms : null
}

function safeParseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    return parsed != null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const DEBUG_OUTPUT_TEXT_PRIORITY_KEYS = [
  'text',
  'content',
  'markdown',
  'md',
  'answer',
  'message',
  'output',
  'result',
  'value',
]

const DEBUG_OUTPUT_META_KEYS = new Set([
  'type',
  'mime',
  'mimeType',
  'mime_type',
  'contentType',
  'content_type',
  'format',
  'extension',
])

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function deepFindDebugOutputText(value: unknown, depth = 0): string | null {
  if (depth > 18 || value == null) {
    return null
  }
  const direct = nonEmptyString(value)
  if (direct != null) {
    return direct
  }
  if (typeof value !== 'object') {
    return null
  }
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i -= 1) {
      const text = deepFindDebugOutputText(value[i], depth + 1)
      if (text != null) {
        return text
      }
    }
    return null
  }

  const record = value as Record<string, unknown>
  for (const key of DEBUG_OUTPUT_TEXT_PRIORITY_KEYS) {
    const item = record[key]
    const text = nonEmptyString(item)
    if (text != null) {
      return text
    }
    const nested = deepFindDebugOutputText(item, depth + 1)
    if (nested != null) {
      return nested
    }
  }
  for (const [key, item] of Object.entries(record)) {
    if (DEBUG_OUTPUT_META_KEYS.has(key) || item == null || typeof item !== 'object') {
      continue
    }
    const text = deepFindDebugOutputText(item, depth + 1)
    if (text != null) {
      return text
    }
  }
  for (const [key, item] of Object.entries(record)) {
    if (DEBUG_OUTPUT_META_KEYS.has(key)) {
      continue
    }
    const text = deepFindDebugOutputText(item, depth + 1)
    if (text != null) {
      return text
    }
  }
  return null
}

function extractPrimaryDebugMessage(vertex: unknown): string | null {
  if (vertex == null || typeof vertex !== 'object') {
    return null
  }
  const results = (vertex as Record<string, unknown>).results
  if (results == null || typeof results !== 'object' || Array.isArray(results)) {
    return null
  }
  return deepFindDebugOutputText((results as Record<string, unknown>).message)
}

function debugRunOutputCount(response: RunResponse | null): number {
  const outputs = (response?.raw as { outputs?: unknown[] } | null | undefined)?.outputs
  return Array.isArray(outputs) ? outputs.length : 0
}

function extractDebugOutputText(response: RunResponse | null): string | null {
  if (response == null || typeof response !== 'object') {
    return null
  }
  const raw = (response as Record<string, unknown>).raw
  if (raw == null || typeof raw !== 'object') {
    return deepFindDebugOutputText(response)
  }
  const outputs = (raw as Record<string, unknown>).outputs
  if (!Array.isArray(outputs)) {
    return deepFindDebugOutputText(response)
  }
  for (let batchIndex = outputs.length - 1; batchIndex >= 0; batchIndex -= 1) {
    const batch = outputs[batchIndex]
    if (batch == null || typeof batch !== 'object') {
      continue
    }
    const innerOutputs = (batch as Record<string, unknown>).outputs
    if (!Array.isArray(innerOutputs)) {
      continue
    }
    for (let itemIndex = innerOutputs.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = innerOutputs[itemIndex]
      const primary = extractPrimaryDebugMessage(item)
      if (primary != null) {
        return primary
      }
      const fallback = deepFindDebugOutputText(item)
      if (fallback != null) {
        return fallback
      }
    }
  }
  return null
}

function normalizeGraph(input?: FlowEditorGraph | null): FlowEditorGraph {
  return {
    schemaVersion: input?.schemaVersion ?? 'ai-application-flow/v1',
    nodes: Array.isArray(input?.nodes) ? input.nodes : [],
    edges: Array.isArray(input?.edges) ? input.edges : [],
    metadata: input?.metadata ?? {},
  }
}

function assertEditorGraphWithinLimits(editorFlow: FlowEditorGraph): void {
  if (editorFlow.nodes.length > MAX_EDITOR_FLOW_NODES) {
    throw new BadRequestException(`流程节点不能超过 ${MAX_EDITOR_FLOW_NODES} 个`)
  }
  if (editorFlow.edges.length > MAX_EDITOR_FLOW_EDGES) {
    throw new BadRequestException(`流程连线不能超过 ${MAX_EDITOR_FLOW_EDGES} 条`)
  }
}

function isMissingRequiredValue(value: unknown): boolean {
  if (value == null) {
    return true
  }
  if (typeof value === 'string') {
    return value.trim() === ''
  }
  if (Array.isArray(value)) {
    return value.every((item) => isMissingRequiredValue(item))
  }
  return false
}

/** 节点是否在画布拓扑中出现（任一端点为该节点）。未连线的占位节点不校验 presentationSchema 必填，避免阻塞保存。 */
function editorFlowNodeHasIncidentEdge(editorFlow: FlowEditorGraph, nodeId: string): boolean {
  return editorFlow.edges.some((edge) => edge.source === nodeId || edge.target === nodeId)
}

function semanticSourcePort(nodeId: string, outputName: string): string {
  return `cube.sp/o/${nodeId}/${outputName}`
}

function semanticTargetPort(nodeId: string, fieldName: string): string {
  return `cube.sp/i/${nodeId}/${fieldName}`
}

function parseEditorEdgeInputBasename(rawTargetPort: string | null | undefined): string {
  const t = rawTargetPort?.trim() ?? ''
  if (t === '' || t === 'input') {
    return ''
  }
  if (t.startsWith('cube.sp/i/')) {
    const m = /^cube\.sp\/i\/[^/]+\/(.+)$/.exec(t)
    return m?.[1]?.trim() ?? ''
  }
  return t.replace(/^i(:|-)/, '').trim()
}

function isLanguageModelInputEdge(edge: FlowEditorEdge): boolean {
  const targetInput = parseEditorEdgeInputBasename(edge.targetPort)
  return targetInput === '' || targetInput === 'input'
}

function normalizeModelTypes(raw: string | null | undefined): string[] {
  return (raw ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
}

function supportsMultimodalLanguageModelInput(rt: LanguageModelRuntimeConfig | undefined): boolean {
  return rt != null && rt.providerType !== 'unsupported' && rt.supportsMultimodalInput === true
}

/** cube-ai 自定义组件模板展示名（list 去重 upsert） */
const LM_CUBE_AI_TEMPLATE_DISPLAY_OPENAI_TEXT = 'Ai Application · Language Model (OpenAI-compatible Text)'
const LM_CUBE_AI_TEMPLATE_DISPLAY_OPENAI_VISION = 'Ai Application · Language Model (OpenAI-compatible Vision)'
const LM_CUBE_AI_TEMPLATE_DISPLAY_AZURE_TEXT = 'Ai Application · Language Model (Azure OpenAI Text)'
const LM_CUBE_AI_TEMPLATE_DISPLAY_AZURE_VISION = 'Ai Application · Language Model (Azure OpenAI Vision)'
const IMAGE_GEN_CUBE_AI_TEMPLATE_DISPLAY_DASHSCOPE = 'Ai Application · Image Generation (DashScope)'
const IMAGE_GEN_CUBE_AI_TEMPLATE_DISPLAY_OPENAI = 'Ai Application · Image Generation (OpenAI)'

@Injectable()
export class FlowService {
  public constructor(
    private readonly flowRepository: FlowStudioFlowRepository,
    private readonly flowResourceRefRepository: FlowStudioResourceRefRepository,
    private readonly flowReleaseRepository: FlowStudioReleaseRepository,
    private readonly flowComponentService: FlowComponentService,
    private readonly tenantLlmModelRepository: TenantLlmModelRepository,
    private readonly tenantLlmProviderRepository: TenantLlmProviderRepository,
    private readonly engine: FlowEngineBridge,
  ) {}

  private currentTenant(): string {
    const tenant = currentTenantId()?.trim() ?? ''
    if (!tenant) {
      throw new BadRequestException('当前租户不能为空')
    }
    return tenant
  }

  private parseConfig(node: FlowEditorNode): Record<string, unknown> {
    const data = node.data
    if (data == null || typeof data !== 'object') {
      return {}
    }
    const raw = data as Record<string, unknown>
    const config = raw.config
    if (config != null && typeof config === 'object' && !Array.isArray(config)) {
      const base = { ...(config as Record<string, unknown>) }
      /** 个别持久化/导入路径曾把 `routes` 放在 data 顶层；编译须读到与画布一致的条数 */
      const routesTop = raw.routes
      if (base.routes == null && Array.isArray(routesTop) && routesTop.length > 0) {
        base.routes = routesTop
      }
      return base
    }
    return raw as Record<string, unknown>
  }

  private readStringArray(config: Record<string, unknown>, key: string): string[] {
    const value = config[key]
    if (!Array.isArray(value)) {
      return []
    }
    return value.map((item) => String(item)).filter((item) => item.trim() !== '')
  }

  /**
   * `component_snapshot_json`（编译时写入）记录当时每个 componentKey 对应的 `cube.lf.*` mappingTarget。
   * 推送到 cube-ai 时应用该快照覆盖当前租户组件表里的 mappingTarget，避免库数据被误改后与已编译的
   * `compiled_flow_json`、语义边不一致；画布仍用自有 componentKey，仅导出层对齐 cube-ai。
   */
  private applyCompileSnapshotToComponentMap(
    base: Map<string, FlowComponentCatalogItem>,
    snapshotJson: string | null | undefined,
    editorFlow: FlowEditorGraph,
  ): Map<string, FlowComponentCatalogItem> {
    const root = safeParseJson(snapshotJson ?? null)
    if (!root) {
      return base
    }
    const items = root.items
    if (!Array.isArray(items) || items.length === 0) {
      return base
    }
    const keysUsed = new Set(editorFlow.nodes.map((node) => node.componentKey))
    const out = new Map(base)
    for (const raw of items) {
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        continue
      }
      const row = raw as Record<string, unknown>
      const ck = typeof row.componentKey === 'string' ? row.componentKey.trim() : ''
      if (!ck || !keysUsed.has(ck)) {
        continue
      }
      const mt = typeof row.mappingTarget === 'string' ? row.mappingTarget.trim() : ''
      if (!mt.startsWith('cube.lf.')) {
        continue
      }
      const existing = out.get(ck)
      if (!existing) {
        continue
      }
      if (existing.mappingTarget === mt) {
        continue
      }
      out.set(ck, { ...existing, mappingTarget: mt })
    }
    return out
  }

  /**
   * cube-ai 的 `cube.lf.SmartRouter` 通过图上的边关联语言模型；compile/sync 前为每个智能路由注入「伴侣」语言模型节点并连线。
   */
  private expandEditorFlowForCubeAi(
    editorFlow: FlowEditorGraph,
    runtimeContext: FlowRuntimeContext = {},
  ): FlowEditorGraph {
    const extraNodes: FlowEditorNode[] = []
    const extraEdges: FlowEditorEdge[] = []
    const existingIds = new Set(editorFlow.nodes.map((n) => n.id))
    for (const node of editorFlow.nodes) {
      if (node.componentKey !== 'smart-router') {
        continue
      }
      const companionId = smartRouterCompanionLlmNodeId(node.id)
      if (existingIds.has(companionId)) {
        continue
      }
      existingIds.add(companionId)
      const cfg = this.parseConfig(node)
      extraNodes.push({
        id: companionId,
        componentKey: 'language-model',
        label: null,
        position: { x: (node.position?.x ?? 0) - 380, y: node.position?.y ?? 0 },
        data: { config: extractSmartRouterCompanionLlmEditorConfig(cfg) },
      })
      extraEdges.push({
        id: `__aiapp_sr_lm_edge__${node.id}`,
        source: companionId,
        target: node.id,
        sourcePort: 'o-model',
        targetPort: `i-${CUBE_SMART_ROUTER_MODEL_INPUT}`,
      })
    }
    for (const node of editorFlow.nodes) {
      if (node.componentKey !== 'agent') {
        continue
      }
      const companionId = agentCompanionLlmNodeId(node.id)
      if (existingIds.has(companionId)) {
        continue
      }
      existingIds.add(companionId)
      const cfg = this.parseConfig(node)
      extraNodes.push({
        id: companionId,
        componentKey: 'language-model',
        label: null,
        position: { x: (node.position?.x ?? 0) - 380, y: node.position?.y ?? 0 },
        data: { config: extractAgentCompanionLlmEditorConfig(cfg) },
      })
      extraEdges.push({
        id: `__aiapp_agent_lm_edge__${node.id}`,
        source: companionId,
        target: node.id,
        sourcePort: 'o-model',
        targetPort: `i-${CUBE_AGENT_MODEL_INPUT}`,
      })
    }
    for (const node of editorFlow.nodes) {
      if (node.componentKey !== 'agent') {
        continue
      }
      const cfg = this.parseConfig(node)
      const mcpPayload = parseAgentMcpServiceConfig(cfg)
      if (!mcpPayload) {
        continue
      }
      const mcpId = agentCompanionMcpNodeId(node.id)
      if (existingIds.has(mcpId)) {
        continue
      }
      existingIds.add(mcpId)
      extraNodes.push({
        id: mcpId,
        componentKey: 'mcp',
        label: null,
        position: { x: (node.position?.x ?? 0) - 760, y: (node.position?.y ?? 0) + 140 },
        data: { config: buildMcpToolsSyntheticCubeConfigFromAgentPayload(mcpPayload) },
      })
      extraEdges.push({
        id: `${AGENT_MCP_SYNTHETIC_EDGE_PREFIX}${node.id}`,
        source: mcpId,
        target: node.id,
        sourcePort: 'o-component_as_tool',
        targetPort: 'i-tools',
      })
    }
    const expandedFlow = {
      ...editorFlow,
      nodes: [...editorFlow.nodes, ...extraNodes],
      edges: [...editorFlow.edges, ...extraEdges],
    }
    return this.expandMultimodalMessageMergeNodes(expandedFlow, runtimeContext)
  }

  private expandMultimodalMessageMergeNodes(
    editorFlow: FlowEditorGraph,
    runtimeContext: FlowRuntimeContext,
  ): FlowEditorGraph {
    const nodeById = new Map(editorFlow.nodes.map((node) => [node.id, node]))
    const reverseEdgesByTarget = new Map<string, FlowEditorEdge[]>()
    for (const edge of editorFlow.edges) {
      const list = reverseEdgesByTarget.get(edge.target) ?? []
      list.push(edge)
      reverseEdgesByTarget.set(edge.target, list)
    }

    const findChatInputAncestors = (startNodeId: string): Set<string> => {
      const out = new Set<string>()
      const visited = new Set<string>()
      const stack = [startNodeId]
      while (stack.length > 0) {
        const current = stack.pop()
        if (!current || visited.has(current)) {
          continue
        }
        visited.add(current)
        const incoming = reverseEdgesByTarget.get(current) ?? []
        for (const edge of incoming) {
          const sourceNode = nodeById.get(edge.source)
          if (!sourceNode) {
            continue
          }
          if (sourceNode.componentKey === 'chat-input') {
            out.add(sourceNode.id)
          }
          stack.push(sourceNode.id)
        }
      }
      return out
    }

    const extraNodes: FlowEditorNode[] = []
    const extraEdges: FlowEditorEdge[] = []
    const removedEdgeIds = new Set<string>()
    const existingNodeIds = new Set(editorFlow.nodes.map((node) => node.id))

    for (const node of editorFlow.nodes) {
      if (node.componentKey !== 'language-model') {
        continue
      }
      if (
        isSmartRouterCompanionLanguageModelNodeId(node.id) ||
        isAgentCompanionLanguageModelNodeId(node.id)
      ) {
        continue
      }
      if (!supportsMultimodalLanguageModelInput(runtimeContext.languageModelRuntimeByNodeId?.get(node.id))) {
        continue
      }
      const inputEdges = editorFlow.edges.filter((edge) => edge.target === node.id && isLanguageModelInputEdge(edge))
      if (inputEdges.length === 0) {
        continue
      }
      if (inputEdges.length > 1) {
        throw new BadRequestException(`语言模型节点 ${node.id} 的 input 输入连线不唯一，无法稳定合并多模态输入`)
      }
      const inputEdge = inputEdges[0]!
      const sourceNode = nodeById.get(inputEdge.source)
      if (sourceNode?.componentKey === 'chat-input') {
        continue
      }
      const chatInputs = findChatInputAncestors(inputEdge.source)
      if (chatInputs.size === 0) {
        continue
      }
      if (chatInputs.size > 1) {
        throw new BadRequestException(
          `语言模型节点 ${node.id} 的多模态输入来源不唯一：${Array.from(chatInputs).join(', ')}`,
        )
      }
      const chatInputId = Array.from(chatInputs)[0]!
      const mergeNodeId = `__aiapp_mm_merge__${chatInputId}__${node.id}`
      if (!existingNodeIds.has(mergeNodeId)) {
        existingNodeIds.add(mergeNodeId)
        extraNodes.push({
          id: mergeNodeId,
          componentKey: MULTIMODAL_MESSAGE_MERGE_COMPONENT_KEY,
          label: null,
          position: {
            x: ((sourceNode?.position?.x ?? 0) + (node.position?.x ?? 0)) / 2,
            y: ((sourceNode?.position?.y ?? 0) + (node.position?.y ?? 0)) / 2,
          },
          data: { config: {} },
        })
      }
      removedEdgeIds.add(inputEdge.id)
      extraEdges.push({
        id: `__aiapp_mm_text_edge__${inputEdge.id}`,
        source: inputEdge.source,
        target: mergeNodeId,
        sourcePort: inputEdge.sourcePort ?? null,
        targetPort: 'i-text',
      })
      extraEdges.push({
        id: `__aiapp_mm_original_edge__${chatInputId}__${node.id}`,
        source: chatInputId,
        target: mergeNodeId,
        sourcePort: 'o-message',
        targetPort: 'i-original_message',
      })
      extraEdges.push({
        id: `__aiapp_mm_to_lm_edge__${mergeNodeId}`,
        source: mergeNodeId,
        target: node.id,
        sourcePort: 'o-message',
        targetPort: inputEdge.targetPort ?? 'i-input',
      })
    }

    if (extraNodes.length === 0 && extraEdges.length === 0) {
      return editorFlow
    }
    return {
      ...editorFlow,
      nodes: [...editorFlow.nodes, ...extraNodes],
      edges: [...editorFlow.edges.filter((edge) => !removedEdgeIds.has(edge.id)), ...extraEdges],
    }
  }

  private chatInputAncestorsForLanguageModelInput(editorFlow: FlowEditorGraph, nodeId: string): Set<string> {
    const nodeById = new Map(editorFlow.nodes.map((node) => [node.id, node]))
    const reverseEdgesByTarget = new Map<string, FlowEditorEdge[]>()
    for (const edge of editorFlow.edges) {
      const list = reverseEdgesByTarget.get(edge.target) ?? []
      list.push(edge)
      reverseEdgesByTarget.set(edge.target, list)
    }
    const out = new Set<string>()
    const inputEdges = editorFlow.edges.filter((edge) => edge.target === nodeId && isLanguageModelInputEdge(edge))
    const stack = inputEdges.map((edge) => edge.source)
    const visited = new Set<string>()
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current || visited.has(current)) {
        continue
      }
      visited.add(current)
      const currentNode = nodeById.get(current)
      if (currentNode?.componentKey === 'chat-input') {
        out.add(current)
      }
      for (const edge of reverseEdgesByTarget.get(current) ?? []) {
        stack.push(edge.source)
      }
    }
    return out
  }

  private buildCubeFlowGraph(
    editorFlow: FlowEditorGraph,
    componentMap: Map<string, FlowComponentCatalogItem>,
    runtimeContext: FlowRuntimeContext = {},
  ): {
    graph: CubeFlowGraph
    unsupportedNodes: Array<{ nodeId: string; componentKey: string; mappingTarget: string | null }>
  } {
    const expandedFlow = this.expandEditorFlowForCubeAi(editorFlow, runtimeContext)
    let nodes = expandedFlow.nodes.map((node) => buildRuntimeNode(node, componentMap.get(node.componentKey), runtimeContext))
    const editorNodeById = new Map(expandedFlow.nodes.map((n) => [n.id, n]))
    nodes = nodes.map((cubeNode) => {
      const editorNode = editorNodeById.get(cubeNode.id)
      if (!editorNode || editorNode.componentKey !== 'smart-router') {
        return cubeNode
      }
      const minRows = smartRouterCompileOutputNamesForGraph(
        this.parseConfig(editorNode),
        editorNode.id,
        expandedFlow.edges,
      ).length
      return {
        ...cubeNode,
        config: padSmartRouterCubeConfigRoutesMinRows(cubeNode.config as Record<string, unknown>, minRows),
      }
    })
    const lfIdByGraphNodeId = new Map(nodes.map((n) => [n.id, n.lfNodeId?.trim() !== '' ? (n.lfNodeId as string) : n.id]))
    const unsupportedNodes = nodes
      .filter((node) => typeof node.cubeType !== 'string' || !node.cubeType.startsWith('cube.lf.'))
      .map((node) => ({
        nodeId: node.id,
        componentKey: expandedFlow.nodes.find((item) => item.id === node.id)?.componentKey ?? node.id,
        mappingTarget: typeof node.cubeType === 'string' ? node.cubeType : null,
      }))
    const nodeMap = new Map(expandedFlow.nodes.map((node) => [node.id, node]))
    const smartRouterOutputsByNodeId = new Map<string, string[]>()
    const edges = expandedFlow.edges.map((edge) => {
      const sourceNode = nodeMap.get(edge.source)
      const targetNode = nodeMap.get(edge.target)
      const sourceComponent = sourceNode ? componentMap.get(sourceNode.componentKey) : undefined
      const targetComponent = targetNode ? componentMap.get(targetNode.componentKey) : undefined
      const mergedSrc =
        sourceNode != null
          ? mergeProtocolPortsForCompile(sourceComponent, sourceNode.componentKey, this.parseConfig(sourceNode))
          : { inputs: [], outputs: [] }
      const mergedTgt =
        targetNode != null
          ? mergeProtocolPortsForCompile(targetComponent, targetNode.componentKey, this.parseConfig(targetNode))
          : { inputs: [], outputs: [] }
      let sourceOutputs = mergedSrc.outputs
      if (sourceNode?.componentKey === 'smart-router') {
        let memo = smartRouterOutputsByNodeId.get(edge.source)
        if (memo == null) {
          memo = smartRouterCompileOutputNamesForGraph(
            this.parseConfig(sourceNode),
            edge.source,
            expandedFlow.edges,
          )
          smartRouterOutputsByNodeId.set(edge.source, memo)
        }
        sourceOutputs = memo
      }
      const targetInputs = mergedTgt.inputs
      const rawSourcePort = edge.sourcePort?.trim() ?? ''
      const strippedSource = parseEditorEdgeOutputBasename(rawSourcePort)
      const sourceOutputName =
        strippedSource !== '' && sourceOutputs.includes(strippedSource)
          ? strippedSource
          : (sourceOutputs[0] ?? 'output')
      const targetInputName =
        edge.targetPort && edge.targetPort !== 'input'
          ? edge.targetPort.replace(/^i(:|-)/, '').trim()
          : (targetInputs[0] ?? 'input')
      const sourceLf = lfIdByGraphNodeId.get(edge.source) ?? edge.source
      const targetLf = lfIdByGraphNodeId.get(edge.target) ?? edge.target
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourcePort: semanticSourcePort(sourceLf, sourceOutputName),
        targetPort: semanticTargetPort(targetLf, targetInputName),
      }
    })
    return {
      graph: {
        schemaVersion: 1,
        nodes,
        edges,
      },
      unsupportedNodes,
    }
  }

  private async buildKnowledgeDocumentRuntimeContext(editorFlow: FlowEditorGraph): Promise<Map<string, string>> {
    const bizDocumentIds = new Set<string>()
    for (const node of editorFlow.nodes) {
      if (node.componentKey !== 'knowledge-retrieval') {
        continue
      }
      const config = this.parseConfig(node)
      for (const documentId of normalizeEditorKnowledgeSources(config).map((s) => s.bizId)) {
        bizDocumentIds.add(documentId)
      }
    }
    /**
     * 换源（ADR-0014 D1）：原仓库经 `knowledge_document_mapping` 把编辑器 bizId 映射到远端 cube-ai
     * 文档 id；本仓库 kb-core 即文档权威，无映射层 —— 编辑器引用的文档 id 直接作为运行时文档 id。
     */
    const runtimeIds = new Map<string, string>()
    for (const bizDocumentId of bizDocumentIds) {
      const trimmed = bizDocumentId.trim()
      if (trimmed) {
        runtimeIds.set(bizDocumentId, trimmed)
      }
    }
    return runtimeIds
  }

  private async resolveLanguageModelRuntimeForModelId(modelId: string): Promise<LanguageModelRuntimeConfig> {
    const trimmed = modelId.trim()
    if (!trimmed) {
      return { providerType: 'unsupported', reason: 'missing_model_id' }
    }
    const model = await this.tenantLlmModelRepository.findByIdForTenant(trimmed)
    if (!model) {
      return { providerType: 'unsupported', reason: 'model_not_found' }
    }
    const provider = await this.tenantLlmProviderRepository.findByIdForTenant(model.tenant_provider_id)
    const baseUrl = model.api_base_url?.trim() || provider?.api_base_url?.trim()
    if (!provider || !baseUrl) {
      return { providerType: 'unsupported', reason: 'missing_provider_or_base_url' }
    }
    const base = baseUrl.replace(/\/+$/, '')
    const typeCode = provider.type_code
    const endpointType = model.endpoint_type?.trim() || typeCode
    const modelTypes = normalizeModelTypes(model.model_types)
    const dslSchema = safeParseObject<Record<string, unknown>>(model.dsl_schema_json)
    const requestSchema = safeParseObject<LlmRequestSchema>(model.request_schema_json)
    const responseSchema = safeParseObject<LlmResponseSchema>(model.response_schema_json)
    const wire = inferWireDefaults({
      providerTypeCode: typeCode,
      modelCode: model.model_code,
      endpointType,
      requestSchema,
    })
    const nodeKind = typeof dslSchema?.nodeKind === 'string' ? dslSchema.nodeKind.trim() : ''
    const apiKey = provider.api_key?.trim() ?? null
    const modelCode = model.model_code

    if (nodeKind === 'image_generation') {
      return { providerType: 'unsupported', reason: 'node_kind_image_generation_unsupported_in_language_model' }
    }

    if (
      modelTypes.includes('image_generation') ||
      endpointType === 'dashscope_text2image' ||
      endpointType === 'openai_image'
    ) {
      return { providerType: 'unsupported', reason: 'image_generation_model_unsupported_in_language_model' }
    }

    if (endpointType === 'azure_openai' || typeCode === 'azure_openai') {
      const chatUrl = `${base}/openai/deployments/${encodeURIComponent(modelCode)}/chat/completions?api-version=2024-10-21`
      return {
        providerType: 'azure_openai',
        apiBaseUrl: base,
        chatUrl,
        apiKey,
        modelCode,
        requestSchema,
        responseSchema,
        nativeFamily: wire.nativeFamily,
        channelProfile: wire.channelProfile,
        adapterKey: wire.adapterKey,
        supportsMultimodalInput: modelTypes.includes('vision'),
      }
    }

    if (
      endpointType === 'openai' ||
      endpointType === 'openai_response' ||
      endpointType === 'new_api' ||
      endpointType === 'openai_image' ||
      endpointType === 'jina_rerank' ||
      typeCode === 'dashscope' ||
      typeCode === 'volcengine_ark' ||
      typeCode === 'geekai'
    ) {
      const chatUrl = `${base}/chat/completions`
      return {
        providerType: 'openai_compatible',
        apiBaseUrl: base,
        chatUrl,
        apiKey,
        modelCode,
        requestSchema,
        responseSchema,
        nativeFamily: wire.nativeFamily,
        channelProfile: wire.channelProfile,
        adapterKey: wire.adapterKey,
        supportsMultimodalInput: modelTypes.includes('vision'),
      }
    }

    if (typeCode === 'ollama') {
      const root = base.replace(/\/+$/, '')
      const chatUrl = `${root}/v1/chat/completions`
      return {
        providerType: 'openai_compatible',
        apiBaseUrl: base,
        chatUrl,
        apiKey,
        modelCode,
        requestSchema,
        responseSchema,
        nativeFamily: wire.nativeFamily,
        channelProfile: wire.channelProfile,
        adapterKey: wire.adapterKey,
        supportsMultimodalInput: modelTypes.includes('vision'),
      }
    }

    return { providerType: 'unsupported', reason: `provider_type_${endpointType}` }
  }

  private async resolveImageGenerationRuntimeForModelId(modelId: string): Promise<ImageGenerationRuntimeConfig> {
    const trimmed = modelId.trim()
    if (!trimmed) {
      return { providerType: 'unsupported', reason: 'missing_model_id' }
    }
    const model = await this.tenantLlmModelRepository.findByIdForTenant(trimmed)
    if (!model) {
      return { providerType: 'unsupported', reason: 'model_not_found' }
    }
    const provider = await this.tenantLlmProviderRepository.findByIdForTenant(model.tenant_provider_id)
    const baseUrl = model.api_base_url?.trim() || provider?.api_base_url?.trim()
    if (!provider || !baseUrl) {
      return { providerType: 'unsupported', reason: 'missing_provider_or_base_url' }
    }
    const base = baseUrl.replace(/\/+$/, '')
    const endpointType = model.endpoint_type?.trim() || provider.type_code
    const modelTypes = model.model_types.split(',').map((item) => item.trim()).filter(Boolean)
    const dslSchema = safeParseObject<Record<string, unknown>>(model.dsl_schema_json)
    const requestSchema = safeParseObject<LlmRequestSchema>(model.request_schema_json)
    const responseSchema = safeParseObject<LlmResponseSchema>(model.response_schema_json)
    const wire = inferWireDefaults({
      providerTypeCode: provider.type_code,
      modelCode: model.model_code,
      endpointType,
      requestSchema,
    })
    const nodeKind = typeof dslSchema?.nodeKind === 'string' ? dslSchema.nodeKind.trim() : ''

    if (nodeKind === 'language_model') {
      return { providerType: 'unsupported', reason: 'node_kind_language_model_unsupported_in_image_generation' }
    }

    const imageCapable =
      nodeKind === 'image_generation' ||
      modelTypes.includes('image_generation') ||
      endpointType === 'dashscope_text2image' ||
      endpointType === 'openai_image'
    if (!imageCapable) {
      return { providerType: 'unsupported', reason: 'model_not_image_generation_capable' }
    }

    if (endpointType === 'dashscope_text2image' || provider.type_code === 'dashscope') {
      const generationUrl = `${base}/api/v1/services/aigc/multimodal-generation/generation`
      return {
        providerType: 'dashscope_text2image',
        apiBaseUrl: base,
        generationUrl,
        apiKey: provider.api_key?.trim() ?? null,
        modelCode: model.model_code,
        requestSchema,
        responseSchema,
        nativeFamily: wire.nativeFamily,
        channelProfile: wire.channelProfile,
        adapterKey: wire.adapterKey,
      }
    }

    if (
      endpointType === 'openai_image' ||
      provider.type_code === 'volcengine_ark' ||
      provider.type_code === 'geekai' ||
      ((provider.type_code === 'openai' || provider.type_code === 'new_api') && modelTypes.includes('image_generation'))
    ) {
      return {
        providerType: 'openai_image',
        apiBaseUrl: base,
        generationUrl: resolveOpenAiImagesGenerationUrl(base),
        apiKey: provider.api_key?.trim() ?? null,
        modelCode: model.model_code,
        requestSchema,
        responseSchema,
        nativeFamily: wire.nativeFamily,
        channelProfile: wire.channelProfile,
        adapterKey: wire.adapterKey,
      }
    }

    return { providerType: 'unsupported', reason: `provider_type_${endpointType}` }
  }

  /**
   * 解析语言模型节点及智能路由伴侣 LLM 绑定的租户模型与供应商，生成 cube-ai CustomComponent DSL 所需的 chat URL（OpenAI 兼容或 Azure）。
   */
  private async buildLanguageModelRuntimeContext(editorFlow: FlowEditorGraph): Promise<
    Map<string, LanguageModelRuntimeConfig>
  > {
    const out = new Map<string, LanguageModelRuntimeConfig>()
    for (const node of editorFlow.nodes) {
      if (node.componentKey === 'language-model') {
        const config = this.parseConfig(node)
        const modelId = typeof config.modelId === 'string' ? config.modelId.trim() : ''
        out.set(node.id, await this.resolveLanguageModelRuntimeForModelId(modelId))
        continue
      }
      if (node.componentKey === 'smart-router') {
        const config = this.parseConfig(node)
        const modelId = typeof config.modelId === 'string' ? config.modelId.trim() : ''
        const companionId = smartRouterCompanionLlmNodeId(node.id)
        out.set(companionId, await this.resolveLanguageModelRuntimeForModelId(modelId))
        continue
      }
      if (node.componentKey === 'agent') {
        const config = this.parseConfig(node)
        const modelId = typeof config.modelId === 'string' ? config.modelId.trim() : ''
        const companionId = agentCompanionLlmNodeId(node.id)
        out.set(companionId, await this.resolveLanguageModelRuntimeForModelId(modelId))
      }
    }
    return out
  }

  private async buildImageGenerationRuntimeContext(
    editorFlow: FlowEditorGraph,
  ): Promise<Map<string, ImageGenerationRuntimeConfig>> {
    const out = new Map<string, ImageGenerationRuntimeConfig>()
    for (const node of editorFlow.nodes) {
      if (node.componentKey !== 'image-generation') {
        continue
      }
      const config = this.parseConfig(node)
      const modelId = typeof config.modelId === 'string' ? config.modelId.trim() : ''
      out.set(node.id, await this.resolveImageGenerationRuntimeForModelId(modelId))
    }
    return out
  }

  private async upsertCubeAiLanguageModelCustomTemplate(
    client: FlowEngineBridge,
    displayName: string,
    dsl: Record<string, unknown>,
  ): Promise<string> {
    await client.validateCustomComponentTemplateDsl({ dsl })
    const { templates } = await client.listCustomComponentTemplates()
    const dslMetaName =
      typeof (dsl.metadata as Record<string, unknown> | undefined)?.name === 'string'
        ? String((dsl.metadata as Record<string, unknown>).name).trim()
        : ''
    const existing = templates?.find((item) => {
      if (item.displayName === displayName) {
        return true
      }
      if (dslMetaName === '') {
        return false
      }
      const row = item as unknown as Record<string, unknown>
      return row.name === dslMetaName || row.componentName === dslMetaName
    })
    if (existing?.id) {
      await client.updateCustomComponentTemplate(existing.id, { dsl })
      return existing.id
    }
    const created = await client.createCustomComponentTemplate({ dsl, displayName })
    const id = created.id?.trim() ?? ''
    if (!id) {
      throw new Error('cube-ai 创建语言模型自定义组件模板未返回 id')
    }
    return id
  }

  /**
   * 在 cube-ai 项目下注册/更新语言模型 DSL 模板（POST/PUT custom-component-templates），供模板库与节点 `cube_custom_template_id` 关联。
   * 画布上只要存在「语言模型」节点即 upsert OpenAI 兼容模板；解析到 Azure OpenAI 时再 upsert Azure 模板。
   * 失败时仅打日志，仍依赖节点内联 `cube_dsl` 由 cube-ai 侧消费。
   */
  private async ensureLanguageModelCubeAiTemplates(
    client: FlowEngineBridge,
    editorFlow: FlowEditorGraph,
    languageModelRuntimeByNodeId: Map<string, LanguageModelRuntimeConfig>,
  ): Promise<{ openaiText?: string; openaiVision?: string; azureText?: string; azureVision?: string }> {
    let needOpenAiText = false
    let needOpenAiVision = false
    let needAzureText = false
    let needAzureVision = false
    const markTemplateNeed = (rt: LanguageModelRuntimeConfig | undefined): void => {
      if (!rt || rt.providerType === 'unsupported') {
        needOpenAiText = true
        return
      }
      const supportsVision = supportsMultimodalLanguageModelInput(rt)
      if (rt.providerType === 'azure_openai') {
        if (supportsVision) {
          needAzureVision = true
        } else {
          needAzureText = true
        }
        return
      }
      if (supportsVision) {
        needOpenAiVision = true
      } else {
        needOpenAiText = true
      }
    }
    for (const node of editorFlow.nodes) {
      if (node.componentKey === 'language-model') {
        markTemplateNeed(languageModelRuntimeByNodeId.get(node.id))
        continue
      }
      if (node.componentKey === 'smart-router') {
        const config = this.parseConfig(node)
        if (typeof config.modelId !== 'string' || config.modelId.trim() === '') {
          continue
        }
        const rt = languageModelRuntimeByNodeId.get(smartRouterCompanionLlmNodeId(node.id))
        markTemplateNeed(rt)
        continue
      }
      if (node.componentKey === 'agent') {
        const config = this.parseConfig(node)
        if (typeof config.modelId !== 'string' || config.modelId.trim() === '') {
          continue
        }
        const rt = languageModelRuntimeByNodeId.get(agentCompanionLlmNodeId(node.id))
        markTemplateNeed(rt)
      }
    }
    const out: { openaiText?: string; openaiVision?: string; azureText?: string; azureVision?: string } = {}
    try {
      if (needOpenAiText) {
        out.openaiText = await this.upsertCubeAiLanguageModelCustomTemplate(
          client,
          LM_CUBE_AI_TEMPLATE_DISPLAY_OPENAI_TEXT,
          buildLanguageModelDslOpenAi({ supportsMultimodalInput: false }),
        )
      }
      if (needOpenAiVision) {
        out.openaiVision = await this.upsertCubeAiLanguageModelCustomTemplate(
          client,
          LM_CUBE_AI_TEMPLATE_DISPLAY_OPENAI_VISION,
          buildLanguageModelDslOpenAi({ supportsMultimodalInput: true }),
        )
      }
      if (needAzureText) {
        out.azureText = await this.upsertCubeAiLanguageModelCustomTemplate(
          client,
          LM_CUBE_AI_TEMPLATE_DISPLAY_AZURE_TEXT,
          buildLanguageModelDslAzure({ supportsMultimodalInput: false }),
        )
      }
      if (needAzureVision) {
        out.azureVision = await this.upsertCubeAiLanguageModelCustomTemplate(
          client,
          LM_CUBE_AI_TEMPLATE_DISPLAY_AZURE_VISION,
          buildLanguageModelDslAzure({ supportsMultimodalInput: true }),
        )
      }
      if (needOpenAiText || needOpenAiVision || needAzureText || needAzureVision) {
        console.info(
          `[ai-application] cube-ai 已调用 custom-component-templates：` +
            `openaiText=${out.openaiText ?? '—'} openaiVision=${out.openaiVision ?? '—'} ` +
            `azureText=${out.azureText ?? '—'} azureVision=${out.azureVision ?? '—'}`,
        )
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.warn(`[ai-application] cube-ai 语言模型自定义模板 upsert 失败（仍将推送内联 cube_dsl）: ${msg}`)
    }
    return out
  }

  private async ensureImageGenerationCubeAiTemplates(
    client: FlowEngineBridge,
    editorFlow: FlowEditorGraph,
    imageGenerationRuntimeByNodeId: Map<string, ImageGenerationRuntimeConfig>,
  ): Promise<{ dashscope?: string; openai?: string }> {
    const needsTemplate = editorFlow.nodes.some((node) => node.componentKey === 'image-generation')
    if (!needsTemplate) {
      return {}
    }
    let needDashscope = false
    let needOpenAi = false
    for (const node of editorFlow.nodes) {
      if (node.componentKey !== 'image-generation') {
        continue
      }
      const rt = imageGenerationRuntimeByNodeId.get(node.id)
      if (rt && rt.providerType === 'dashscope_text2image') {
        needDashscope = true
      }
      if (rt && rt.providerType === 'openai_image') {
        needOpenAi = true
      }
    }
    const out: { dashscope?: string; openai?: string } = {}
    try {
      if (needDashscope) {
        out.dashscope = await this.upsertCubeAiLanguageModelCustomTemplate(
          client,
          IMAGE_GEN_CUBE_AI_TEMPLATE_DISPLAY_DASHSCOPE,
          buildImageGenerationDslDashscope(),
        )
      }
      if (needOpenAi) {
        out.openai = await this.upsertCubeAiLanguageModelCustomTemplate(
          client,
          IMAGE_GEN_CUBE_AI_TEMPLATE_DISPLAY_OPENAI,
          buildImageGenerationDslOpenAi(),
        )
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.warn(`[ai-application] cube-ai 文生图自定义模板 upsert 失败（仍将推送内联 cube_dsl）: ${msg}`)
    }
    return out
  }

  private async buildCompiledFlow(
    editorFlow: FlowEditorGraph,
    componentMap: Map<string, FlowComponentCatalogItem>,
  ): Promise<CompiledFlowResult> {
    const languageModelRuntimeByNodeId = await this.buildLanguageModelRuntimeContext(editorFlow)
    const imageGenerationRuntimeByNodeId = await this.buildImageGenerationRuntimeContext(editorFlow)
    const cubeGraph = this.buildCubeFlowGraph(editorFlow, componentMap, {
      languageModelRuntimeByNodeId,
      imageGenerationRuntimeByNodeId,
    })
    const refs: CompiledFlowResult['refs'] = []
    for (const node of editorFlow.nodes) {
      const config = this.parseConfig(node)
      const component = componentMap.get(node.componentKey)
      if (!component) {
        continue
      }
      const modelId = typeof config.modelId === 'string' ? config.modelId.trim() : ''
      const routedModelIds = this.readStringArray(config, 'modelIds')
      const routedDedup = new Set<string>()
      for (const routedModelId of routedModelIds) {
        if (routedModelId !== '' && routedModelId !== modelId) {
          routedDedup.add(routedModelId)
        }
      }
      if (modelId !== '') {
        refs.push({
          nodeId: node.id,
          componentKey: node.componentKey,
          resourceType: 'llm-model',
          resourceId: modelId,
          resourceSubId: null,
          resourceNameSnapshot: null,
          resourceStatusSnapshot: null,
          required: true,
        })
      }
      for (const routedModelId of routedDedup) {
        refs.push({
          nodeId: node.id,
          componentKey: node.componentKey,
          resourceType: 'llm-model',
          resourceId: routedModelId,
          resourceSubId: null,
          resourceNameSnapshot: null,
          resourceStatusSnapshot: null,
          required: true,
        })
      }
      const knowledgeBizIds =
        node.componentKey === 'knowledge-retrieval'
          ? normalizeEditorKnowledgeSources(config).map((s) => s.bizId)
          : this.readStringArray(config, 'documentIds')
      for (const documentId of knowledgeBizIds) {
        refs.push({
          nodeId: node.id,
          componentKey: node.componentKey,
          resourceType: 'knowledge-document',
          resourceId: documentId,
          resourceSubId: null,
          resourceNameSnapshot: null,
          resourceStatusSnapshot: null,
          required: true,
        })
      }
    }
    const componentSnapshot = {
      version: 'ai-application-flow-components/v1',
      items: Array.from(componentMap.values()).map((component) => ({
        componentKey: component.componentKey,
        componentName: component.componentName,
        componentVersion: component.componentVersion,
        mappingType: component.mappingType,
        mappingTarget: component.mappingTarget,
      })),
    }
    const extraIssues: FlowIssueVo[] = []
    for (const node of editorFlow.nodes) {
      if (node.componentKey === 'language-model') {
        const rt = languageModelRuntimeByNodeId.get(node.id)
        if (rt && rt.providerType === 'unsupported') {
          extraIssues.push({
            code: 'FLOW_LANGUAGE_MODEL_UNSUPPORTED',
            level: 'error',
            message: this.languageModelRuntimeUnsupportedMessage(rt.reason),
            nodeId: node.id,
          })
        } else if (rt && !supportsMultimodalLanguageModelInput(rt)) {
          const chatInputs = this.chatInputAncestorsForLanguageModelInput(editorFlow, node.id)
          if (chatInputs.size > 0) {
            extraIssues.push({
              code: 'FLOW_MULTIMODAL_INPUT_IGNORED',
              level: 'warning',
              message: '当前语言模型不具备视觉输入能力；如果 ChatInput 上传了图片，图片不会传入该模型',
              nodeId: node.id,
            })
          }
        }
        continue
      }
      if (node.componentKey === 'image-generation') {
        const rt = imageGenerationRuntimeByNodeId.get(node.id)
        if (rt && rt.providerType === 'unsupported') {
          extraIssues.push({
            code: 'FLOW_IMAGE_GENERATION_UNSUPPORTED',
            level: 'error',
            message: this.imageGenerationRuntimeUnsupportedMessage(rt.reason),
            nodeId: node.id,
          })
        }
        continue
      }
      if (node.componentKey === 'smart-router') {
        const rt = languageModelRuntimeByNodeId.get(smartRouterCompanionLlmNodeId(node.id))
        if (rt && rt.providerType === 'unsupported') {
          extraIssues.push({
            code: 'FLOW_LANGUAGE_MODEL_UNSUPPORTED',
            level: 'error',
            message: this.languageModelRuntimeUnsupportedMessage(rt.reason),
            nodeId: node.id,
          })
        }
        continue
      }
      if (node.componentKey === 'agent') {
        const rt = languageModelRuntimeByNodeId.get(agentCompanionLlmNodeId(node.id))
        if (rt && rt.providerType === 'unsupported') {
          extraIssues.push({
            code: 'FLOW_LANGUAGE_MODEL_UNSUPPORTED',
            level: 'error',
            message: this.languageModelRuntimeUnsupportedMessage(rt.reason),
            nodeId: node.id,
          })
        }
      }
    }
    for (const u of cubeGraph.unsupportedNodes) {
      const match = editorFlow.nodes.find((item) => item.id === u.nodeId)
      if (match?.componentKey !== 'language-model') {
        continue
      }
      extraIssues.push({
        code: 'FLOW_LANGUAGE_MODEL_UNSUPPORTED',
        level: 'error',
        message:
          '语言模型节点未能绑定可用的租户端点（需 OpenAI 兼容或 Azure OpenAI，且供应商已配置 Base URL 与模型）',
        nodeId: u.nodeId,
      })
    }
    return {
      compiledGraph: cubeGraph.graph,
      componentSnapshot,
      refs,
      extraIssues,
    }
  }

  private languageModelRuntimeUnsupportedMessage(reason: string): string {
    if (reason === 'node_kind_image_generation_unsupported_in_language_model') {
      return '当前模型的 DSL 能力为文生图，不能接入语言模型节点，请改用图像生成节点'
    }
    if (reason === 'image_generation_model_unsupported_in_language_model') {
      return '文生图模型暂不支持接入当前语言模型节点，请改用文本/推理模型'
    }
    return '语言模型节点未能绑定可用的租户端点（需 OpenAI 兼容或 Azure OpenAI，且供应商已配置 Base URL 与模型）'
  }

  private imageGenerationRuntimeUnsupportedMessage(reason: string): string {
    if (reason === 'node_kind_language_model_unsupported_in_image_generation') {
      return '当前模型为文本/推理能力，不能接入图像生成节点，请改用文生图模型'
    }
    if (reason === 'model_not_image_generation_capable') {
      return '所选模型不具备文生图能力，请选择 qwen-image 等文生图模型'
    }
    return '图像生成节点未能绑定可用的租户端点（需 DashScope 文生图，且供应商已配置 Base URL 与模型）'
  }

  private validateComponentContract(
    editorFlow: FlowEditorGraph,
    componentMap: Map<string, FlowComponentCatalogItem>,
  ): FlowIssueVo[] {
    const issues: FlowIssueVo[] = []
    for (const node of editorFlow.nodes) {
      const component = componentMap.get(node.componentKey)
      if (!component) {
        issues.push({
          code: 'FLOW_COMPONENT_NOT_AVAILABLE',
          level: 'error',
          message: `节点 ${node.id} 使用的组件不可用：${node.componentKey}`,
          nodeId: node.id,
        })
        continue
      }
      const fields = Array.isArray(component.presentationSchema?.fields)
        ? (component.presentationSchema?.fields as Array<Record<string, unknown>>)
        : []
      const config = this.parseConfig(node)
      const skipRequiredContract = !editorFlowNodeHasIncidentEdge(editorFlow, node.id)
      for (const field of fields) {
        const required = Boolean(field.required)
        const fieldKey = typeof field.key === 'string' ? field.key : null
        const fieldLabel = typeof field.label === 'string' ? field.label : fieldKey
        if (!required || !fieldKey) {
          continue
        }
        if (skipRequiredContract) {
          continue
        }
        if (isMissingRequiredValue(config[fieldKey])) {
          issues.push({
            code: 'FLOW_REQUIRED_CONFIG_MISSING',
            level: 'error',
            message: `节点 ${node.id} 缺少必填配置：${fieldLabel ?? fieldKey}`,
            nodeId: node.id,
          })
        }
      }
      if (
        node.componentKey === 'knowledge-retrieval' &&
        !skipRequiredContract &&
        normalizeEditorKnowledgeSources(config).length === 0
      ) {
        issues.push({
          code: 'FLOW_REQUIRED_CONFIG_MISSING',
          level: 'error',
          message: `节点 ${node.id} 须至少选择一个知识库`,
          nodeId: node.id,
        })
      }
    }
    return issues
  }

  /**
   * 与表 uk_ai_application_flow_ref_unique_deleted(flow_id, node_id, resource_type, resource_id, deleted) 一致：
   * 不包含 resource_sub_id，同一节点同一资源只能保留一行，否则两次 INSERT 会撞唯一索引。
   */
  private dedupeRefs(refs: CompiledFlowResult['refs']): CompiledFlowResult['refs'] {
    const map = new Map<string, CompiledFlowResult['refs'][0]>()
    for (const ref of refs) {
      const key = [ref.nodeId, ref.resourceType, ref.resourceId].join('::')
      map.set(key, ref)
    }
    return [...map.values()]
  }

  private async validateResourceRefs(
    refs: CompiledFlowResult['refs'],
  ): Promise<{ issues: FlowIssueVo[]; refs: CompiledFlowResult['refs'] }> {
    const issues: FlowIssueVo[] = []
    const validatedRefs: CompiledFlowResult['refs'] = []
    for (const ref of refs) {
      if (ref.resourceType === 'llm-model') {
        const model = await this.tenantLlmModelRepository.findByIdForTenant(ref.resourceId)
        if (!model) {
          issues.push({
            code: 'FLOW_RESOURCE_MODEL_NOT_FOUND',
            level: 'error',
            message: `节点 ${ref.nodeId} 引用的模型不存在：${ref.resourceId}`,
            nodeId: ref.nodeId,
            resourceType: ref.resourceType,
            resourceId: ref.resourceId,
          })
          validatedRefs.push({ ...ref, resourceStatusSnapshot: 'missing' })
          continue
        }
        validatedRefs.push({
          ...ref,
          resourceNameSnapshot: model.display_name,
          resourceStatusSnapshot: 'active',
        })
        continue
      }
      if (ref.resourceType === 'knowledge-document') {
        /**
         * 换源（ADR-0014 D1）：原仓库经 `knowledge_document_mapping` 校验编辑器 bizId 是否存在远端
         * 映射；本仓库 kb-core 即文档权威、无映射层，编辑器引用的文档 id 直接即 kb-core 文档 id。
         * 这里按权威下放：不再做映射存在性硬校验（缺失文档由 kb-core 侧检索时拒绝），仅快照引用 id。
         */
        validatedRefs.push({
          ...ref,
          resourceNameSnapshot: ref.resourceNameSnapshot ?? ref.resourceId,
          resourceStatusSnapshot: 'active',
        })
        continue
      }
      validatedRefs.push(ref)
    }
    return { issues, refs: validatedRefs }
  }

  private validateGraphShape(editorFlow: FlowEditorGraph): FlowIssueVo[] {
    const issues: FlowIssueVo[] = []
    const nodeIds = new Set<string>()
    for (const node of editorFlow.nodes) {
      if (!node.id?.trim()) {
        issues.push({ code: 'FLOW_NODE_ID_EMPTY', level: 'error', message: '存在未填写节点ID的节点' })
        continue
      }
      if (nodeIds.has(node.id)) {
        issues.push({ code: 'FLOW_NODE_ID_DUPLICATED', level: 'error', message: `节点ID重复：${node.id}`, nodeId: node.id })
      }
      nodeIds.add(node.id)
      if (!node.componentKey?.trim()) {
        issues.push({ code: 'FLOW_COMPONENT_KEY_EMPTY', level: 'error', message: `节点 ${node.id} 缺少组件类型`, nodeId: node.id })
      }
    }
    for (const edge of editorFlow.edges) {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        issues.push({
          code: 'FLOW_EDGE_NODE_MISSING',
          level: 'error',
          message: `边 ${edge.id} 引用的节点不存在`,
        })
      }
    }
    if (editorFlow.nodes.length === 0) {
      issues.push({ code: 'FLOW_EMPTY', level: 'error', message: '流程节点不能为空' })
    }
    return issues
  }

  private async toReferenceVo(ref: FlowStudioResourceRefRow): Promise<FlowResourceReferenceVo> {
    return {
      id: String(ref.id),
      flowId: String(ref.flow_id),
      nodeId: ref.node_id,
      componentKey: ref.component_key,
      resourceType: ref.resource_type,
      resourceId: ref.resource_id,
      resourceSubId: ref.resource_sub_id,
      resourceNameSnapshot: ref.resource_name_snapshot,
      resourceStatusSnapshot: ref.resource_status_snapshot,
      required: ref.required,
      invalid: ref.invalid,
      invalidReason: ref.invalid_reason,
    }
  }

  private async toSummaryVo(entity: FlowStudioFlowRow): Promise<FlowSummaryVo> {
    return {
      id: String(entity.id),
      tenant: entity.tenant_id,
      name: entity.name,
      description: entity.description,
      compileStatus: entity.compile_status,
      compileError: entity.compile_error,
      compileRevision: String(entity.compile_revision),
      publishedReleaseId: entity.published_release_id == null ? null : String(entity.published_release_id),
      publishedRevision: entity.published_revision == null ? null : String(entity.published_revision),
      enabled: entity.enabled,
      remark: entity.remark,
      createTime: entityDateToTimestampMs(entity.create_time),
      updateTime: entityDateToTimestampMs(entity.update_time),
    }
  }

  private async toDetailVo(entity: FlowStudioFlowRow): Promise<FlowDetailVo> {
    const summary = await this.toSummaryVo(entity)
    const refs = await this.flowResourceRefRepository.listByFlowId(entity.id, entity.tenant_id)
    return {
      ...summary,
      editorFlowJson: normalizeGraph(safeParseJson(entity.editor_flow_json) as FlowEditorGraph | null),
      compiledFlowJson: safeParseJson(entity.compiled_flow_json),
      componentSnapshotJson: safeParseJson(entity.component_snapshot_json),
      remoteFlowId: entity.remote_flow_id,
      remoteBindingStatus: entity.remote_binding_status,
      lastCompiledTime: entityDateToTimestampMs(entity.last_compiled_time),
      lastSyncedTime: entityDateToTimestampMs(entity.last_synced_time),
      references: await Promise.all(refs.map((ref) => this.toReferenceVo(ref))),
    }
  }

  private async requireFlow(id: string): Promise<FlowStudioFlowRow> {
    const tenant = this.currentTenant()
    const row = await this.flowRepository.findByIdScoped(id, tenant)
    if (!row) {
      throw new NotFoundException('流程不存在')
    }
    return row
  }

  private async persistCompileArtifacts(
    entity: FlowStudioFlowRow,
    editorFlow: FlowEditorGraph,
    compiled: CompiledFlowResult,
    issues: FlowIssueVo[],
  ): Promise<FlowStudioFlowRow> {
    const tenant = this.currentTenant()
    const compileRevision = (BigInt(entity.compile_revision ?? '0') + 1n).toString()
    const compileStatus = issues.some((issue) => issue.level === 'error') ? 'compile_failed' : 'compiled'
    const compileError = issues
      .filter((issue) => issue.level === 'error')
      .map((issue) => issue.message)
      .join('; ') || null
    await this.flowRepository.updateRow(
      entity.id,
      {
        name: entity.name,
        description: entity.description,
        editor_flow_json: JSON.stringify(editorFlow),
        compiled_flow_json: JSON.stringify(compiled.compiledGraph),
        component_snapshot_json: JSON.stringify(compiled.componentSnapshot),
        compile_status: compileStatus,
        compile_error: compileError,
        compile_revision: compileRevision,
        last_compiled_time: formatMysqlDateTimeShanghai(),
        remote_binding_status: compileStatus === 'compiled' ? 'pending_sync' : 'compile_failed',
        enabled: entity.enabled,
        remark: entity.remark,
      },
      tenant,
    )
    await this.flowResourceRefRepository.replaceForFlow(
      entity.id,
      this.dedupeRefs(compiled.refs).map((ref) => {
        const relatedIssue = issues.find(
          (issue) =>
            issue.resourceType === ref.resourceType &&
            issue.resourceId === ref.resourceId &&
            issue.nodeId === ref.nodeId &&
            issue.level === 'error',
        )
        return {
          id: generateNumericId(),
          tenant_id: tenant,
          flow_id: entity.id,
          node_id: ref.nodeId,
          component_key: ref.componentKey,
          resource_type: ref.resourceType,
          resource_id: ref.resourceId,
          resource_sub_id: ref.resourceSubId,
          resource_name_snapshot: ref.resourceNameSnapshot,
          resource_status_snapshot: ref.resourceStatusSnapshot,
          required: ref.required,
          invalid: relatedIssue != null,
          invalid_reason: relatedIssue?.message ?? null,
          remark: null,
          creator_id: null,
          creator_type: null,
          updater_id: null,
          updater_type: null,
          deleted: '0',
        }
      }),
      tenant,
    )
    return (await this.requireFlow(entity.id)) as FlowStudioFlowRow
  }

  /**
   * 将编译后的 Cube 规范图同步到 cube-ai（AI Center）流程服务。
   * 对远端 `PUT /flows/:id` 携带 {@link CubeFlowGraph}；后续导入、快照合并与绑定重建由 cube-ai 服务端完成。
   * ai-application 侧负责生成与 cube-ai 一致的图结构（节点 config、语义边 `cube.sp/...`），并在远端流程记录缺失时重建绑定。
   */
  private isRemoteCubeFlowNotFoundError(error: unknown): boolean {
    return isEngineFlowNotFound(error)
  }

  private async syncRemoteFlow(
    entity: FlowStudioFlowRow,
    editorFlow: FlowEditorGraph,
    componentMap: Map<string, FlowComponentCatalogItem>,
  ): Promise<FlowStudioFlowRow> {
    const tenant = this.currentTenant()

    const markSyncFailed = async (): Promise<void> => {
      await this.flowRepository.updateRow(
        entity.id,
        {
          remote_binding_status: 'sync_failed',
        },
        tenant,
      )
    }

    const markLinked = async (remoteFlowId: string): Promise<void> => {
      await this.flowRepository.updateRow(
        entity.id,
        {
          remote_flow_id: remoteFlowId,
          remote_binding_status: 'linked',
          last_synced_time: formatMysqlDateTimeShanghai(),
        },
        tenant,
      )
    }

    try {
      const client = this.engine
      const mergedComponentMap = this.applyCompileSnapshotToComponentMap(
        componentMap,
        entity.component_snapshot_json,
        editorFlow,
      )
      const knowledgeDocumentRuntimeIds = await this.buildKnowledgeDocumentRuntimeContext(editorFlow)
      const languageModelRuntimeByNodeId = await this.buildLanguageModelRuntimeContext(editorFlow)
      const imageGenerationRuntimeByNodeId = await this.buildImageGenerationRuntimeContext(editorFlow)
      const languageModelCubeAiTemplateIds = await this.ensureLanguageModelCubeAiTemplates(
        client,
        editorFlow,
        languageModelRuntimeByNodeId,
      )
      const imageGenerationCubeAiTemplateIds = await this.ensureImageGenerationCubeAiTemplates(
        client,
        editorFlow,
        imageGenerationRuntimeByNodeId,
      )
      const cubeGraph = this.buildCubeFlowGraph(editorFlow, mergedComponentMap, {
        aiCenterBaseUrl: client.getConfig().baseUrl,
        aiCenterApiKey: client.getConfig().systemApiKey,
        aiCenterProjectId: tenant,
        knowledgeDocumentRuntimeIds,
        languageModelRuntimeByNodeId,
        imageGenerationRuntimeByNodeId,
        languageModelCubeAiTemplateIds,
        imageGenerationCubeAiTemplateIds,
      })
      if (cubeGraph.unsupportedNodes.length > 0) {
        await this.flowRepository.updateRow(
          entity.id,
          {
            remote_binding_status: 'unsupported_component',
          },
          tenant,
        )
        return this.requireFlow(entity.id)
      }

      const updatePayload = {
        name: entity.name,
        description: entity.description,
        graph: cubeGraph.graph,
      }

      let remoteFlowId = entity.remote_flow_id?.trim() ?? ''

      const pushOrThrow = async (flowId: string): Promise<void> => {
        await client.updateFlow(flowId, updatePayload)
      }

      const logFlowPushOk = (remoteId: string): void => {
        console.info(
          `[ai-application] cube-ai updateFlow 已推送 ` +
            `localFlowId=${entity.id} remoteFlowId=${remoteId} ` +
            `nodes=${cubeGraph.graph.nodes.length} edges=${cubeGraph.graph.edges.length} ` +
            `lmTplOpenaiText=${languageModelCubeAiTemplateIds.openaiText ?? '—'} ` +
            `lmTplOpenaiVision=${languageModelCubeAiTemplateIds.openaiVision ?? '—'} ` +
            `lmTplAzureText=${languageModelCubeAiTemplateIds.azureText ?? '—'} ` +
            `lmTplAzureVision=${languageModelCubeAiTemplateIds.azureVision ?? '—'}`,
        )
      }

      if (!remoteFlowId) {
        const created = await client.createFlow({
          name: entity.name,
          description: entity.description,
        })
        remoteFlowId = created.id?.trim() ?? ''
        if (!remoteFlowId) {
          throw new Error('远端 flow 创建失败，未返回 id')
        }
        try {
          await pushOrThrow(remoteFlowId)
        } catch (error) {
          await this.flowRepository.updateRow(
            entity.id,
            {
              remote_flow_id: remoteFlowId,
              remote_binding_status: 'sync_failed',
            },
            tenant,
          )
          const msg = error instanceof Error ? error.message : String(error)
          console.warn(`[ai-application] 新建远端流程后首次推送失败 flowId=${entity.id} remoteFlowId=${remoteFlowId}: ${msg}`)
          return this.requireFlow(entity.id)
        }
        logFlowPushOk(remoteFlowId)
        await markLinked(remoteFlowId)
        return this.requireFlow(entity.id)
      }

      try {
        await pushOrThrow(remoteFlowId)
      } catch (error) {
        if (!this.isRemoteCubeFlowNotFoundError(error)) {
          throw error
        }
        const created = await client.createFlow({
          name: entity.name,
          description: entity.description,
        })
        const newId = created.id?.trim() ?? ''
        if (!newId) {
          throw error
        }
        await pushOrThrow(newId)
        remoteFlowId = newId
      }

      logFlowPushOk(remoteFlowId)
      await markLinked(remoteFlowId)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.warn(`[ai-application] cube-ai 流程同步失败 flowId=${entity.id}: ${msg}`)
      await markSyncFailed()
    }
    return this.requireFlow(entity.id)
  }

  private buildExecutionRequest(body: FlowDebugBody, stream: boolean): FlowExecutionRequest {
    const tweaks = body.tweaks ?? body.variables ?? undefined
    return {
      input: body.input ?? undefined,
      sessionId: body.sessionId ?? undefined,
      inputType: body.inputType ?? undefined,
      outputType: body.outputType ?? undefined,
      tweaks,
      stream,
    }
  }

  private async ensureRemoteExecutableFlow(
    flow: FlowStudioFlowRow,
    editorFlow: FlowEditorGraph,
    componentMap: Map<string, FlowComponentCatalogItem>,
  ) {
    let nextFlow = flow
    if (nextFlow.compile_status !== 'compiled' || !nextFlow.compiled_flow_json) {
      throw new BadRequestException('流程尚未成功编译，无法执行')
    }
    if (nextFlow.remote_binding_status !== 'linked' || !nextFlow.remote_flow_id?.trim()) {
      nextFlow = await this.syncRemoteFlow(nextFlow, editorFlow, componentMap)
    }
    const remoteFlowId = nextFlow.remote_flow_id?.trim()
    if (nextFlow.remote_binding_status !== 'linked' || !remoteFlowId) {
      throw new BadRequestException(`流程尚未完成远端同步，当前状态：${nextFlow.remote_binding_status ?? 'unknown'}`)
    }
    return {
      flow: nextFlow,
      client: this.engine,
      remoteFlowId,
    }
  }

  public async listComponents() {
    return this.flowComponentService.listCatalog()
  }

  public async listFlows(): Promise<FlowSummaryVo[]> {
    const tenant = this.currentTenant()
    const rows = await this.flowRepository.listByTenantDesc(tenant)
    return Promise.all(rows.map((row) => this.toSummaryVo(row)))
  }

  public async listFlowsPaged(input: { pageNumber: number; pageSize: number; keyword: string }): Promise<FlowListPageVo> {
    const tenant = this.currentTenant()
    const keyword = String(input.keyword ?? '').trim()
    const pageNumber = Math.max(1, Math.floor(input.pageNumber))
    const pageSize = Math.min(200, Math.max(1, Math.floor(input.pageSize)))
    const total = await this.flowRepository.countByTenantKeyword(keyword, tenant)
    const rows = await this.flowRepository.pageByTenantKeyword({
      keywordTrimmed: keyword,
      pageNumber,
      pageSize,
      tenantId: tenant,
    })
    const records = await Promise.all(rows.map((row) => this.toSummaryVo(row)))
    const pages = total === 0 ? 0 : Math.ceil(total / pageSize)
    return {
      total,
      pages,
      currentPage: pageNumber,
      pageSize,
      records,
    }
  }

  public async createFlow(body: FlowSaveBody): Promise<FlowDetailVo> {
    const tenant = this.currentTenant()
    const name = String(body.name ?? '').trim()
    if (!name) {
      throw new BadRequestException('流程名称不能为空')
    }
    if (await this.flowRepository.existsNameForTenant(name, null, tenant)) {
      throw new BadRequestException('流程名称已存在')
    }
    const editorFlow = normalizeGraph(body.editorFlowJson)
    assertEditorGraphWithinLimits(editorFlow)
    const id = generateNumericId()
    await this.flowRepository.insertRow({
      id,
      tenant_id: tenant,
      name,
      description: body.description ?? null,
      editor_flow_json: JSON.stringify(editorFlow),
      compiled_flow_json: null,
      component_snapshot_json: null,
      compile_status: 'draft',
      compile_error: null,
      compile_revision: '0',
      remote_flow_id: null,
      remote_binding_status: 'draft',
      published_release_id: null,
      published_revision: null,
      last_compiled_time: null,
      last_synced_time: null,
      enabled: body.enabled ?? true,
      remark: body.remark ?? null,
      creator_id: null,
      creator_type: null,
      updater_id: null,
      updater_type: null,
      deleted: '0',
    })
    const created = await this.requireFlow(id)
    return this.toDetailVo(created)
  }

  public async getFlowDetail(id: string): Promise<FlowDetailVo> {
    return this.toDetailVo(await this.requireFlow(id))
  }

  public async exportFlow(id: string): Promise<FlowExportVo> {
    const flow = await this.requireFlow(id)
    const editorFlowJson = normalizeGraph(safeParseJson(flow.editor_flow_json) as FlowEditorGraph | null)
    return {
      schemaVersion: 'ai-application-flow-export/v1',
      exportedAt: Date.now(),
      flow: {
        id: String(flow.id),
        name: flow.name,
        description: flow.description,
        enabled: flow.enabled,
        remark: flow.remark,
        compileStatus: flow.compile_status,
        compileRevision: String(flow.compile_revision),
        publishedRevision: flow.published_revision == null ? null : String(flow.published_revision),
      },
      editorFlowJson,
      compiledFlowJson: safeParseJson(flow.compiled_flow_json),
      componentSnapshotJson: safeParseJson(flow.component_snapshot_json),
    }
  }

  public async saveFlow(id: string, body: FlowSaveBody): Promise<FlowDetailVo> {
    const flow = await this.requireFlow(id)
    const nextName = body.name == null ? flow.name : String(body.name).trim()
    if (!nextName) {
      throw new BadRequestException('流程名称不能为空')
    }
    if (nextName !== flow.name && (await this.flowRepository.existsNameForTenant(nextName, flow.id, this.currentTenant()))) {
      throw new BadRequestException('流程名称已存在')
    }
    const editorFlow = normalizeGraph(body.editorFlowJson ?? (safeParseJson(flow.editor_flow_json) as FlowEditorGraph | null))
    assertEditorGraphWithinLimits(editorFlow)
    const componentMap = await this.flowComponentService.getCatalogMap(editorFlow.nodes.map((node) => node.componentKey))
    const graphIssues = this.validateGraphShape(editorFlow)
    const componentIssues = this.validateComponentContract(editorFlow, componentMap)
    const compiled = await this.buildCompiledFlow(editorFlow, componentMap)
    const validation = await this.validateResourceRefs(compiled.refs)
    let nextFlow = await this.persistCompileArtifacts(
      {
        ...flow,
        name: nextName,
        description: body.description === undefined ? flow.description : body.description,
        enabled: body.enabled === undefined ? flow.enabled : body.enabled,
        remark: body.remark === undefined ? flow.remark : body.remark,
      },
      editorFlow,
      { ...compiled, refs: validation.refs },
      [...graphIssues, ...componentIssues, ...compiled.extraIssues, ...validation.issues],
    )
    if (nextFlow.compile_status === 'compiled') {
      nextFlow = await this.syncRemoteFlow(nextFlow, editorFlow, componentMap)
    }
    return this.toDetailVo(nextFlow)
  }

  public async importFlow(id: string, body: FlowImportBody): Promise<FlowDetailVo> {
    const editorFlow = normalizeGraph(body.editorFlowJson)
    if (editorFlow.nodes.length === 0) {
      throw new BadRequestException('导入的流程画布不能为空')
    }
    return this.saveFlow(id, {
      name: body.name ?? undefined,
      description: body.description ?? undefined,
      enabled: body.enabled ?? undefined,
      remark: body.remark ?? undefined,
      editorFlowJson: editorFlow,
    })
  }

  public async deleteFlow(id: string): Promise<void> {
    const flow = await this.requireFlow(id)
    const tenant = this.currentTenant()
    const remoteId = flow.remote_flow_id?.trim()
    if (remoteId) {
      try {
        await this.engine.deleteFlow(remoteId)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.warn(`[flow-studio] 远端流程删除失败（已忽略） flowId=${id} remoteFlowId=${remoteId}: ${msg}`)
      }
    }
    await this.flowRepository.logicalDelete(id, tenant)
  }

  public async validateFlow(id: string): Promise<{ ok: boolean; issues: FlowIssueVo[] }> {
    const flow = await this.requireFlow(id)
    const editorFlow = normalizeGraph(safeParseJson(flow.editor_flow_json) as FlowEditorGraph | null)
    const componentMap = await this.flowComponentService.getCatalogMap(editorFlow.nodes.map((node) => node.componentKey))
    const graphIssues = this.validateGraphShape(editorFlow)
    const componentIssues = this.validateComponentContract(editorFlow, componentMap)
    const compiled = await this.buildCompiledFlow(editorFlow, componentMap)
    const validation = await this.validateResourceRefs(compiled.refs)
    const issues = [...graphIssues, ...componentIssues, ...compiled.extraIssues, ...validation.issues]
    return { ok: !issues.some((issue) => issue.level === 'error'), issues }
  }

  public async debugFlow(
    id: string,
    body: FlowDebugBody,
  ): Promise<FlowDebugResult> {
    const startedAtMs = Date.now()
    const flow = await this.requireFlow(id)
    const editorFlow = normalizeGraph(safeParseJson(flow.editor_flow_json) as FlowEditorGraph | null)
    const componentMap = await this.flowComponentService.getCatalogMap(editorFlow.nodes.map((node) => node.componentKey))
    const graphIssues = this.validateGraphShape(editorFlow)
    const componentIssues = this.validateComponentContract(editorFlow, componentMap)
    const compiled = await this.buildCompiledFlow(editorFlow, componentMap)
    const validation = await this.validateResourceRefs(compiled.refs)
    const issues = [...graphIssues, ...componentIssues, ...compiled.extraIssues, ...validation.issues]

    if (issues.some((issue) => issue.level === 'error')) {
      return {
        ok: false,
        mode: 'compile-preview',
        issues,
        input: flowInputText(body.input),
        outputText: null,
        outputCount: 0,
        durationMs: Date.now() - startedAtMs,
      }
    }

    const executionRequest = this.buildExecutionRequest(body, false)
    try {
      const remoteReady = await this.ensureRemoteExecutableFlow(flow, editorFlow, componentMap)
      const response = await remoteReady.client.runFlow(remoteReady.remoteFlowId, executionRequest)
      return {
        ok: true,
        mode: 'remote-run',
        issues,
        input: flowInputText(body.input),
        outputText: extractDebugOutputText(response),
        outputCount: debugRunOutputCount(response),
        durationMs: Date.now() - startedAtMs,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        mode: 'compile-preview',
        issues: [
          ...issues,
          {
            code: 'FLOW_REMOTE_DEBUG_FAILED',
            level: 'error',
            message: `远端调试失败：${errorMessage}`,
          },
        ],
        input: flowInputText(body.input),
        outputText: null,
        outputCount: 0,
        durationMs: Date.now() - startedAtMs,
      }
    }
  }

  public async uploadFlowFile(id: string, file: File): Promise<FlowFileUploadResponse> {
    const flow = await this.requireFlow(id)
    const editorFlow = normalizeGraph(safeParseJson(flow.editor_flow_json) as FlowEditorGraph | null)
    const componentMap = await this.flowComponentService.getCatalogMap(editorFlow.nodes.map((node) => node.componentKey))
    const remoteReady = await this.ensureRemoteExecutableFlow(flow, editorFlow, componentMap)
    const bytes = new Uint8Array(await file.arrayBuffer())
    return remoteReady.client.uploadFlowFile(remoteReady.remoteFlowId, bytes, file.name, file.type || null)
  }

  public async runFlow(id: string, body: FlowRunBody): Promise<RunResponse> {
    const flow = await this.requireFlow(id)
    const editorFlow = normalizeGraph(safeParseJson(flow.editor_flow_json) as FlowEditorGraph | null)
    const componentMap = await this.flowComponentService.getCatalogMap(editorFlow.nodes.map((node) => node.componentKey))
    const validation = await this.validateFlow(id)
    if (!validation.ok) {
      throw new BadRequestException(`流程校验未通过：${validation.issues.map((item) => item.message).join('；')}`)
    }
    const remoteReady = await this.ensureRemoteExecutableFlow(flow, editorFlow, componentMap)
    return remoteReady.client.runFlow(remoteReady.remoteFlowId, this.buildExecutionRequest(body, false))
  }

  public async runFlowForEngine(id: string, body: FlowRunBody): Promise<FlowEngineRunEnvelope> {
    const result = await this.runFlow(id, body)
    const jobId = generateNumericId()
    const remoteFlowRunId = (result.raw as { session_id?: string } | null | undefined)?.session_id ?? undefined
    return {
      scheduled: true,
      jobId,
      remoteFlowRunId,
      estimatedDurationMs: 0,
      statusUrl: `/v1/jobs/${jobId}`,
    }
  }

  public async getFlowMonitorTraces(id: string, query: FlowMonitorQuery = {}): Promise<FlowMonitorTracesResponse> {
    const flow = await this.requireFlow(id)
    const editorFlow = normalizeGraph(safeParseJson(flow.editor_flow_json) as FlowEditorGraph | null)
    const componentMap = await this.flowComponentService.getCatalogMap(editorFlow.nodes.map((node) => node.componentKey))
    const remoteReady = await this.ensureRemoteExecutableFlow(flow, editorFlow, componentMap)
    return remoteReady.client.getFlowMonitorTraces(remoteReady.remoteFlowId, query)
  }

  public async getFlowMonitorBuilds(id: string, query: FlowMonitorQuery = {}): Promise<FlowMonitorBuildsResponse> {
    const flow = await this.requireFlow(id)
    const editorFlow = normalizeGraph(safeParseJson(flow.editor_flow_json) as FlowEditorGraph | null)
    const componentMap = await this.flowComponentService.getCatalogMap(editorFlow.nodes.map((node) => node.componentKey))
    const remoteReady = await this.ensureRemoteExecutableFlow(flow, editorFlow, componentMap)
    return remoteReady.client.getFlowMonitorBuilds(remoteReady.remoteFlowId, query)
  }

  public async runFlowStream(id: string, body: FlowRunBody): Promise<Response> {
    const flow = await this.requireFlow(id)
    const editorFlow = normalizeGraph(safeParseJson(flow.editor_flow_json) as FlowEditorGraph | null)
    const componentMap = await this.flowComponentService.getCatalogMap(editorFlow.nodes.map((node) => node.componentKey))
    const validation = await this.validateFlow(id)
    if (!validation.ok) {
      throw new BadRequestException(`流程校验未通过：${validation.issues.map((item) => item.message).join('；')}`)
    }
    const remoteReady = await this.ensureRemoteExecutableFlow(flow, editorFlow, componentMap)
    const upstream = await remoteReady.client.runFlowStream(remoteReady.remoteFlowId, this.buildExecutionRequest(body, true))
    const headers = new Headers()
    const contentType = upstream.headers.get('content-type')
    if (contentType) {
      headers.set('Content-Type', contentType)
    }
    headers.set('Cache-Control', 'no-cache')
    headers.set('Connection', 'keep-alive')
    return new Response(upstream.body, {
      status: 200,
      headers,
    })
  }

  public async publishFlow(id: string, body: FlowPublishBody): Promise<{ releaseId: string; releaseVersion: string }> {
    let flow = await this.requireFlow(id)
    const validation = await this.validateFlow(id)
    if (!validation.ok) {
      throw new BadRequestException(`流程校验未通过：${validation.issues.map((item) => item.message).join('；')}`)
    }
    if (flow.compile_status !== 'compiled' || !flow.compiled_flow_json) {
      throw new BadRequestException('流程尚未成功编译，无法发布')
    }
    if (flow.remote_binding_status !== 'linked') {
      const editorFlow = normalizeGraph(safeParseJson(flow.editor_flow_json) as FlowEditorGraph | null)
      const componentMap = await this.flowComponentService.getCatalogMap(editorFlow.nodes.map((node) => node.componentKey))
      flow = await this.syncRemoteFlow(flow, editorFlow, componentMap)
      if (flow.remote_binding_status !== 'linked') {
        throw new BadRequestException('流程尚未成功同步到远端执行引擎，无法发布')
      }
    }
    const tenant = this.currentTenant()
    /* 每个流程只保留一条有效发布记录，避免多版本堆积；调用方无需再区分版本号 */
    await this.flowReleaseRepository.softDeleteActiveReleasesForFlow(id, tenant)
    const releaseVersion = await this.flowReleaseRepository.getNextReleaseVersion(id, tenant)
    const releaseId = generateNumericId()
    const compiledFlowJson = flow.compiled_flow_json
    if (!compiledFlowJson) {
      throw new BadRequestException('流程缺少已编译结果，无法发布')
    }
    await this.flowReleaseRepository.insertRow({
      id: releaseId,
      tenant_id: tenant,
      flow_id: id,
      release_version: releaseVersion,
      name: flow.name,
      description: flow.description,
      editor_flow_json: flow.editor_flow_json,
      compiled_flow_json: compiledFlowJson,
      component_snapshot_json: flow.component_snapshot_json,
      release_note: body.releaseNote ?? null,
      status: 'published',
      published_time: formatMysqlDateTimeShanghai(),
      remark: null,
      creator_id: null,
      creator_type: null,
      updater_id: null,
      updater_type: null,
      deleted: '0',
    })
    await this.flowRepository.updateRow(
      id,
      {
        published_release_id: releaseId,
        published_revision: flow.compile_revision,
      },
      tenant,
    )
    return {
      releaseId,
      releaseVersion,
    }
  }

  public async listFlowReferences(id: string): Promise<FlowResourceReferenceVo[]> {
    const flow = await this.requireFlow(id)
    const refs = await this.flowResourceRefRepository.listByFlowId(flow.id, flow.tenant_id)
    return Promise.all(refs.map((ref) => this.toReferenceVo(ref)))
  }

  public async listFlowsByResource(resourceType: string, resourceId: string): Promise<FlowSummaryVo[]> {
    const tenant = this.currentTenant()
    const refs = await this.flowResourceRefRepository.listByResource(resourceType, resourceId, tenant)
    const uniqueFlowIds = Array.from(new Set(refs.map((ref) => String(ref.flow_id))))
    const results: FlowSummaryVo[] = []
    for (const flowId of uniqueFlowIds) {
      const flow = await this.flowRepository.findByIdScoped(flowId, tenant)
      if (flow) {
        results.push(await this.toSummaryVo(flow))
      }
    }
    return results
  }
}
