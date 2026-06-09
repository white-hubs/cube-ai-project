/**
 * flow-studio 编辑器投影层（editor-model）DTO 契约。
 *
 * 与 `@cube-ai/flow-studio` 的 `FlowService` 公共出入参对齐（editorFlowJson 生命周期），
 * 供 ghcloud 前端 app 经 SDK 直连 ai-center `/flow/studio/*`（ADR-0014）。
 */

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

export interface FlowSaveBody {
  name?: string | null
  description?: string | null
  editorFlowJson?: FlowEditorGraph | null
  enabled?: boolean | null
  remark?: string | null
}

export interface FlowImportBody {
  name?: string | null
  description?: string | null
  enabled?: boolean | null
  remark?: string | null
  editorFlowJson?: FlowEditorGraph | null
}

export interface FlowPublishBody {
  releaseNote?: string | null
}

export interface FlowDebugBody {
  input?: string | { query?: string | null; [key: string]: unknown } | null
  sessionId?: string | null
  inputType?: string | null
  outputType?: string | null
  tweaks?: Record<string, unknown> | null
  variables?: Record<string, unknown> | null
}

export type FlowRunBody = FlowDebugBody

export interface FlowIssueVo {
  code: string
  level: 'error' | 'warning' | string
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
  createTime: number | null
  updateTime: number | null
}

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

export interface FlowDetailVo extends FlowSummaryVo {
  editorFlowJson: FlowEditorGraph
  compiledFlowJson: Record<string, unknown> | null
  componentSnapshotJson: Record<string, unknown> | null
  remoteFlowId: string | null
  remoteBindingStatus: string | null
  lastCompiledTime: number | null
  lastSyncedTime: number | null
  references: FlowResourceReferenceVo[]
}

export interface FlowListPageVo {
  total: number
  pages: number
  currentPage: number
  pageSize: number
  records: FlowSummaryVo[]
}

export interface FlowComponentCatalogItem {
  id: string
  componentKey: string
  componentName: string
  componentGroup: string | null
  componentType: string
  componentVersion: string
  mappingType: string
  mappingTarget: string | null
  iconUrl: string | null
  enabled: boolean
  isBuiltin: boolean
  presentationSchema: Record<string, unknown> | null
  protocolSchema: Record<string, unknown> | null
  executionPolicy: Record<string, unknown> | null
}

export interface FlowDebugResult {
  ok: boolean
  mode: 'compile-preview' | 'remote-run' | string
  issues: FlowIssueVo[]
  input: string | null
  outputText: string | null
  outputCount: number
  durationMs: number
}

export interface FlowValidateResult {
  ok: boolean
  issues: FlowIssueVo[]
}

export interface FlowFileUploadResponse {
  id?: string | null
  name?: string | null
  path?: string | null
  url?: string | null
  flowId?: string | null
  [key: string]: unknown
}

export interface ListFlowsPageQuery {
  pageNumber: number
  pageSize: number
  keyword?: string
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

export interface FlowRunResult {
  raw?: {
    outputs?: unknown[]
    session_id?: string | null
  } | null
}
