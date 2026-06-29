import { z } from "zod";

import { SfidSchema } from "../common/ids";
import { EpochMsSchema } from "../common/time";
import { toolCallIdSchema } from "../tool-ack/ack";

/**
 * Full SSE event definitions aligned with contracts.md §4.3.
 * Schema discriminator: `schema: "<name>-v{N}"` (lowercase-kebab-v{n})
 * Ref: docs/detailed-design/08-sdk/contracts.md §4.3
 */

// ── Turn events ──────────────────────────────────────────────────────────────

export const TurnStartedEventSchema = z.object({
  schema: z.literal("turn-started-v1"),
  startTime: EpochMsSchema,
  turnId: SfidSchema,
  turnNo: z.number().int().positive(),
  userMessageId: SfidSchema,
});
export type TurnStartedEvent = z.infer<typeof TurnStartedEventSchema>;

// `turn-phase-v1` 已于 ADR-0021 移除。取而代之的是 `reasoning-step-v1`，承载
// tachu 9 阶段（session / safety / intent / precheck / planning / graph-check /
// execution / validation / output）的结构化骨架，并支持嵌套 `model-reasoning`
// 子 step。需要"PRE_LLM/LLM/TOOL_USE/POST_LLM"四段粗粒度视图的消费方，应在
// 客户端按 `reasoning-step-v1.phase` 自行聚合，而非依赖服务端事件。

export const TurnCompletedEventSchema = z.object({
  durationMs: z.number().int().nonnegative(),
  endTime: EpochMsSchema,
  finalMessageId: SfidSchema,
  schema: z.literal("turn-completed-v1"),
  tokenUsage: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  turnId: SfidSchema,
});
export type TurnCompletedEvent = z.infer<typeof TurnCompletedEventSchema>;

export const TurnCancelledEventSchema = z.object({
  endTime: EpochMsSchema,
  reason: z.enum(["USER_REQUEST", "CLIENT_DISCONNECT", "TIMEOUT", "ADMINISTRATIVE"]),
  schema: z.literal("turn-cancelled-v1"),
  turnId: SfidSchema,
});
export type TurnCancelledEvent = z.infer<typeof TurnCancelledEventSchema>;

export const TurnFailedEventSchema = z.object({
  endTime: EpochMsSchema,
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
  schema: z.literal("turn-failed-v1"),
  turnId: SfidSchema,
});
export type TurnFailedEvent = z.infer<typeof TurnFailedEventSchema>;

export const IntentRoutingEventSchema = z.object({
  /** 当 `state=fallback` 且因同 priority 并列触发「交给主模型选」时为 true（ADR-0020）。 */
  multiMatch: z.boolean().optional(),
  schema: z.literal("intent-routing-v1"),
  state: z.enum(["matched", "fallback", "empty"]),
  turnId: SfidSchema,
});
export type IntentRoutingEvent = z.infer<typeof IntentRoutingEventSchema>;

export const EffectiveRouteResolvedEventSchema = z.object({
  effective: z.object({
    modelCode: z.string(),
    providerCode: z.string().optional(),
    providerId: z.string().optional(),
  }),
  reason: z.enum(["DIRECT", "IMAGE_CAPABILITY_REROUTE", "FALLBACK"]),
  requested: z.object({
    modelCode: z.string().optional(),
    providerCode: z.string().optional(),
    providerId: z.string().optional(),
  }),
  schema: z.literal("effective-route-resolved-v1"),
  turnId: SfidSchema,
});
export type EffectiveRouteResolvedEvent = z.infer<typeof EffectiveRouteResolvedEventSchema>;

// ── Message events ────────────────────────────────────────────────────────────

/**
 * `message-delta-v1` 仅承载**面向用户的最终答复正文**增量。
 *
 * ADR-0021：原 `delta: { type: 'reasoning' }` 分支已移除。模型自身的思考过程
 * 与引擎 9 阶段骨架统一通过 `reasoning-step-v1` + `reasoning-delta-v1` 两条
 * 新 schema 传输；前者负责生命周期（START/END、嵌套），后者负责文本流。
 */
export const MessageDeltaEventSchema = z.object({
  delta: z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  messageId: SfidSchema,
  schema: z.literal("message-delta-v1"),
  seqInTurn: z.number().int().positive(),
  turnId: SfidSchema,
});
export type MessageDeltaEvent = z.infer<typeof MessageDeltaEventSchema>;

