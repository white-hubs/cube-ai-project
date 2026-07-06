import { type ErrorResponse, type SseEvent, SseEventSchema } from "@cube-ai/contracts";

/**
 * Deterministic scenarios the mock can replay.
 * All events are validated against SseEventSchema on construction.
 * Ref: docs/detailed-design/08-sdk/sdk-mock.md §6 / P1-09 prompt §6.4
 */
export interface MockScenario {
  readonly name: string;
  /** Events streamed for POST /sessions/:id/messages */
  readonly stream?: readonly SseEvent[];
  /** Canned error response when a route is exercised */
  readonly error?: ErrorResponse;
}

// ─── Shared mock SFID values ──────────────────────────────────────────────────
const MOCK_TURN_ID = "1000000000000000001";
const MOCK_MSG_ID = "1000000000000000002";
const MOCK_GRANT_ID = "1000000000000000003";
const MOCK_TOOL_CALL = "tcall_mock_001";
const NOW = Date.now();

/** Validate and parse a raw event object into SseEvent (throws on schema violation). */
function ev(raw: unknown): SseEvent {
  return SseEventSchema.parse(raw);
}

// ─── turn_streaming ───────────────────────────────────────────────────────────

/**
 * Scenario: 5 text deltas + message-completed + turn-completed.
 * Tests happy-path streaming flow.
 */
export const TURN_STREAMING: MockScenario = {
  name: "turn_streaming",
  stream: [
    ev({ schema: "turn-started-v1", startTime: NOW, turnId: MOCK_TURN_ID, turnNo: 1, userMessageId: MOCK_MSG_ID }),
    ev({ delta: { text: "Hello", type: "text" }, messageId: MOCK_MSG_ID, schema: "message-delta-v1", seqInTurn: 1, turnId: MOCK_TURN_ID }),
    ev({ delta: { text: ", ", type: "text" }, messageId: MOCK_MSG_ID, schema: "message-delta-v1", seqInTurn: 2, turnId: MOCK_TURN_ID }),
    ev({ delta: { text: "world", type: "text" }, messageId: MOCK_MSG_ID, schema: "message-delta-v1", seqInTurn: 3, turnId: MOCK_TURN_ID }),
    ev({ delta: { text: "!", type: "text" }, messageId: MOCK_MSG_ID, schema: "message-delta-v1", seqInTurn: 4, turnId: MOCK_TURN_ID }),
    ev({ delta: { text: " Done.", type: "text" }, messageId: MOCK_MSG_ID, schema: "message-delta-v1", seqInTurn: 5, turnId: MOCK_TURN_ID }),
    ev({ messageId: MOCK_MSG_ID, schema: "message-completed-v1", turnId: MOCK_TURN_ID }),
    ev({
      durationMs: 300,
      endTime: NOW + 300,
      finalMessageId: MOCK_MSG_ID,
      schema: "turn-completed-v1",
      tokenUsage: { input: 10, output: 15, total: 25 },
      turnId: MOCK_TURN_ID,
    }),
  ],
};

// ─── grant_requested ─────────────────────────────────────────────────────────

/**
 * Scenario: delta → grant-request → (client approves via REST) → delta → completed.
 * Tests consent flow.
 */
export const GRANT_REQUESTED: MockScenario = {
  name: "grant_requested",
  stream: [
    ev({ schema: "turn-started-v1", startTime: NOW, turnId: MOCK_TURN_ID, turnNo: 1, userMessageId: MOCK_MSG_ID }),
    ev({
      delta: { text: "I need permission to access the database.", type: "text" },
      messageId: MOCK_MSG_ID,
      schema: "message-delta-v1",
      seqInTurn: 1,
      turnId: MOCK_TURN_ID,
    }),
    ev({
      argsPreview: { table: "users" },
      expiresTime: NOW + 60_000,
      grantRequestId: MOCK_GRANT_ID,
      reason: "Query user data",
      schema: "grant-request-v1",
      scopeHint: "PERSISTENT",
      toolName: "platform.db.query",
      turnId: MOCK_TURN_ID,
    }),
    ev({
      delta: { text: "Thanks, proceeding with the query...", type: "text" },
      messageId: MOCK_MSG_ID,
      schema: "message-delta-v1",
      seqInTurn: 2,
      turnId: MOCK_TURN_ID,
    }),
    ev({ messageId: MOCK_MSG_ID, schema: "message-completed-v1", turnId: MOCK_TURN_ID }),
    ev({
      durationMs: 500,
      endTime: NOW + 500,
      finalMessageId: MOCK_MSG_ID,
      schema: "turn-completed-v1",
      tokenUsage: { input: 20, output: 30, total: 50 },
      turnId: MOCK_TURN_ID,
    }),
  ],
};

