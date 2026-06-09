import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ContextParam,
  Controller,
  type Context,
  HttpException,
  Inject,
  Injectable,
  Param,
  POST,
} from '@dangao/bun-server'
import { APP_CONFIG_TOKEN, SnowflakeUtil, type AppConfig } from '@cube-ai/server-base'
import { currentTenantId } from '@cube-ai/server-shared'
import { FLOW_REPOSITORY_TOKEN, type FlowRepository } from '../db/repository-contracts'
import { FlowsService } from '../flows/flows.service'
import { MockableEndpoint } from '@cube-ai/server-mock'
import { verifyWebhookHmac } from './webhook-hmac'

function asRecord(x: unknown): Record<string, unknown> | null {
  if (x && typeof x === 'object' && !Array.isArray(x)) return x as Record<string, unknown>
  return null
}

/** 与框架 BodyParser 解析结果一致的可序列化字符串（用于落库；HMAC 需在 payload 与签名方约定同为紧凑 JSON）。 */
function bodyToStoredRaw(parsedUnknown: unknown): string {
  if (parsedUnknown === undefined || parsedUnknown === null) {
    return ''
  }
  if (typeof parsedUnknown === 'string') {
    return parsedUnknown
  }
  try {
    return JSON.stringify(parsedUnknown)
  } catch {
    return ''
  }
}

@Injectable()
@Controller('/webhook')
export class WebhookController {
  private readonly repo: FlowRepository
  private readonly webhookHmacSecret: string | undefined

  constructor(
    @Inject(APP_CONFIG_TOKEN) config: AppConfig,
    @Inject(FLOW_REPOSITORY_TOKEN) repo: FlowRepository,
    private readonly flows: FlowsService,
  ) {
    this.repo = repo
    this.webhookHmacSecret = config.webhookHmacSecret
  }

  /**
   * 接收外部 Webhook 并触发流程执行。
   *
   * @param flowId 目标流程 id
   * @param ctx 请求上下文（读取原始 JSON 及签名头）
   * @returns 流式执行响应（text/event-stream）
   */
  @POST('/:flowId')
  @ApiOperation({
    summary: 'Webhook 触发流程',
    description:
      '接收 JSON webhook，支持可选 HMAC 校验（x-cube-signature，对 application/json 体为对解析后对象做 JSON.stringify 的 UTF-8 串，与常见「先读再验签」在框架内预解析行为一致）。将 input/message/query 映射为执行输入并以流式方式执行流程。',
    operationId: 'receiveWebhook',
  })
  @ApiResponse({
    status: 200,
    description: '流程执行流式响应（SSE）',
    schema: {
      type: 'object',
      additionalProperties: true,
      description: '实际返回为 text/event-stream，请按 SSE 事件流消费',
    } as Record<string, unknown>,
  })
  @ApiResponse({ status: 401, description: '签名校验失败或缺少项目上下文' })
  @MockableEndpoint('webhook.receive')
  async receive(
    @Param('flowId')
    @ApiParam({
      name: 'flowId',
      in: 'path',
      required: true,
      description: '目标流程 id',
      schema: { type: 'string' },
    })
    flowId: string,
    @ContextParam() ctx: Context,
  ): Promise<Response> {
    // bun-server 会在进入控制器前对 POST 调用 context.getBody()，Request.body 只能读一次，禁止再 request.text()。
    const parsedUnknown = await ctx.getBody()
    const raw = bodyToStoredRaw(parsedUnknown)

    const secret = this.webhookHmacSecret
    if (secret) {
      const sig = ctx.request.headers.get('x-cube-signature')
      if (!verifyWebhookHmac(raw, sig, secret)) {
        throw new HttpException(401, 'invalid webhook signature', { code: 'WEBHOOK_SIGNATURE' })
      }
    }

    const parsed: unknown = parsedUnknown === undefined || parsedUnknown === null ? {} : parsedUnknown
    const o = asRecord(parsed) ?? {}
    const input =
      typeof o['input'] === 'string'
        ? o['input']
        : typeof o['message'] === 'string'
          ? o['message']
          : typeof o['query'] === 'string'
            ? o['query']
            : ''
    const runBody = { ...o, input, stream: o['stream'] !== false }
    const id = SnowflakeUtil.nextId()
    const now = new Date().toISOString()
    const resolvedFlowId = await this.flows.resolveFlowId(flowId)
    const flow = await this.repo.getFlow(resolvedFlowId, null)
    const tenantId = currentTenantId() ?? ''
    await this.repo.insertWebhookInvocation({
      id,
      flow_id: resolvedFlowId,
      project_id: tenantId || flow?.project_id || '__global__',
      source: ctx.request.headers.get('x-webhook-source'),
      payload_json: raw.slice(0, 500_000),
      status: 'accepted',
      create_time: now,
    })

    return this.flows.runStream(resolvedFlowId, runBody)
  }
}