export const MessageCompletedEventSchema = z.object({
  messageId: SfidSchema,
  schema: z.literal("message-completed-v1"),
  turnId: SfidSchema,
});
export type MessageCompletedEvent = z.infer<typeof MessageCompletedEventSchema>;

// ── Reasoning events (ADR-0021) ───────────────────────────────────────────────
//
// 双事件分离：`reasoning-step-v1` 管生命周期（START/END、嵌套）；
// `reasoning-delta-v1` 管文本增量。
//
// `kind` 枚举：
//   - `phase`：tachu 9 阶段骨架，必填 `phase` 字段，顶层 step（parentStepId 缺省）
//   - `model-reasoning`：模型自身 reasoning（DeepSeek-R1 / o-series 等）
//     由 mapper 在首次看到 reasoning-delta chunk 时自动开启；以最近一次活跃
//     phase step 为 parent，构成「阶段 → 子思考」一层嵌套
//   - `tool-loop`：tachu Phase 7 execution 内的一轮 Agentic Loop 决策过程；
//     中间模型话术与工具调用挂在该 step 下，不进入最终 message.delta
//
// 注意：本仓策略明确"reasoning 不入库、仅当前对话展示"。OutboxWriter 与
// messages.content_json 均不消费这两条事件；SSE replay buffer 一视同仁。
//
// ref: docs/adr/ADR-0021-sse-reasoning-step-and-delta.md

/** Reasoning step lifecycle event：START / END 两态。 */
export const ReasoningStepEventSchema = z.object({
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
  event: z.enum(["START", "END"]),
  kind: z.enum(["phase", "model-reasoning", "tool-loop"]),
  /** 客户端展示标签；mapper 内置 phase → 中文映射可被宿主覆盖。 */
  label: z.string(),
  /** 弹性槽位：planning 阶段可放 RankedPlan 概要等结构化补充。 */
  meta: z.record(z.string(), z.unknown()).optional(),
  /** 仅 `event === 'END'` 存在。 */
  ok: z.boolean().optional(),
  /** 顶层 phase step 缺省；嵌套子 step（`model-reasoning` 等）必填。 */
  parentStepId: SfidSchema.optional(),
  /** 仅当 `kind === 'phase'` 时存在；与 tachu `EnginePhase` 字面量一致。 */
  phase: z.enum(["session", "safety", "intent", "precheck", "planning", "graph-check", "execution", "validation", "output"]).optional(),
  schema: z.literal("reasoning-step-v1"),
  /** 由 SfidService.next() 生成，与 turnId/messageId 同体系。 */
  stepId: SfidSchema,
  time: EpochMsSchema,
  turnId: SfidSchema,
});
export type ReasoningStepEvent = z.infer<typeof ReasoningStepEventSchema>;

/** Reasoning text delta event：附属于某个 step；step 内 `seqInStep` 单调。 */
export const ReasoningDeltaEventSchema = z.object({
  schema: z.literal("reasoning-delta-v1"),
  /** Step 范围序号；step 内从 1 起单调递增，与 `message-delta-v1.seqInTurn` 解耦。 */
  seqInStep: z.number().int().positive(),
  /**
   * `phase`：tachu 阶段进度文本（当前未使用，预留给将来按 phase 注释展示）
   * `model`：模型自身 reasoning_content 流（DeepSeek-R1 / o-series 等）
   * `tool-loop`：工具循环中的模型过程文本；不持久化为最终答案正文
   */
  source: z.enum(["phase", "model", "tool-loop"]),
  stepId: SfidSchema,
  text: z.string(),
  turnId: SfidSchema,
});
export type ReasoningDeltaEvent = z.infer<typeof ReasoningDeltaEventSchema>;

// ── Tool events ───────────────────────────────────────────────────────────────

export const ToolCallStartedEventSchema = z.object({
  args: z.record(z.string(), z.unknown()),
  meta: z.object({
    execution: z.enum(["LOCAL", "REMOTE", "LONG_RUNNING"]),
    consent: z.enum(["NEVER", "ON_FIRST_USE", "EACH_CALL", "ADMIN_ONLY"]),
  }),
  /** Optional reasoning phase parent; old engines may omit it. */
  parentStepId: SfidSchema.optional(),
  schema: z.literal("tool-call-started-v1"),
  toolCallId: toolCallIdSchema,
  toolName: z.string(),
  turnId: SfidSchema,
});
export type ToolCallStartedEvent = z.infer<typeof ToolCallStartedEventSchema>;