// ─── tool_approval ────────────────────────────────────────────────────────────

/**
 * Scenario: tool-call-started (REMOTE) → grant-request → tool-call-completed → done.
 * Tests tool approval with consent flow.
 */
export const TOOL_APPROVAL: MockScenario = {
  name: "tool_approval",
  stream: [
    ev({ schema: "turn-started-v1", startTime: NOW, turnId: MOCK_TURN_ID, turnNo: 1, userMessageId: MOCK_MSG_ID }),
    ev({
      args: { userId: "42" },
      meta: { consent: "EACH_CALL", execution: "REMOTE" },
      schema: "tool-call-started-v1",
      toolCallId: MOCK_TOOL_CALL,
      toolName: "admin.user.delete",
      turnId: MOCK_TURN_ID,
    }),
    ev({
      argsPreview: { userId: "42" },
      expiresTime: NOW + 60_000,
      grantRequestId: MOCK_GRANT_ID,
      reason: "Delete user account",
      schema: "grant-request-v1",
      scopeHint: "ONCE",
      toolName: "admin.user.delete",
      turnId: MOCK_TURN_ID,
    }),
    ev({
      durationMs: 200,
      ok: true,
      output: { deleted: true },
      schema: "tool-call-completed-v1",
      toolCallId: MOCK_TOOL_CALL,
      toolName: "admin.user.delete",
      turnId: MOCK_TURN_ID,
    }),
    ev({ messageId: MOCK_MSG_ID, schema: "message-completed-v1", turnId: MOCK_TURN_ID }),
    ev({
      durationMs: 400,
      endTime: NOW + 400,
      finalMessageId: MOCK_MSG_ID,
      schema: "turn-completed-v1",
      tokenUsage: { input: 15, output: 20, total: 35 },
      turnId: MOCK_TURN_ID,
    }),
  ],
};

// ─── reasoning_streaming (@cube-ai/contracts SSE wire schema) ───────────────────────────────────────────

/**
 * Scenario: loop-lifecycle 轮次里程碑 + 模型 reasoning 嵌套子 step + 正文 delta。
 *
 * 用于 SDK / 前端开发自测 reasoning 渲染。事件顺序刻意拟合 mapper 真实行为
 * （tachu rc.13：对外只暴露 turnStart / turnStop 粗粒度里程碑，不再泄漏内部 phase）：
 *   1. turn-started
 *   2. reasoning-step-v1 (lifecycle point=turnStart START) —— 轮次伞 step
 *   3. reasoning-step-v1 (model-reasoning START, parent=turnStart)
 *   4. reasoning-delta-v1 ×N
 *   5. reasoning-step-v1 (model-reasoning END)  ← 由 text-delta 触发
 *   6. message-delta-v1 ×M
 *   7. reasoning-step-v1 (lifecycle point=turnStart END) —— turnStop enter 时关闭
 *   8. reasoning-step-v1 (lifecycle point=turnStop START/END) —— 校验里程碑
 *   9. message-completed / turn-completed
 */
const MOCK_LIFECYCLE_START_STEP_ID = "1000000000000000010";
const MOCK_LIFECYCLE_STOP_STEP_ID = "1000000000000000011";
const MOCK_MODEL_REASONING_STEP_ID = "1000000000000000012";

