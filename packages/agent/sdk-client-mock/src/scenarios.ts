import {
  SseEventSchema,
  type SseEvent,
  type ErrorResponse,
} from '@cube-ai/contracts';

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
const MOCK_TURN_ID    = '1000000000000000001';
const MOCK_MSG_ID     = '1000000000000000002';
const MOCK_GRANT_ID   = '1000000000000000003';
const MOCK_TOOL_CALL  = 'tcall_mock_001';
const NOW = Date.now();

function makeId(n: string): string { return n; }

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
  name: 'turn_streaming',
  stream: [
    ev({ schema: 'turn-started-v1',      turnId: MOCK_TURN_ID, turnNo: 1, startTime: NOW, userMessageId: MOCK_MSG_ID }),
    ev({ schema: 'message-delta-v1',     turnId: MOCK_TURN_ID, messageId: MOCK_MSG_ID, seqInTurn: 1, delta: { type: 'text', text: 'Hello' } }),
    ev({ schema: 'message-delta-v1',     turnId: MOCK_TURN_ID, messageId: MOCK_MSG_ID, seqInTurn: 2, delta: { type: 'text', text: ', ' } }),
    ev({ schema: 'message-delta-v1',     turnId: MOCK_TURN_ID, messageId: MOCK_MSG_ID, seqInTurn: 3, delta: { type: 'text', text: 'world' } }),
    ev({ schema: 'message-delta-v1',     turnId: MOCK_TURN_ID, messageId: MOCK_MSG_ID, seqInTurn: 4, delta: { type: 'text', text: '!' } }),
    ev({ schema: 'message-delta-v1',     turnId: MOCK_TURN_ID, messageId: MOCK_MSG_ID, seqInTurn: 5, delta: { type: 'text', text: ' Done.' } }),
    ev({ schema: 'message-completed-v1', turnId: MOCK_TURN_ID, messageId: MOCK_MSG_ID }),
    ev({ schema: 'turn-completed-v1',    turnId: MOCK_TURN_ID, finalMessageId: MOCK_MSG_ID, tokenUsage: { input: 10, output: 15, total: 25 }, durationMs: 300, endTime: NOW + 300 }),
  ],
};

// ─── grant_requested ─────────────────────────────────────────────────────────

/**
 * Scenario: delta → grant-request → (client approves via REST) → delta → completed.
 * Tests consent flow.
 */
export const GRANT_REQUESTED: MockScenario = {
  name: 'grant_requested',
  stream: [
    ev({ schema: 'turn-started-v1',    turnId: MOCK_TURN_ID, turnNo: 1, startTime: NOW, userMessageId: MOCK_MSG_ID }),
    ev({ schema: 'message-delta-v1',   turnId: MOCK_TURN_ID, messageId: MOCK_MSG_ID, seqInTurn: 1, delta: { type: 'text', text: 'I need permission to access the database.' } }),
    ev({ schema: 'grant-request-v1',   turnId: MOCK_TURN_ID, grantRequestId: MOCK_GRANT_ID, toolName: 'platform.db.query', reason: 'Query user data', argsPreview: { table: 'users' }, scopeHint: 'PERSISTENT', expiresTime: NOW + 60_000 }),
    ev({ schema: 'message-delta-v1',   turnId: MOCK_TURN_ID, messageId: MOCK_MSG_ID, seqInTurn: 2, delta: { type: 'text', text: 'Thanks, proceeding with the query...' } }),
    ev({ schema: 'message-completed-v1', turnId: MOCK_TURN_ID, messageId: MOCK_MSG_ID }),
    ev({ schema: 'turn-completed-v1',  turnId: MOCK_TURN_ID, finalMessageId: MOCK_MSG_ID, tokenUsage: { input: 20, output: 30, total: 50 }, durationMs: 500, endTime: NOW + 500 }),
  ],
};

// ─── tool_approval ────────────────────────────────────────────────────────────

/**
 * Scenario: tool-call-started (REMOTE) → grant-request → tool-call-completed → done.
 * Tests tool approval with consent flow.
 */
export const TOOL_APPROVAL: MockScenario = {
  name: 'tool_approval',
  stream: [
    ev({ schema: 'turn-started-v1',         turnId: MOCK_TURN_ID, turnNo: 1, startTime: NOW, userMessageId: MOCK_MSG_ID }),
    ev({ schema: 'tool-call-started-v1',    turnId: MOCK_TURN_ID, toolCallId: MOCK_TOOL_CALL, toolName: 'admin.user.delete', args: { userId: '42' }, meta: { execution: 'REMOTE', consent: 'EACH_CALL' } }),
    ev({ schema: 'grant-request-v1',        turnId: MOCK_TURN_ID, grantRequestId: MOCK_GRANT_ID, toolName: 'admin.user.delete', reason: 'Delete user account', argsPreview: { userId: '42' }, scopeHint: 'ONCE', expiresTime: NOW + 60_000 }),
    ev({ schema: 'tool-call-completed-v1',  turnId: MOCK_TURN_ID, toolCallId: MOCK_TOOL_CALL, toolName: 'admin.user.delete', durationMs: 200, ok: true, output: { deleted: true } }),
    ev({ schema: 'message-completed-v1',    turnId: MOCK_TURN_ID, messageId: MOCK_MSG_ID }),
    ev({ schema: 'turn-completed-v1',       turnId: MOCK_TURN_ID, finalMessageId: MOCK_MSG_ID, tokenUsage: { input: 15, output: 20, total: 35 }, durationMs: 400, endTime: NOW + 400 }),
  ],
};