/**
 * Use a single flat schema for discriminated union compatibility.
 * `ok=true` → output present; `ok=false` → error present.
 */
export const ToolCallCompletedEventSchema = z.object({
  durationMs: z.number().int().nonnegative(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .optional(),
  ok: z.boolean(),
  output: z.unknown().optional(),
  /** Optional reasoning phase parent; old engines may omit it. */
  parentStepId: SfidSchema.optional(),
  schema: z.literal("tool-call-completed-v1"),
  toolCallId: toolCallIdSchema,
  toolName: z.string(),
  turnId: SfidSchema,
});
export type ToolCallCompletedEvent = z.infer<typeof ToolCallCompletedEventSchema>;

// ── Grant events ──────────────────────────────────────────────────────────────

export const GrantRequestEventSchema = z.object({
  argsPreview: z.record(z.string(), z.unknown()),
  expiresTime: EpochMsSchema,
  grantRequestId: SfidSchema,
  reason: z.string(),
  schema: z.literal("grant-request-v1"),
  scopeHint: z.enum(["PERSISTENT", "ONCE"]),
  toolName: z.string(),
  turnId: SfidSchema,
});
export type GrantRequestEvent = z.infer<typeof GrantRequestEventSchema>;

// ── Usage events ──────────────────────────────────────────────────────────────

const TokenUsageTripletSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

const UsageAttributionSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  parentId: z.string().optional(),
});

export const UsageDeltaV1EventSchema = z.object({
  accuracy: z.enum(["estimated", "final"]).optional(),
  attribution: UsageAttributionSchema.optional(),
  cumulative: TokenUsageTripletSchema,
  delta: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() }),
  schema: z.literal("usage-delta-v1"),
  terminal: z.enum(["cancelled", "failed", "disconnected"]).optional(),
  turnId: SfidSchema,
  usage: TokenUsageTripletSchema.optional(),
});
export type UsageDeltaV1Event = z.infer<typeof UsageDeltaV1EventSchema>;

export const UsageDeltaV2EventSchema = z.object({
  accuracy: z.enum(["estimated", "final"]).optional(),
  attribution: UsageAttributionSchema.optional(),
  cumulative: TokenUsageTripletSchema,
  schema: z.literal("usage-delta-v2"),
  terminal: z.enum(["cancelled", "failed", "disconnected"]).optional(),
  turnId: SfidSchema,
  usage: TokenUsageTripletSchema,
});
export type UsageDeltaV2Event = z.infer<typeof UsageDeltaV2EventSchema>;
export type UsageDeltaEvent = UsageDeltaV1Event | UsageDeltaV2Event;

// ── System events ─────────────────────────────────────────────────────────────

export const PingEventV2Schema = z.object({
  schema: z.literal("ping-v1"),
});
export type PingEventV2 = z.infer<typeof PingEventV2Schema>;

export const DrainModeEventSchema = z.object({
  reason: z.enum(["GRACEFUL_SHUTDOWN"]),
  reconnectHintMs: z.number().int().positive(),
  schema: z.literal("drain-mode-v1"),
});
export type DrainModeEvent = z.infer<typeof DrainModeEventSchema>;

// ── Union ─────────────────────────────────────────────────────────────────────

/**
 * Discriminated union on `schema` field (lowercase-kebab-v{N}).
 * SDK uses `sseEventSchema.safeParse()` — unknown schema → soft fail.
 * Ref: contracts.md §4.3 / §5.3
 */
export const SseEventSchema = z.discriminatedUnion("schema", [
  TurnStartedEventSchema,
  MessageDeltaEventSchema,
  MessageCompletedEventSchema,
  ReasoningStepEventSchema,
  ReasoningDeltaEventSchema,
  ToolCallStartedEventSchema,
  ToolCallCompletedEventSchema,
  GrantRequestEventSchema,
  UsageDeltaV1EventSchema,
  UsageDeltaV2EventSchema,
  TurnCompletedEventSchema,
  TurnCancelledEventSchema,
  TurnFailedEventSchema,
  IntentRoutingEventSchema,
  EffectiveRouteResolvedEventSchema,
  PingEventV2Schema,
  DrainModeEventSchema,
]);
export type SseEvent = z.infer<typeof SseEventSchema>;

/** SSE event ID format: <turnId_SFID>:<seq6> */
export const SseEventIdSchema = z.string().regex(/^\d{1,20}:\d{6}$/u);
export type SseEventId = z.infer<typeof SseEventIdSchema>;
