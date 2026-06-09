/**
 * flow-studio 引擎 DTO（本地等价定义）。
 *
 * 复刻自原 `@ghcloud/ai-center-sdk` 的 flow 执行/监控契约，去掉 SDK 依赖；编译产物 `CubeFlowGraph`
 * 直接复用 `@cube-ai/flow-core`（进程内引擎权威类型，ADR-0014 D1 的换源目标）。
 */
export type { CubeFlowGraph, CubeFlowNode } from '@cube-ai/flow-core'

export interface FlowExecutionInputFileRef {
  id?: string | null
  name?: string | null
  path?: string | null
  file_path?: string | null
  filePath?: string | null
  url?: string | null
  mime?: string | null
  ext?: Record<string, unknown> | null
}

export interface FlowExecutionInput {
  query?: string | null
  params?: Record<string, unknown> | null
  files?: FlowExecutionInputFileRef[] | null
  history?: Array<{ role: string; content: string; ext?: Record<string, unknown> | null }> | null
  ext?: Record<string, unknown> | null
}

export interface FlowExecutionRequest {
  input?: string | FlowExecutionInput | null
  sessionId?: string | null
  stream?: boolean | null
  inputType?: string | null
  outputType?: string | null
  tweaks?: Record<string, unknown> | null
}

export interface FlowFileUploadResponse extends FlowExecutionInputFileRef {
  flowId?: string | null
  raw?: unknown
}

export interface RunResponse {
  raw?: {
    outputs?: unknown[]
    session_id?: string | null
  } | null
}

export interface FlowMonitorQueryParams {
  page?: number | string
  size?: number | string
  [key: string]: string | number | boolean | null | undefined
}

export type FlowMonitorTracesResponse = Record<string, unknown>

export type FlowMonitorBuildsResponse = Record<string, unknown>

/**
 * 引擎侧「远端 flow 不存在」语义。原仓库用 `@ghcloud/ai-center-sdk` 的 `AiCenterError(httpStatus=404)`
 * 触发「重建远端 flow」补偿；进程内换源后由 flow-core 的 `NotFoundException` 承担同一语义，
 * `isEngineFlowNotFound()` 负责跨实现识别（见 flow-engine.bridge）。
 */
export interface CreateFlowRequest {
  name?: string | null
  description?: string | null
}

export interface UpdateFlowRequest {
  name?: string | null
  description?: string | null
  graph?: import('@cube-ai/flow-core').CubeFlowGraph | null
}

export interface CreateFlowResponse {
  id: string
}
