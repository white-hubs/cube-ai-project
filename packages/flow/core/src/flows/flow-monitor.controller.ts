import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  BadRequestException,
  type Context,
  ContextParam,
  Controller,
  GET,
  Injectable,
  Param,
} from "@dangao/bun-server";

import { MockableEndpoint } from "@cube-ai/ai-center/platform/server-mock";

import { FlowCrudService } from "./flow-crud.service";
import { FlowLangflowSyncService } from "./flow-langflow-sync.service";

/**
 * 流程执行监控数据（经服务端转发至执行后端 Monitor API）；路径不出现引擎名称。
 *
 * 进程内路径（网关对外一般为 `/api/flows/...`）：
 * - `GET /flows/:id/monitor/traces`
 * - `GET /flows/:id/monitor/builds`
 */
@Injectable()
@Controller("/flows")
export class FlowMonitorController {
  public constructor(
    private readonly crud: FlowCrudService,
    private readonly lfSync: FlowLangflowSyncService,
  ) {}

  private async requireBoundExecutionFlowId(ref: string): Promise<string> {
    const detail = await this.crud.get(ref);
    const bound = detail.langflowFlowId?.trim();
    if (!bound) {
      throw new BadRequestException("流程未绑定执行后端，无法查询监控数据");
    }
    return bound;
  }

  @GET("/:id/monitor/traces")
  @ApiOperation({
    description:
      "分页查询 trace 元数据与总延迟等；query 支持 page、size 等（与执行后端 Monitor 约定一致），远端 flow 标识由当前流程绑定自动注入。",
    operationId: "getFlowMonitorTraces",
    summary: "流程执行痕迹（traces）",
  })
  @ApiResponse({
    description: "Monitor traces 列表结构（随执行后端版本）",
    schema: {
      type: "object",
      additionalProperties: true,
    } as Record<string, unknown>,
    status: 200,
  })
  @ApiResponse({ description: "流程未绑定执行后端", status: 400 })
  @ApiResponse({ description: "执行后端鉴权失败", status: 401 })
  @ApiResponse({ description: "执行后端拒绝访问该 flow 的监控数据", status: 403 })
  @ApiResponse({ description: "执行后端未找到资源", status: 404 })
  @ApiResponse({ description: "执行后端其它错误", status: 502 })
  @ApiResponse({ description: "未配置执行后端", status: 503 })
  @MockableEndpoint("flows.monitorTraces")
  public async getTraces(
    @Param("id")
    @ApiParam({ description: "流程 id 或唯一名称", in: "path", name: "id", required: true })
    id: string,
    @ContextParam() ctx: Context,
  ): Promise<Record<string, unknown>> {
    const executionFlowId = await this.requireBoundExecutionFlowId(id);
    return this.lfSync.fetchMonitorTracesForFlow(executionFlowId, ctx.url.searchParams);
  }

  @GET("/:id/monitor/builds")
  @ApiOperation({
    description: "查询各顶点构建详情（含耗时字段）；query 与执行后端 Monitor 约定一致，远端 flow 标识由绑定注入。调试性能瓶颈时使用。",
    operationId: "getFlowMonitorBuilds",
    summary: "顶点构建记录（含组件耗时）",
  })
  @ApiResponse({
    description: "顶点构建记录结构（随执行后端版本）",
    schema: {
      type: "object",
      additionalProperties: true,
    } as Record<string, unknown>,
    status: 200,
  })
  @ApiResponse({ description: "流程未绑定执行后端", status: 400 })
  @ApiResponse({ description: "执行后端鉴权失败", status: 401 })
  @ApiResponse({ description: "执行后端拒绝访问该 flow 的监控数据", status: 403 })
  @ApiResponse({ description: "执行后端未找到资源", status: 404 })
  @ApiResponse({ description: "执行后端其它错误", status: 502 })
  @ApiResponse({ description: "未配置执行后端", status: 503 })
  @MockableEndpoint("flows.monitorBuilds")
  public async getBuilds(
    @Param("id")
    @ApiParam({ description: "流程 id 或唯一名称", in: "path", name: "id", required: true })
    id: string,
    @ContextParam() ctx: Context,
  ): Promise<Record<string, unknown>> {
    const executionFlowId = await this.requireBoundExecutionFlowId(id);
    return this.lfSync.fetchMonitorBuildsForFlow(executionFlowId, ctx.url.searchParams);
  }
}
