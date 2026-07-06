import { z } from "zod";

/**
 * FlowInvokerPort
 * Engine-side abstraction over the AI middle-platform Flow run endpoint.
 * Handler `platform.flow.invoke` consumes this port via DI; the production
 * implementation lives in `@cube-ai/platform-adapters-ghcloud`.
 *
 * v1 主路径：**同步**返回结构化 `result`（中台 `/run` 或等价 envelope 全文）；
 * 可选 `executionTrace` 由适配器在消费 `run-stream` 等流式接口时填充。
 *
 * ref: docs/detailed-design/07-tools/builtin-catalog.md §6
 */

const SfidStringSchema = z.string().regex(/^\d{19}$/u, "must be a 19-digit SFID");

export const FlowInvokeRequestSchema = z.object({
  flowId: z.string().min(1).max(64),
  tenant: z.number().int().min(0).max(2_147_483_647),
  traceId: z.string().min(1),
  /**
   * Optional OBO-issued user token. When present, adapter MUST forward it as
   * `Authorization: Bearer <token>`. When absent, adapter falls back to
   * service principal via the configured `tokenProvider(tenant)`.
   */
  userToken: z.string().min(1).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
});
export type FlowInvokeRequest = z.infer<typeof FlowInvokeRequestSchema>;

export const FlowExecutionTraceItemSchema = z.object({
  kind: z.string().min(1),
  payload: z.unknown().optional(),
  ts: z.string().optional(),
});
export type FlowExecutionTraceItem = z.infer<typeof FlowExecutionTraceItemSchema>;

/**
 * 同步 flow run 的引擎侧规范返回值（进入 `tool.call.completed` payload）。
 */
export const FlowInvokeSyncResponseSchema = z.object({
  error: z.unknown().optional(),
  executionTrace: z.array(FlowExecutionTraceItemSchema).optional(),
  partial: z.boolean().optional(),
  result: z.record(z.string(), z.unknown()),
  traceTruncated: z.boolean().optional(),
});
export type FlowInvokeSyncResponse = z.infer<typeof FlowInvokeSyncResponseSchema>;

export interface FlowInvokerPort {
  invoke(req: FlowInvokeRequest, signal: AbortSignal): Promise<FlowInvokeSyncResponse>;
}

/** @internal 测试与历史契约：旧版 scheduled job 形响应（仅作样例数据）。 */
export const LegacyFlowScheduledEnvelopeSchema = z.object({
  estimatedDurationMs: z.number().int().nonnegative().optional(),
  jobId: SfidStringSchema,
  remoteFlowRunId: z.string().min(1).optional(),
  scheduled: z.literal(true),
  statusUrl: z.string().min(1),
});
export type LegacyFlowScheduledEnvelope = z.infer<typeof LegacyFlowScheduledEnvelopeSchema>;
