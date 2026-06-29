import { ApiBody, ApiOperation, ApiParam, ApiResponse, Body, Controller, Injectable, POST, Param } from "@dangao/bun-server";

import { MockableEndpoint } from "@cube-ai/ai-center/platform/server-mock";

import { normalizeRunBody } from "../contracts/cube-run";
import { FlowsService } from "../flows/flows.service";

/**
 * 开发者执行面：`POST /run/:flowId`（对外经由网关为 `/api/run/...`）。
 */
@Injectable()
@Controller("/run")
export class RunController {
  constructor(private readonly flows: FlowsService) {}

  /**
   * 触发流程执行。
   *
   * @param flowId 流程主键或可解析标识
   * @param body.input 用户输入文本
   * @param body.sessionId 会话 id（可选，用于延续上下文）
   * @param body.stream 是否流式返回；非 false 时返回 SSE
   * @param body.inputType 输入类型（可选，默认 chat）
   * @param body.outputType 输出类型（可选，默认 chat）
   * @param body.tweaks 运行时字段覆盖（可选）
   * @returns 流式时返回 text/event-stream；非流式返回执行结果 JSON
   */
  @POST("/:flowId")
  @ApiOperation({
    description: "执行指定流程。stream !== false 时返回 SSE；stream=false 时返回同步 JSON。",
    operationId: "invokeRun",
    summary: "执行流程（Run API）",
  })
  @ApiBody({
    description: "执行参数",
    required: true,
    schema: {
      properties: {
        input: { description: "用户输入文本", type: "string" },
        inputType: { description: "可选，输入类型（默认 chat）", type: "string" },
        outputType: { description: "可选，输出类型（默认 chat）", type: "string" },
        sessionId: { description: "可选，会话 id", type: "string" },
        stream: { description: "是否流式返回，默认 true", type: "boolean" },
        tweaks: {
          additionalProperties: { additionalProperties: true, type: "object" },
          description: "可选，运行时覆盖参数",
          type: "object",
        },
      },
      type: "object",
    },
  })
  @ApiResponse({
    description: "执行结果（流式或非流式）",
    schema: {
      type: "object",
      additionalProperties: true,
      description: "仅非流式时可视为 JSON 结构；流式时请按 SSE 解析",
    } as Record<string, unknown>,
    status: 200,
  })
  @MockableEndpoint("run.invoke")
  invoke(
    @Param("flowId")
    @ApiParam({
      description: "流程主键或名称",
      in: "path",
      name: "flowId",
      required: true,
      schema: { type: "string" },
    })
    flowId: string,
    @Body() body: unknown,
  ) {
    const norm = normalizeRunBody(body);
    if (norm.stream !== false) {
      return this.flows.runStream(flowId, body);
    }
    return this.flows.run(flowId, body);
  }
}
