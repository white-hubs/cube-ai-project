import { ApiBody, ApiOperation, ApiParam, ApiResponse, Body, Controller, Injectable, Param, POST } from '@dangao/bun-server'
import { normalizeRunBody } from '../contracts/cube-run'
import { FlowsService } from '../flows/flows.service'
import { MockableEndpoint } from '@cube-ai/ai-center/platform/server-mock'

/**
 * 开发者执行面：`POST /run/:flowId`（对外经由网关为 `/api/run/...`）。
 */
@Injectable()
@Controller('/run')
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
  @POST('/:flowId')
  @ApiOperation({
    summary: '执行流程（Run API）',
    description: '执行指定流程。stream !== false 时返回 SSE；stream=false 时返回同步 JSON。',
    operationId: 'invokeRun',
  })
  @ApiBody({
    description: '执行参数',
    required: true,
    schema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '用户输入文本' },
        sessionId: { type: 'string', description: '可选，会话 id' },
        stream: { type: 'boolean', description: '是否流式返回，默认 true' },
        inputType: { type: 'string', description: '可选，输入类型（默认 chat）' },
        outputType: { type: 'string', description: '可选，输出类型（默认 chat）' },
        tweaks: {
          type: 'object',
          additionalProperties: { type: 'object', additionalProperties: true },
          description: '可选，运行时覆盖参数',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '执行结果（流式或非流式）',
    schema: {
      type: 'object',
      additionalProperties: true,
      description: '仅非流式时可视为 JSON 结构；流式时请按 SSE 解析',
    } as Record<string, unknown>,
  })
  @MockableEndpoint('run.invoke')
  invoke(
    @Param('flowId')
    @ApiParam({
      name: 'flowId',
      in: 'path',
      required: true,
      description: '流程主键或名称',
      schema: { type: 'string' },
    })
    flowId: string,
    @Body() body: unknown,
  ) {
    const norm = normalizeRunBody(body)
    if (norm.stream !== false) {
      return this.flows.runStream(flowId, body)
    }
    return this.flows.run(flowId, body)
  }
}