// ─── reasoning_streaming (@cube-ai/contracts SSE wire schema) ───────────────────────────────────────────

/**
 * Scenario: tachu 9 阶段骨架 + 模型 reasoning 嵌套子 step + 正文 delta。
 *
 * 用于 SDK / 前端开发自测 reasoning 渲染。事件顺序刻意拟合 mapper 真实行为：
 *   1. turn-started
 *   2. reasoning-step-v1 (phase=session START)
 *   3. reasoning-step-v1 (phase=session END)
 *   ...（中间阶段省略）
 *   4. reasoning-step-v1 (phase=execution START)
 *   5. reasoning-step-v1 (model-reasoning START, parent=execution)
 *   6. reasoning-delta-v1 ×N
 *   7. reasoning-step-v1 (model-reasoning END)  ← 由 text-delta 触发
 *   8. message-delta-v1 ×M
 *   9. reasoning-step-v1 (phase=execution END)
 *  10. message-completed / turn-completed
 */
const MOCK_PHASE_SESSION_STEP_ID = '1000000000000000010';
const MOCK_PHASE_EXEC_STEP_ID    = '1000000000000000011';
const MOCK_MODEL_REASONING_STEP_ID = '1000000000000000012';

export const REASONING_STREAMING: MockScenario = {
  name: 'reasoning_streaming',
  stream: [
    ev({ schema: 'turn-started-v1', turnId: MOCK_TURN_ID, turnNo: 1, startTime: NOW, userMessageId: MOCK_MSG_ID }),
    ev({ schema: 'reasoning-step-v1', turnId: MOCK_TURN_ID, stepId: MOCK_PHASE_SESSION_STEP_ID, kind: 'phase', event: 'START', label: '会话准备', phase: 'session', time: NOW + 5 }),
    ev({ schema: 'reasoning-step-v1', turnId: MOCK_TURN_ID, stepId: MOCK_PHASE_SESSION_STEP_ID, kind: 'phase', event: 'END',   label: '会话准备', phase: 'session', ok: true, time: NOW + 10 }),
    ev({ schema: 'reasoning-step-v1', turnId: MOCK_TURN_ID, stepId: MOCK_PHASE_EXEC_STEP_ID, kind: 'phase', event: 'START', label: '执行中', phase: 'execution', time: NOW + 20 }),
    ev({ schema: 'reasoning-step-v1', turnId: MOCK_TURN_ID, stepId: MOCK_MODEL_REASONING_STEP_ID, parentStepId: MOCK_PHASE_EXEC_STEP_ID, kind: 'model-reasoning', event: 'START', label: '模型思考', time: NOW + 30 }),
    ev({ schema: 'reasoning-delta-v1', turnId: MOCK_TURN_ID, stepId: MOCK_MODEL_REASONING_STEP_ID, seqInStep: 1, text: '让我先理解用户的目标…', source: 'model' }),
    ev({ schema: 'reasoning-delta-v1', turnId: MOCK_TURN_ID, stepId: MOCK_MODEL_REASONING_STEP_ID, seqInStep: 2, text: '看起来需要列举三个要点。', source: 'model' }),
    ev({ schema: 'reasoning-step-v1', turnId: MOCK_TURN_ID, stepId: MOCK_MODEL_REASONING_STEP_ID, parentStepId: MOCK_PHASE_EXEC_STEP_ID, kind: 'model-reasoning', event: 'END', label: '模型思考', ok: true, time: NOW + 80 }),
    ev({ schema: 'message-delta-v1', turnId: MOCK_TURN_ID, messageId: MOCK_MSG_ID, seqInTurn: 1, delta: { type: 'text', text: '答：第一，' } }),
    ev({ schema: 'message-delta-v1', turnId: MOCK_TURN_ID, messageId: MOCK_MSG_ID, seqInTurn: 2, delta: { type: 'text', text: '第二，' } }),
    ev({ schema: 'message-delta-v1', turnId: MOCK_TURN_ID, messageId: MOCK_MSG_ID, seqInTurn: 3, delta: { type: 'text', text: '第三。' } }),
    ev({ schema: 'reasoning-step-v1', turnId: MOCK_TURN_ID, stepId: MOCK_PHASE_EXEC_STEP_ID, kind: 'phase', event: 'END', label: '执行中', phase: 'execution', ok: true, time: NOW + 120 }),
    ev({ schema: 'message-completed-v1', turnId: MOCK_TURN_ID, messageId: MOCK_MSG_ID }),
    ev({ schema: 'turn-completed-v1', turnId: MOCK_TURN_ID, finalMessageId: MOCK_MSG_ID, tokenUsage: { input: 12, output: 18, total: 30 }, durationMs: 130, endTime: NOW + 130 }),
  ],
};

// ─── Health scenarios (legacy) ────────────────────────────────────────────────

export const HEALTH_UP: MockScenario = { name: 'health.up' };

export const HEALTH_DEGRADED: MockScenario = {
  name: 'health.degraded',
  error: {
    status:    502,
    code:      'UPSTREAM_LLM_UNAVAILABLE',
    message:   'Upstream dependency degraded',
    details:   null,
    timestamp: 0,
  },
};

// ─── Scenario registry ────────────────────────────────────────────────────────

export const SCENARIOS: Record<string, MockScenario> = {
  health_up:           HEALTH_UP,
  health_degraded:     HEALTH_DEGRADED,
  turn_streaming:      TURN_STREAMING,
  grant_requested:     GRANT_REQUESTED,
  tool_approval:       TOOL_APPROVAL,
  reasoning_streaming: REASONING_STREAMING,
};

export type ScenarioName = keyof typeof SCENARIOS;
