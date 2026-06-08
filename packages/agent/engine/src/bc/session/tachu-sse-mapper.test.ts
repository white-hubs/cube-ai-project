import { describe, expect, test } from 'bun:test';
import { HostError } from '@tachu/core';
import type { EngineOutput, StreamChunkPayload } from '@tachu/core';
import {
  createTachuSseMapperState,
  mapStreamChunkToSseEvents,
} from './tachu-sse-mapper';

function makeEngineOutput(input: {
  content: string;
  tokenUsage?: { input: number; output: number; total: number };
  durationMs?: number;
}): EngineOutput {
  return {
    type: 'text',
    content: input.content,
    steps: [],
    metadata: {
      outcome: 'completed',
      toolCalls: [],
      durationMs: input.durationMs ?? 0,
      tokenUsage: input.tokenUsage ?? { input: 0, output: 0, total: 0 },
    },
    correlation: {
      traceId:   'trace-test',
      requestId: 'trace-test',
      sessionId: 'session-test',
      turnId:    TURN_ID,
    },
    deliveryMode: 'streaming',
  };
}

/**
 * Tachu StreamChunk → SSE event 单元测试。
 *
 * 这一组测试把 tachu.Engine.runStream 产出的 chunk 流和本仓 SSE 事件协议（v1）
 * 之间的映射钉死在一处，让 TurnService 只剩一条"逐 chunk dispatch"的循环。
 * mapper 自己不做副作用、不知道 SSE 传输层——纯函数。
 */

const TURN_ID = '2054102360564695041';
const MESSAGE_ID = '2054102360564695042';

/**
 * 单调递增 stub：模拟 SfidService 的 19 位十进制 ID 产出（ADR-0021）。
 * 起始值取 `2054102360564695100`，与 TURN_ID/MESSAGE_ID 同段，避免与已有
 * SFID 冲突；本测试只关心其单调性与 19 位长度。
 */
function makeStubNextSfid(start = 2054102360564695100n): () => string {
  let n = start;
  return () => {
    const cur = n;
    n += 1n;
    return cur.toString();
  };
}

