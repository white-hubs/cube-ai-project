import { BadRequestException, Body, ContextParam, Controller, DELETE, GET, POST, PUT, Param, Query } from '@dangao/bun-server'
import type { Context } from '@dangao/bun-server'
import type { FlowDebugBody, FlowImportBody, FlowPublishBody, FlowRunBody, FlowSaveBody } from '../flow.service'
import { FlowService } from '../flow.service'

function parseFlowId(raw: string): string {
  const normalized = raw.trim()
  if (!/^\d+$/.test(normalized)) {
    throw new BadRequestException('Invalid id')
  }
  return normalized
}

function monitorQuery(page?: string | null, size?: string | null): { page?: string; size?: string } {
  return {
    ...(page != null && page !== '' ? { page } : {}),
    ...(size != null && size !== '' ? { size } : {}),
  }
}

async function requireMultipartFile(ctx: Context): Promise<File> {
  const body = await ctx.getBody()
  if (!(body instanceof FormData)) {
    throw new BadRequestException('multipart/form-data is required')
  }
  const file = body.get('file')
  if (!(file instanceof File)) {
    throw new BadRequestException('file field is required')
  }
  return file
}

/**
 * flow-studio 编辑器投影层 HTTP 面（editorFlowJson 生命周期 + 编译 + 进程内 flow-core 同步）。
 *
 * 内部路由前缀 `/studio`；经 ADR-0008 域前缀重写后对外暴露为 `/flow/studio/*`
 * （与 flow-core `/flows/*` 区隔；ghcloud 前端经 SDK 吸收前缀差异，ADR-0014）。
 * 复刻自原仓库 `ai-application/src/controllers/flow.controller.ts`（原前缀 `/ai/flows`）。
 */
@Controller('/studio')
export class FlowStudioController {
  public constructor(private readonly flowService: FlowService) {}

  @GET('/components')
  public async listComponents() {
    return this.flowService.listComponents()
  }

  @GET('/')
  public async listFlows(
    @Query('pageNumber') pageNumberRaw?: string | null,
    @Query('pageSize') pageSizeRaw?: string | null,
    @Query('keyword') keywordRaw?: string | null,
  ) {
    const hasPage =
      pageNumberRaw != null && String(pageNumberRaw).trim() !== '' && pageSizeRaw != null && String(pageSizeRaw).trim() !== ''
    if (hasPage) {
      const pageNumber = Number(pageNumberRaw)
      const pageSize = Number(pageSizeRaw)
      if (Number.isFinite(pageNumber) && Number.isFinite(pageSize) && pageNumber >= 1 && pageSize >= 1) {
        return this.flowService.listFlowsPaged({
          pageNumber: Math.floor(pageNumber),
          pageSize: Math.floor(pageSize),
          keyword: keywordRaw == null ? '' : String(keywordRaw),
        })
      }
    }
    return this.flowService.listFlows()
  }

  @POST('/')
  public async createFlow(@Body() body: FlowSaveBody) {
    return this.flowService.createFlow(body)
  }

  @GET('/references/by-resource')
  public async listFlowsByResource(
    @Query('resourceType') resourceType: string,
    @Query('resourceId') resourceId: string,
  ) {
    return this.flowService.listFlowsByResource(String(resourceType ?? ''), String(resourceId ?? ''))
  }

  @GET('/:id')
  public async getFlowDetail(@Param('id') id: string) {
    return this.flowService.getFlowDetail(parseFlowId(id))
  }

  @GET('/:id/export')
  public async exportFlow(@Param('id') id: string) {
    return this.flowService.exportFlow(parseFlowId(id))
  }

  @PUT('/:id')
  public async saveFlow(@Param('id') id: string, @Body() body: FlowSaveBody) {
    return this.flowService.saveFlow(parseFlowId(id), body)
  }

  @POST('/:id/import')
  public async importFlow(@Param('id') id: string, @Body() body: FlowImportBody) {
    return this.flowService.importFlow(parseFlowId(id), body)
  }

  @DELETE('/:id')
  public async deleteFlow(@Param('id') id: string): Promise<void> {
    await this.flowService.deleteFlow(parseFlowId(id))
  }

  @POST('/:id/validate')
  public async validateFlow(@Param('id') id: string) {
    return this.flowService.validateFlow(parseFlowId(id))
  }

  @POST('/:id/debug')
  public async debugFlow(@Param('id') id: string, @Body() body: FlowDebugBody) {
    return this.flowService.debugFlow(parseFlowId(id), body)
  }

  @POST('/:id/files')
  public async uploadFlowFile(@Param('id') id: string, @ContextParam() ctx: Context) {
    return this.flowService.uploadFlowFile(parseFlowId(id), await requireMultipartFile(ctx))
  }

  @POST('/:id/run')
  public async runFlow(
    @Param('id') id: string,
    @Body() body: FlowRunBody,
    @ContextParam() ctx: Context,
  ): Promise<unknown> {
    const flowId = parseFlowId(id)
    const engineCaller = ctx.getHeader('x-engine-caller')
    if (engineCaller === 'cube-agentic-engine') {
      return this.flowService.runFlowForEngine(flowId, body)
    }
    return this.flowService.runFlow(flowId, body)
  }

  @POST('/:id/run-stream')
  public async runFlowStream(@Param('id') id: string, @Body() body: FlowRunBody): Promise<Response> {
    return this.flowService.runFlowStream(parseFlowId(id), body)
  }

  @GET('/:id/monitor/traces')
  public async getFlowMonitorTraces(
    @Param('id') id: string,
    @Query('page') page?: string | null,
    @Query('size') size?: string | null,
  ) {
    return this.flowService.getFlowMonitorTraces(parseFlowId(id), monitorQuery(page, size))
  }

  @GET('/:id/monitor/builds')
  public async getFlowMonitorBuilds(
    @Param('id') id: string,
    @Query('page') page?: string | null,
    @Query('size') size?: string | null,
  ) {
    return this.flowService.getFlowMonitorBuilds(parseFlowId(id), monitorQuery(page, size))
  }

  @POST('/:id/publish')
  public async publishFlow(@Param('id') id: string, @Body() body: FlowPublishBody) {
    return this.flowService.publishFlow(parseFlowId(id), body)
  }

  @GET('/:id/references')
  public async listFlowReferences(@Param('id') id: string) {
    return this.flowService.listFlowReferences(parseFlowId(id))
  }
}
