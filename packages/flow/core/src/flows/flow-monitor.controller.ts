import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  BadRequestException,
  ContextParam,
  Controller,
  GET,
  Injectable,
  Param,
  type Context,
} from '@dangao/bun-server'
import { MockableEndpoint } from '@cube-ai/server-mock'
import { FlowCrudService } from './flow-crud.service'
import { FlowLangflowSyncService } from './flow-langflow-sync.service'

/**
 * 流程执行监控数据（经服务端转发至执行后端 Monitor API）；路径不出现引擎名称。
 *
 * 进程内路径（网关对外一般为 `/api/flows/...`）：
 * - `GET /flows/:id/monitor/traces`
 * - `GET /flows/:id/monitor/builds`
 */
@Injectable()
@Controller('/flows')
export class FlowMonitorController {
  public constructor(
    private readonly crud: FlowCrudService,
    private readonly lfSync: FlowLangflowSyncService,
  ) {}

  private async requireBoundExecutionFlowId(ref: string): Promise<string> {
    const detail = await this.crud.get(ref)
    const bound = detail.langflowFlowId?.trim()
    if (!bound) {
      throw new BadRequestException('流程未绑定执行后端，无法查询监控数据')
    }
    return bound
  }

  @GET('/:id/monitor/traces')
  @ApiOperation({
    summary: '流程执行痕迹（traces）',
    description:
      '分页查询 trace 元数据与总延迟等；query 支持 page、size 等（与执行后端 Monitor 约定一致），远端 flow 标识由当前流程绑定自动注入。',
    operationId: 'getFlowMonitorTraces',
  })
  @ApiResponse({
    status: 200,
    description: 'Monitor traces 列表结构（随执行后端版本）',
    schema: {
      type: 'object',
      additionalProperties: true,
    } as Record<string, unknown>,
  })
  @ApiResponse({ status: 400, description: '流程未绑定执行后端' })
  @ApiResponse({ status: 401, description: '执行后端鉴权失败' })
  @ApiResponse({ status: 403, description: '执行后端拒绝访问该 flow 的监控数据' })
  @ApiResponse({ status: 404, description: '执行后端未找到资源' })
  @ApiResponse({ status: 502, description: '执行后端其它错误' })
  @ApiResponse({ status: 503, description: '未配置执行后端' })
  @MockableEndpoint('flows.monitorTraces')
  public async getTraces(
    @Param('id')
    @ApiParam({ name: 'id', in: 'path', required: true, description: '流程 id 或唯一名称' })
    id: string,
    @ContextParam() ctx: Context,
  ): Promise<Record<string, unknown>> {
    const executionFlowId = await this.requireBoundExecutionFlowId(id)
    return this.lfSync.fetchMonitorTracesForFlow(executionFlowId, ctx.url.searchParams)
  }

  @GET('/:id/monitor/builds')
  @ApiOperation({
    summary: '顶点构建记录（含组件耗时）',
    description:
      '查询各顶点构建详情（含耗时字段）；query 与执行后端 Monitor 约定一致，远端 flow 标识由绑定注入。调试性能瓶颈时使用。',
    operationId: 'getFlowMonitorBuilds',
  })
  @ApiResponse({
    status: 200,
    description: '顶点构建记录结构（随执行后端版本）',
    schema: {
      type: 'object',
      additionalProperties: true,
    } as Record<string, unknown>,
  })
  @ApiResponse({ status: 400, description: '流程未绑定执行后端' })
  @ApiResponse({ status: 401, description: '执行后端鉴权失败' })
  @ApiResponse({ status: 403, description: '执行后端拒绝访问该 flow 的监控数据' })
  @ApiResponse({ status: 404, description: '执行后端未找到资源' })
  @ApiResponse({ status: 502, description: '执行后端其它错误' })
  @ApiResponse({ status: 503, description: '未配置执行后端' })
  @MockableEndpoint('flows.monitorBuilds')
  public async getBuilds(
    @Param('id')
    @ApiParam({ name: 'id', in: 'path', required: true, description: '流程 id 或唯一名称' })
    id: string,
    @ContextParam() ctx: Context,
  ): Promise<Record<string, unknown>> {
    const executionFlowId = await this.requireBoundExecutionFlowId(id)
    return this.lfSync.fetchMonitorBuildsForFlow(executionFlowId, ctx.url.searchParams)
  }
}