export const REASONING_STREAMING: MockScenario = {
  name: "reasoning_streaming",
  stream: [
    ev({ schema: "turn-started-v1", startTime: NOW, turnId: MOCK_TURN_ID, turnNo: 1, userMessageId: MOCK_MSG_ID }),
    ev({
      event: "START",
      kind: "lifecycle",
      label: "开始处理",
      point: "turnStart",
      schema: "reasoning-step-v1",
      stepId: MOCK_LIFECYCLE_START_STEP_ID,
      time: NOW + 5,
      turnId: MOCK_TURN_ID,
    }),
    ev({
      event: "START",
      kind: "model-reasoning",
      label: "模型思考",
      parentStepId: MOCK_LIFECYCLE_START_STEP_ID,
      schema: "reasoning-step-v1",
      stepId: MOCK_MODEL_REASONING_STEP_ID,
      time: NOW + 30,
      turnId: MOCK_TURN_ID,
    }),
    ev({
      schema: "reasoning-delta-v1",
      seqInStep: 1,
      source: "model",
      stepId: MOCK_MODEL_REASONING_STEP_ID,
      text: "让我先理解用户的目标…",
      turnId: MOCK_TURN_ID,
    }),
    ev({
      schema: "reasoning-delta-v1",
      seqInStep: 2,
      source: "model",
      stepId: MOCK_MODEL_REASONING_STEP_ID,
      text: "看起来需要列举三个要点。",
      turnId: MOCK_TURN_ID,
    }),
    ev({
      event: "END",
      kind: "model-reasoning",
      label: "模型思考",
      ok: true,
      parentStepId: MOCK_LIFECYCLE_START_STEP_ID,
      schema: "reasoning-step-v1",
      stepId: MOCK_MODEL_REASONING_STEP_ID,
      time: NOW + 80,
      turnId: MOCK_TURN_ID,
    }),
    ev({
      delta: { text: "答：第一，", type: "text" },
      messageId: MOCK_MSG_ID,
      schema: "message-delta-v1",
      seqInTurn: 1,
      turnId: MOCK_TURN_ID,
    }),
    ev({ delta: { text: "第二，", type: "text" }, messageId: MOCK_MSG_ID, schema: "message-delta-v1", seqInTurn: 2, turnId: MOCK_TURN_ID }),
    ev({ delta: { text: "第三。", type: "text" }, messageId: MOCK_MSG_ID, schema: "message-delta-v1", seqInTurn: 3, turnId: MOCK_TURN_ID }),
    ev({
      event: "END",
      kind: "lifecycle",
      label: "开始处理",
      ok: true,
      point: "turnStart",
      schema: "reasoning-step-v1",
      stepId: MOCK_LIFECYCLE_START_STEP_ID,
      time: NOW + 115,
      turnId: MOCK_TURN_ID,
    }),
    ev({
      event: "START",
      kind: "lifecycle",
      label: "校验结果中",
      point: "turnStop",
      schema: "reasoning-step-v1",
      stepId: MOCK_LIFECYCLE_STOP_STEP_ID,
      time: NOW + 118,
      turnId: MOCK_TURN_ID,
    }),
    ev({
      event: "END",
      kind: "lifecycle",
      label: "校验结果中",
      ok: true,
      point: "turnStop",
      schema: "reasoning-step-v1",
      stepId: MOCK_LIFECYCLE_STOP_STEP_ID,
      time: NOW + 120,
      turnId: MOCK_TURN_ID,
    }),
    ev({ messageId: MOCK_MSG_ID, schema: "message-completed-v1", turnId: MOCK_TURN_ID }),
    ev({
      durationMs: 130,
      endTime: NOW + 130,
      finalMessageId: MOCK_MSG_ID,
      schema: "turn-completed-v1",
      tokenUsage: { input: 12, output: 18, total: 30 },
      turnId: MOCK_TURN_ID,
    }),
  ],
};

// ─── Health scenarios (legacy) ────────────────────────────────────────────────

export const HEALTH_UP: MockScenario = { name: "health.up" };

export const HEALTH_DEGRADED: MockScenario = {
  error: {
    code: "UPSTREAM_LLM_UNAVAILABLE",
    details: null,
    message: "Upstream dependency degraded",
    status: 502,
    timestamp: 0,
  },
  name: "health.degraded",
};

// ─── Scenario registry ────────────────────────────────────────────────────────

export const SCENARIOS: Record<string, MockScenario> = {
  grant_requested: GRANT_REQUESTED,
  health_degraded: HEALTH_DEGRADED,
  health_up: HEALTH_UP,
  reasoning_streaming: REASONING_STREAMING,
  tool_approval: TOOL_APPROVAL,
  turn_streaming: TURN_STREAMING,
};

export type ScenarioName = keyof typeof SCENARIOS;