describe('mapStreamChunkToSseEvents', () => {
  test('{type:"delta", content:"Hi"} → exactly one message.delta event with text payload and advances seqInTurn', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const chunk: StreamChunkPayload = { type: 'delta', content: 'Hi' };

    const events = mapStreamChunkToSseEvents(state, chunk);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      sseEvent: 'message.delta',
      payload: {
        schema: 'message-delta-v1',
        turnId: TURN_ID,
        messageId: MESSAGE_ID,
        seqInTurn: 1,
        delta: { type: 'text', text: 'Hi' },
      },
    });
    // 第二次 delta 应自增到 2
    expect(state.seqInTurn).toBe(2);
  });

  test('{type:"usage"} legacy mid-stream chunks still emit nothing', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });

    const first = mapStreamChunkToSseEvents(state, {
      type: 'usage',
      tokens: 50,
      toolCalls: 0,
      wallTimeMs: 100,
    });
    expect(first).toEqual([]);

    const second = mapStreamChunkToSseEvents(state, {
      type: 'usage',
      tokens: 120,
      toolCalls: 1,
      wallTimeMs: 250,
    });
    expect(second).toEqual([]);
  });

  test('{type:"usage"} structured LLM usage chunk emits live usage.delta-v2 with attribution', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });

    const events = mapStreamChunkToSseEvents(state, {
      type: 'usage',
      tokens: 18,
      toolCalls: 0,
      wallTimeMs: 100,
      usage: { input: 10, output: 8, total: 18 },
      cumulative: { input: 10, output: 8, total: 18 },
      attribution: {
        id: '2054102360564695999',
        kind: 'llm_call',
        parentId: '2054102360564695100',
        label: 'direct-answer',
        meta: { phase: 'execution', provider: 'openai', model: 'gpt-4o-mini' },
      },
      accuracy: 'estimated',
    });

    expect(events).toEqual([
      {
        sseEvent: 'usage.delta',
        payload: {
          schema: 'usage-delta-v2',
          turnId: TURN_ID,
          cumulative: { input: 10, output: 8, total: 18 },
          usage: { input: 10, output: 8, total: 18 },
          attribution: {
            id: '2054102360564695999',
            kind: 'llm_call',
            parentId: '2054102360564695100',
            label: 'direct-answer',
            meta: { phase: 'execution', provider: 'openai', model: 'gpt-4o-mini' },
          },
          accuracy: 'estimated',
        },
      },
    ]);
  });

  test('{type:"tool-call-start"} → one tool.call.started with parsed args (JSON) and default meta; records start time', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(
      state,
      {
        type: 'tool-call-start',
        callId: 'tcall_alpha_1',
        tool: 'platform.knowledge.query',
        argumentsPreview: '{"query":"hello"}',
      },
      () => 1_700_000_000_500,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      sseEvent: 'tool.call.started',
      payload: {
        schema: 'tool-call-started-v1',
        turnId: TURN_ID,
        toolCallId: 'tcall_alpha_1',
        toolName: 'platform.knowledge.query',
        args: { query: 'hello' },
        // tachu chunk 不携带 execution/consent；默认安全档：本地、首次同意。
        meta: { execution: 'LOCAL', consent: 'ON_FIRST_USE' },
      },
    });
    expect(state.pendingToolCalls.get('tcall_alpha_1')?.startedAt).toBe(1_700_000_000_500);
  });

  test('{type:"tool-call-start"} for mcp.web-search.* → meta REMOTE + consent NEVER（与 bridge 注册一致）', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(state, {
      type: 'tool-call-start',
      callId: 'tcall_ws_1',
      tool: 'mcp.web-search.web_search',
      argumentsPreview: '{"query":"news"}',
    });
    expect(events[0]?.payload).toMatchObject({
      toolName: 'mcp.web-search.web_search',
      meta: { execution: 'REMOTE', consent: 'NEVER' },
    });
  });

  test('{type:"tool-call-start"} with non-JSON argumentsPreview → args defaults to {} (no crash on malformed preview)', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(state, {
      type: 'tool-call-start',
      callId: 'tcall_beta_1',
      tool: 'some.tool',
      argumentsPreview: 'not-json-but-truncated…',
    });
    expect(events[0]?.payload).toMatchObject({
      toolCallId: 'tcall_beta_1',
      toolName: 'some.tool',
      args: {},
    });
  });

  test('{type:"tool-call-start"} inside active phase attaches parentStepId to the current phase step', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: 'phase-enter', phase: 'execution' });

    const events = mapStreamChunkToSseEvents(state, {
      type: 'tool-call-start',
      callId: 'tcall_parented_1',
      tool: 'platform.knowledge.query',
      argumentsPreview: '{"query":"hello"}',
    });

    expect(events[0]?.payload).toMatchObject({
      schema: 'tool-call-started-v1',
      toolCallId: 'tcall_parented_1',
      parentStepId: '2054102360564695100',
    });
  });

  test('{type:"tool-call-end"} success=true → one tool.call.completed with ok:true and durationMs from chunk', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(state, {
      type: 'tool-call-end',
      callId: 'tcall_alpha_1',
      tool: 'platform.knowledge.query',
      success: true,
      durationMs: 123,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      sseEvent: 'tool.call.completed',
      payload: {
        schema: 'tool-call-completed-v1',
        turnId: TURN_ID,
        toolCallId: 'tcall_alpha_1',
        toolName: 'platform.knowledge.query',
        durationMs: 123,
        ok: true,
      },
    });
  });

  test('{type:"tool-call-end"} reuses the parentStepId captured by tool-call-start', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: 'phase-enter', phase: 'execution' });
    mapStreamChunkToSseEvents(state, {
      type: 'tool-call-start',
      callId: 'tcall_parented_2',
      tool: 'platform.knowledge.query',
      argumentsPreview: '{}',
    });
    mapStreamChunkToSseEvents(state, {
      type: 'phase-exit',
      phase: 'execution',
      ok: true,
    });

    const events = mapStreamChunkToSseEvents(state, {
      type: 'tool-call-end',
      callId: 'tcall_parented_2',
      tool: 'platform.knowledge.query',
      success: true,
      durationMs: 123,
    });

    expect(events[0]?.payload).toMatchObject({
      schema: 'tool-call-completed-v1',
      toolCallId: 'tcall_parented_2',
      parentStepId: '2054102360564695100',
    });
  });

  test('{type:"done"} with orphan tool-call-start（无 tool-call-end）→ 补 tool.call.completed，必要时再补 phase END + 三件终态', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: 'phase-enter', phase: 'execution' });
    mapStreamChunkToSseEvents(
      state,
      {
        type: 'tool-call-start',
        callId: 'orphan_call',
        tool: 'mcp.web-search.web_search',
        argumentsPreview: '{"query":"x"}',
      },
      () => 1_700_000_000_100,
    );
    const chunk: StreamChunkPayload = {
      type: 'done',
      output: makeEngineOutput({
        content: 'final answer',
        tokenUsage: { input: 30, output: 90, total: 120 },
      }),
    };
    const events = mapStreamChunkToSseEvents(state, chunk, () => 1_700_000_001_500);
    expect(events).toHaveLength(6);
    expect(events[0]).toEqual({
      sseEvent: 'tool.call.completed',
      payload: {
        schema: 'tool-call-completed-v1',
        turnId: TURN_ID,
        parentStepId: '2054102360564695100',
        toolCallId: 'orphan_call',
        toolName: 'mcp.web-search.web_search',
        durationMs: 1400,
        ok: true,
      },
    });
    expect(events[1]?.sseEvent).toBe('reasoning.step');
    expect(events[1]?.payload).toMatchObject({
      schema: 'reasoning-step-v1',
      kind: 'phase',
      event: 'END',
      phase: 'execution',
      ok: true,
    });
    expect(events[2]).toEqual({
      sseEvent: 'message.delta',
      payload: {
        schema:    'message-delta-v1',
        turnId:    TURN_ID,
        messageId: MESSAGE_ID,
        seqInTurn: 1,
        delta:     { type: 'text', text: 'final answer' },
      },
    });
    expect(events[3]?.sseEvent).toBe('message.completed');
    expect(events[4]?.sseEvent).toBe('usage.delta');
    expect(events[5]?.sseEvent).toBe('turn.completed');
    expect(state.pendingToolCalls.size).toBe(0);
  });

  test('{type:"done"} → synthetic message.delta (when none yet) + message.completed + usage.delta + turn.completed', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const chunk: StreamChunkPayload = {
      type: 'done',
      output: makeEngineOutput({
        content: 'final answer',
        tokenUsage: { input: 30, output: 90, total: 120 },
      }),
    };
    const events = mapStreamChunkToSseEvents(state, chunk, () => 1_700_000_001_500);

    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({
      sseEvent: 'message.delta',
      payload: {
        schema:    'message-delta-v1',
        turnId:    TURN_ID,
        messageId: MESSAGE_ID,
        seqInTurn: 1,
        delta:     { type: 'text', text: 'final answer' },
      },
    });
    expect(events[1]).toEqual({
      sseEvent: 'message.completed',
      payload: {
        schema: 'message-completed-v1',
        turnId: TURN_ID,
        messageId: MESSAGE_ID,
      },
    });
    expect(events[2]).toEqual({
      sseEvent: 'usage.delta',
      payload: {
        schema: 'usage-delta-v2',
        turnId: TURN_ID,
        // 单次权威 emit：usage == cumulative，从 output.metadata.tokenUsage 取准确拆分
        usage: { input: 30, output: 90, total: 120 },
        cumulative: { input: 30, output: 90, total: 120 },
      },
    });
    expect(events[3]).toEqual({
      sseEvent: 'turn.completed',
      payload: {
        schema: 'turn-completed-v1',
        turnId: TURN_ID,
        finalMessageId: MESSAGE_ID,
        tokenUsage: { input: 30, output: 90, total: 120 },
        durationMs: 1_500,
        endTime: 1_700_000_001_500,
      },
    });
  });

  test('{type:"done"} does not emit synthetic message.delta when stream already had text-delta', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: 'delta', content: 'already streamed' });
    const events = mapStreamChunkToSseEvents(
      state,
      {
        type: 'done',
        output: makeEngineOutput({
          content: 'already streamed',
          tokenUsage: { input: 30, output: 90, total: 120 },
        }),
      },
      () => 1_700_000_001_500,
    );
    expect(events).toHaveLength(3);
    expect(events.some((e) => e.sseEvent === 'message.delta')).toBe(false);
  });

  test('{type:"done"} after reasoning-delta-only path emits synthetic message.delta before completed', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: 'phase-enter', phase: 'output' });
    mapStreamChunkToSseEvents(state, { type: 'reasoning-delta', content: '模型内部思考…' });
    const events = mapStreamChunkToSseEvents(
      state,
      {
        type: 'done',
        output: makeEngineOutput({
          content: '面向用户的最终句子。',
          tokenUsage: { input: 5, output: 10, total: 15 },
        }),
      },
      () => 1_700_000_001_500,
    );
    const deltaIdx = events.findIndex((e) => e.sseEvent === 'message.delta');
    const completedIdx = events.findIndex((e) => e.sseEvent === 'message.completed');
    expect(deltaIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBeGreaterThan(deltaIdx);
    if (events[deltaIdx]?.sseEvent === 'message.delta') {
      expect(events[deltaIdx].payload).toMatchObject({
        schema: 'message-delta-v1',
        delta: { type: 'text', text: '面向用户的最终句子。' },
      });
    }
  });

  test('{type:"done"} with whitespace-only output does not emit synthetic message.delta', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(
      state,
      {
        type: 'done',
        output: makeEngineOutput({
          content: '  \n\t  ',
          tokenUsage: { input: 0, output: 0, total: 0 },
        }),
      },
      () => 1_700_000_001_500,
    );
    expect(events.some((e) => e.sseEvent === 'message.delta')).toBe(false);
    expect(events).toHaveLength(3);
  });

  test('{type:"error"} → one turn.failed event with code/message/retryable mapped from EngineError', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const err = new HostError('HOST_FAILURE', 'provider exploded', { retryable: true });
    const events = mapStreamChunkToSseEvents(
      state,
      { type: 'error', error: err },
      () => 1_700_000_000_999,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      sseEvent: 'turn.failed',
      payload: {
        schema: 'turn-failed-v1',
        turnId: TURN_ID,
        error: {
          code: 'HOST_FAILURE',
          message: 'provider exploded',
          retryable: true,
        },
        endTime: 1_700_000_000_999,
      },
    });
    expect(state.turnFailedEmitted).toBe(true);
  });

  test('second {type:"error"} in the same run does NOT emit a duplicate turn.failed', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const err1 = new HostError('FIRST_ERROR', 'first', { retryable: false });
    const err2 = new HostError('SECOND_ERROR', 'second', { retryable: false });
    const first = mapStreamChunkToSseEvents(state, { type: 'error', error: err1 });
    const second = mapStreamChunkToSseEvents(state, { type: 'error', error: err2 });
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  test('{type:"tool-call-end"} success=false with error → tool.call.completed ok:false with error block', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(state, {
      type: 'tool-call-end',
      callId: 'tcall_alpha_2',
      tool: 'platform.flow.invoke',
      success: false,
      durationMs: 88,
      error: {
        code: 'TOOL_EXECUTION_FAILED',
        message: 'flow not found',
        retryable: false,
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      sseEvent: 'tool.call.completed',
      payload: {
        schema: 'tool-call-completed-v1',
        turnId: TURN_ID,
        toolCallId: 'tcall_alpha_2',
        toolName: 'platform.flow.invoke',
        durationMs: 88,
        ok: false,
        error: {
          code: 'TOOL_EXECUTION_FAILED',
          message: 'flow not found',
          retryable: false,
        },
      },
    });
  });

  // ── ADR-0021 reasoning step / delta mapper coverage ────────────────────────

  test('phase-enter chunk emits reasoning-step START with the right phase + 中文 label', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(
      state,
      { type: 'phase-enter', phase: 'planning' },
      () => 1_700_000_001_000,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      sseEvent: 'reasoning.step',
      payload: {
        schema: 'reasoning-step-v1',
        turnId: TURN_ID,
        stepId: '2054102360564695100',
        kind: 'phase',
        event: 'START',
        label: '任务规划',
        phase: 'planning',
        time: 1_700_000_001_000,
      },
    });
    expect(state.activePhaseStepId).toBe('2054102360564695100');
    expect(state.activePhase).toBe('planning');
  });

  test('reasoning-delta after phase-enter opens model-reasoning sub-step with parentStepId = phase step', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: 'phase-enter', phase: 'execution' });
    const events = mapStreamChunkToSseEvents(
      state,
      { type: 'reasoning-delta', content: '让我想想…' },
      () => 1_700_000_002_000,
    );
    // 首次 reasoning-delta：先 START 再 delta
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      sseEvent: 'reasoning.step',
      payload: {
        schema: 'reasoning-step-v1',
        turnId: TURN_ID,
        stepId: '2054102360564695101',
        parentStepId: '2054102360564695100',
        kind: 'model-reasoning',
        event: 'START',
        label: '模型思考',
        time: 1_700_000_002_000,
      },
    });
    expect(events[1]).toEqual({
      sseEvent: 'reasoning.delta',
      payload: {
        schema: 'reasoning-delta-v1',
        turnId: TURN_ID,
        stepId: '2054102360564695101',
        seqInStep: 1,
        text: '让我想想…',
        source: 'model',
      },
    });
    // 连续第二条 reasoning-delta 只发 delta（不重复 START），seq 递增
    const second = mapStreamChunkToSseEvents(state, {
      type: 'reasoning-delta',
      content: '继续思考…',
    });
    expect(second).toHaveLength(1);
    expect(second[0]?.sseEvent).toBe('reasoning.delta');
    if (second[0]?.sseEvent === 'reasoning.delta') {
      expect(second[0].payload.seqInStep).toBe(2);
    }
  });

  test('text-delta auto-closes active model-reasoning sub-step (Q5 boundary)', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: 'phase-enter', phase: 'execution' });
    mapStreamChunkToSseEvents(state, { type: 'reasoning-delta', content: 'thinking…' });
    expect(state.activeModelReasoningStepId).not.toBeNull();
    const events = mapStreamChunkToSseEvents(
      state,
      { type: 'delta', content: 'Hello' },
      () => 1_700_000_003_000,
    );
    // 应先 END model-reasoning，再 emit message.delta
    expect(events).toHaveLength(2);
    expect(events[0]?.sseEvent).toBe('reasoning.step');
    if (events[0]?.sseEvent === 'reasoning.step') {
      expect(events[0].payload.event).toBe('END');
      expect(events[0].payload.kind).toBe('model-reasoning');
      expect(events[0].payload.ok).toBe(true);
    }
    expect(events[1]?.sseEvent).toBe('message.delta');
    expect(state.activeModelReasoningStepId).toBeNull();
  });

  test('phase-exit closes the matching phase step + auto-closes sub model-reasoning', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: 'phase-enter', phase: 'planning' });
    mapStreamChunkToSseEvents(state, { type: 'reasoning-delta', content: 'plan thinking' });
    const events = mapStreamChunkToSseEvents(state, {
      type: 'phase-exit',
      phase: 'planning',
      ok: true,
    });
    // 顺序：先 model-reasoning END，再 phase END
    expect(events.map((e) => e.sseEvent)).toEqual(['reasoning.step', 'reasoning.step']);
    if (events[0]?.sseEvent === 'reasoning.step' && events[1]?.sseEvent === 'reasoning.step') {
      expect(events[0].payload.kind).toBe('model-reasoning');
      expect(events[0].payload.event).toBe('END');
      expect(events[1].payload.kind).toBe('phase');
      expect(events[1].payload.event).toBe('END');
      expect(events[1].payload.phase).toBe('planning');
      expect(events[1].payload.ok).toBe(true);
    }
    expect(state.activePhaseStepId).toBeNull();
    expect(state.activeModelReasoningStepId).toBeNull();
  });

  test('tool-loop lifecycle maps to nested reasoning step, process delta, and tool call parent', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: 'phase-enter', phase: 'execution' });

    const start = mapStreamChunkToSseEvents(
      state,
      { type: 'tool-loop-step', step: 1, maxSteps: 25 },
      () => 1_700_000_001_000,
    );
    expect(start).toHaveLength(1);
    expect(start[0]).toEqual({
      sseEvent: 'reasoning.step',
      payload: {
        schema: 'reasoning-step-v1',
        turnId: TURN_ID,
        stepId: '2054102360564695101',
        parentStepId: '2054102360564695100',
        kind: 'tool-loop',
        event: 'START',
        label: '工具循环第 1 轮',
        time: 1_700_000_001_000,
        meta: { step: 1, maxSteps: 25 },
      },
    });

    const delta = mapStreamChunkToSseEvents(state, {
      type: 'tool-loop-delta',
      step: 1,
      content: '我先搜索一下',
    });
    expect(delta).toHaveLength(1);
    expect(delta[0]).toEqual({
      sseEvent: 'reasoning.delta',
      payload: {
        schema: 'reasoning-delta-v1',
        turnId: TURN_ID,
        stepId: '2054102360564695101',
        seqInStep: 1,
        text: '我先搜索一下',
        source: 'tool-loop',
      },
    });

    const callStart = mapStreamChunkToSseEvents(state, {
      type: 'tool-call-start',
      callId: 'call-1',
      tool: 'mcp.web-search.web_search',
      argumentsPreview: '{"query":"x"}',
    });
    expect(callStart[0]?.sseEvent).toBe('tool.call.started');
    if (callStart[0]?.sseEvent === 'tool.call.started') {
      expect(callStart[0].payload.parentStepId).toBe('2054102360564695101');
    }

    const callEnd = mapStreamChunkToSseEvents(state, {
      type: 'tool-call-end',
      callId: 'call-1',
      tool: 'mcp.web-search.web_search',
      success: true,
      durationMs: 12,
      output: { raw: 'full output' },
    });
    expect(callEnd[0]?.sseEvent).toBe('tool.call.completed');
    if (callEnd[0]?.sseEvent === 'tool.call.completed') {
      expect(callEnd[0].payload.parentStepId).toBe('2054102360564695101');
      expect(callEnd[0].payload.output).toEqual({ raw: 'full output' });
    }

    const end = mapStreamChunkToSseEvents(state, {
      type: 'tool-loop-step-end',
      step: 1,
      success: true,
      reason: 'terminal',
    });
    expect(end[0]?.sseEvent).toBe('reasoning.step');
    if (end[0]?.sseEvent === 'reasoning.step') {
      expect(end[0].payload.kind).toBe('tool-loop');
      expect(end[0].payload.event).toBe('END');
      expect(end[0].payload.ok).toBe(true);
    }
  });

  test('error chunk force-ends active reasoning steps with ok=false TURN_INTERRUPTED', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: 'phase-enter', phase: 'execution' });
    mapStreamChunkToSseEvents(state, { type: 'reasoning-delta', content: 'in flight…' });
    const err = new HostError('PROVIDER_DOWN', 'upstream 503', { retryable: true });
    const events = mapStreamChunkToSseEvents(state, { type: 'error', error: err });
    // 顺序：先 model-reasoning END，再 phase END，最后 turn.failed
    const sseNames = events.map((e) => e.sseEvent);
    expect(sseNames).toEqual(['reasoning.step', 'reasoning.step', 'turn.failed']);
    if (events[0]?.sseEvent === 'reasoning.step') {
      expect(events[0].payload.event).toBe('END');
      expect(events[0].payload.ok).toBe(false);
      expect(events[0].payload.error?.code).toBe('TURN_INTERRUPTED');
    }
    if (events[1]?.sseEvent === 'reasoning.step') {
      expect(events[1].payload.event).toBe('END');
      expect(events[1].payload.ok).toBe(false);
    }
  });

});
