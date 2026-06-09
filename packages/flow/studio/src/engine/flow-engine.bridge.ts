import { Injectable, NotFoundException } from '@dangao/bun-server'
import {
  CustomComponentTemplatesService,
  FlowCrudService,
  FlowFilesService,
  FlowLangflowSyncService,
  FlowsService,
} from '@cube-ai/flow-core'
import type {
  CreateFlowRequest,
  CreateFlowResponse,
  CubeFlowGraph,
  FlowExecutionRequest,
  FlowFileUploadResponse,
  FlowMonitorBuildsResponse,
  FlowMonitorQueryParams,
  FlowMonitorTracesResponse,
  RunResponse,
  UpdateFlowRequest,
} from './engine-dtos'

/**
 * 跨实现识别「执行后端 flow 不存在」语义。
 *
 * 原仓库用 `@ghcloud/ai-center-sdk` 的 `AiCenterError(httpStatus=404)` 触发「重建远端 flow」补偿；
 * 进程内换源后由 flow-core 的 `NotFoundException` 承担同一语义（ADR-0014 D1）。
 */
export function isEngineFlowNotFound(error: unknown): boolean {
  if (error instanceof NotFoundException) return true
  const status = (error as { httpStatus?: number; status?: number } | null)?.httpStatus ?? (error as { status?: number } | null)?.status
  return status === 404
}

function toUrlSearchParams(query: FlowMonitorQueryParams | undefined): URLSearchParams {
  const params = new URLSearchParams()
  if (!query) return params
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  return params
}

/**
 * flow-studio 引擎桥：把原仓库 `AiCenterClient`（HTTP 远端 cube-ai）的方法面，平替为对
 * `@cube-ai/flow-core` 进程内服务的调用（ADR-0014 D1「忠实路径」）。
 *
 * 语义映射：
 * - createFlow/updateFlow(graph)/deleteFlow → `FlowsService`
 * - runFlow/runFlowStream → `FlowsService`
 * - uploadFlowFile → `FlowFilesService`
 * - getFlowMonitorTraces/Builds → `FlowLangflowSyncService`（先经 `FlowCrudService.get` 解析绑定执行 flow id）
 * - custom-component-templates → `CustomComponentTemplatesService`
 *
 * `getConfig().baseUrl` 返回 `selfBaseUrl`（本 ai-center 对外基址），供编译期写入
 * knowledge-retrieval 等节点回调 kb-core 的 `api_url`。
 */
@Injectable()
export class FlowEngineBridge {
  public constructor(
    private readonly flows: FlowsService,
    private readonly crud: FlowCrudService,
    private readonly lfSync: FlowLangflowSyncService,
    private readonly files: FlowFilesService,
    private readonly customComponentTemplates: CustomComponentTemplatesService,
    private readonly selfBaseUrl: string,
    private readonly systemApiKey: string,
  ) {}

  /**
   * 忠实路径下编译期写入回调凭据：
   * - `baseUrl` = 本 ai-center 对外基址（`selfBaseUrl`），knowledge-retrieval 等节点回调 kb-core 用。
   * - `systemApiKey` = `builtinSystemApiKey`，替代原 `tenant_project.ai_center_api_key`。
   */
  public getConfig(): { baseUrl: string; systemApiKey: string } {
    return { baseUrl: this.selfBaseUrl, systemApiKey: this.systemApiKey }
  }

  public async createFlow(payload: CreateFlowRequest): Promise<CreateFlowResponse> {
    const created = await this.flows.create({
      name: payload.name?.trim() || '未命名流程',
      description: payload.description ?? undefined,
    })
    return { id: created.id }
  }

  public async updateFlow(remoteFlowId: string, payload: UpdateFlowRequest): Promise<void> {
    await this.flows.update(remoteFlowId, {
      name: payload.name ?? undefined,
      description: payload.description ?? undefined,
      graph: (payload.graph ?? undefined) as CubeFlowGraph | undefined,
    })
  }

  public async deleteFlow(remoteFlowId: string): Promise<void> {
    await this.flows.delete(remoteFlowId)
  }

  public async runFlow(remoteFlowId: string, request: FlowExecutionRequest): Promise<RunResponse> {
    const result = await this.flows.run(remoteFlowId, request)
    return result as unknown as RunResponse
  }

  public async runFlowStream(remoteFlowId: string, request: FlowExecutionRequest): Promise<Response> {
    return this.flows.runStream(remoteFlowId, { ...request, stream: true })
  }

  public async uploadFlowFile(
    remoteFlowId: string,
    bytes: Uint8Array,
    fileName: string,
    mimeType: string | null,
  ): Promise<FlowFileUploadResponse> {
    const file = new File([bytes], fileName, {
      type: mimeType ?? 'application/octet-stream',
    })
    const result = await this.files.uploadFlowFile(remoteFlowId, file)
    return result as FlowFileUploadResponse
  }

  public async getFlowMonitorTraces(
    remoteFlowId: string,
    query?: FlowMonitorQueryParams,
  ): Promise<FlowMonitorTracesResponse> {
    const executionFlowId = await this.requireBoundExecutionFlowId(remoteFlowId)
    return this.lfSync.fetchMonitorTracesForFlow(executionFlowId, toUrlSearchParams(query))
  }

  public async getFlowMonitorBuilds(
    remoteFlowId: string,
    query?: FlowMonitorQueryParams,
  ): Promise<FlowMonitorBuildsResponse> {
    const executionFlowId = await this.requireBoundExecutionFlowId(remoteFlowId)
    return this.lfSync.fetchMonitorBuildsForFlow(executionFlowId, toUrlSearchParams(query))
  }

  public async validateCustomComponentTemplateDsl(body: { dsl: unknown }): Promise<{ ok: true }> {
    return this.customComponentTemplates.validateDsl(body.dsl)
  }

  public async listCustomComponentTemplates(): Promise<{
    templates: Array<{ id: string; displayName: string; dsl: unknown; update_time?: string | null }>
  }> {
    const templates = await this.customComponentTemplates.list()
    return { templates }
  }

  public async createCustomComponentTemplate(body: {
    dsl: unknown
    displayName?: string
  }): Promise<{ id: string }> {
    const created = await this.customComponentTemplates.create({
      dsl: body.dsl,
      displayName: body.displayName,
    })
    return { id: created.id }
  }

  public async updateCustomComponentTemplate(id: string, body: { dsl?: unknown; displayName?: string }): Promise<void> {
    await this.customComponentTemplates.update(id, body)
  }

  private async requireBoundExecutionFlowId(remoteFlowId: string): Promise<string> {
    const detail = await this.crud.get(remoteFlowId)
    const bound = (detail as { langflowFlowId?: string | null }).langflowFlowId?.trim()
    if (!bound) {
      throw new NotFoundException('流程未绑定执行后端，无法查询监控数据')
    }
    return bound
  }
}
