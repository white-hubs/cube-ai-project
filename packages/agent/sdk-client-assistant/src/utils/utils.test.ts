import { describe, expect, test } from 'bun:test';
import {
  buildSystemSuffixFromMessages,
  extractAssistantMessageId,
  extractMessageDeltaChunk,
  extractTurnFailedMessage,
  extractTurnFailureSummary,
  extractTurnId,
  filterSessionsByKeyword,
  flattenAssistantContentPayload,
  formatReasoningElapsedMs,
  groupSessionsByDate,
  hasVisibleReasoning,
  isPlaceholderSessionTitle,
  joinContentBlockArray,
  reduceReasoningEvent,
  forceCloseActiveReasoning,
  shouldExpandReasoningStepByDefault,
} from './index';
import type {
  AssistantMessage,
  AssistantSessionSummary,
  ReasoningStep,
} from '../types';

describe('@cube-ai/agent-sdk-client-assistant utils', () => {
  test('formatReasoningElapsedMs ms → s → m → h ladder', () => {
    expect(formatReasoningElapsedMs(0)).toBe('0ms');
    expect(formatReasoningElapsedMs(800)).toBe('800ms');
    expect(formatReasoningElapsedMs(1500)).toBe('1.5s');
    expect(formatReasoningElapsedMs(10_000)).toBe('10s');
    expect(formatReasoningElapsedMs(125_000)).toBe('2m5s');
    expect(formatReasoningElapsedMs(3_661_000)).toBe('1h1m');
  });

  test('extractAssistantMessageId reads top-level and nested data.messageId', () => {
    expect(extractAssistantMessageId({ messageId: 'm-top', turnId: 't1' })).toBe('m-top');
    expect(
      extractAssistantMessageId({ data: { messageId: 'm-nested' } } as Record<string, unknown>),
    ).toBe('m-nested');
    expect(extractAssistantMessageId({ turnId: 't1' })).toBeNull();
  });

  test('extractTurnId reads top-level and nested', () => {
    expect(extractTurnId({ turnId: 't1' })).toBe('t1');
    expect(extractTurnId({ data: { turnId: 't2' } } as Record<string, unknown>)).toBe('t2');
    expect(extractTurnId({})).toBeNull();
  });

  test('groups sessions into today / yesterday / earlier', () => {
    const now = new Date('2026-05-12T10:00:00.000Z').getTime();
    const sessions: AssistantSessionSummary[] = [
      { id: 'a', title: 'today', updatedAt: new Date('2026-05-12T06:00:00.000Z').getTime() },
      { id: 'b', title: 'yesterday', updatedAt: new Date('2026-05-11T08:00:00.000Z').getTime() },
      { id: 'c', title: 'earlier', updatedAt: new Date('2026-05-10T08:00:00.000Z').getTime() },
    ];
    const grouped = groupSessionsByDate(sessions, now);
    expect(grouped.today.map((s) => s.id)).toEqual(['a']);
    expect(grouped.yesterday.map((s) => s.id)).toEqual(['b']);
    expect(grouped.earlier.map((s) => s.id)).toEqual(['c']);
  });

  test('filters sessions by keyword (case-insensitive substring)', () => {
    const sessions: AssistantSessionSummary[] = [
      { id: '1', title: '统计今日报警', updatedAt: 1 },
      { id: '2', title: '安全月报', updatedAt: 1 },
    ];
    expect(filterSessionsByKeyword(sessions, '报警').map((s) => s.id)).toEqual(['1']);
    expect(filterSessionsByKeyword(sessions, '   ').length).toBe(2);
  });

  test('isPlaceholderSessionTitle matches empty / 新会话 / 未命名', () => {
    expect(isPlaceholderSessionTitle('')).toBe(true);
    expect(isPlaceholderSessionTitle('新会话')).toBe(true);
    expect(isPlaceholderSessionTitle('新会话 17:00')).toBe(true);
    expect(isPlaceholderSessionTitle('未命名')).toBe(true);
    expect(isPlaceholderSessionTitle('讨论上周架构')).toBe(false);
  });

  test('buildSystemSuffixFromMessages slices last N user-assistant turns', () => {
    const messages: AssistantMessage[] = [
      { id: 'u1', role: 'user', content: '问题1', createdAt: 1 },
      { id: 'a1', role: 'assistant', content: '回答1', createdAt: 2 },
      { id: 'u2', role: 'user', content: '问题2', createdAt: 3 },
      { id: 'a2', role: 'assistant', content: '回答2', createdAt: 4 },
      { id: 'u3', role: 'user', content: '问题3', createdAt: 5 },
    ];
    const suffix = buildSystemSuffixFromMessages(messages, 2);
    expect(suffix).toContain('第1轮');
    expect(suffix).toContain('用户：问题2');
    expect(suffix).toContain('助手：回答2');
    expect(suffix).toContain('用户：问题3');
  });

  test('flattenAssistantContentPayload parses JSON blocks string', () => {
    const raw =
      '[{"text": "本次请求未能如愿完成（识别到的意图：text-to-image）。", "type": "text"}]';
    expect(flattenAssistantContentPayload(raw)).toBe(
      '本次请求未能如愿完成（识别到的意图：text-to-image）。',
    );
  });

  test('flattenAssistantContentPayload handles message-content-v1 object', () => {
    const v = {
      schema: 'message-content-v1',
      blocks: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
    };
    expect(flattenAssistantContentPayload(v)).toBe('a\nb');
  });

  test('extractMessageDeltaChunk unwraps JSON string delta into plain text', () => {
    const data = {
      delta:
        '[{"text": "line one", "type": "text"},{"text": "line two", "type": "text"}]',
    } as Record<string, unknown>;
    expect(extractMessageDeltaChunk(data)).toBe('line one\nline two');
  });

  test('extractMessageDeltaChunk reads object delta { type: text, text }', () => {
    expect(
      extractMessageDeltaChunk({ delta: { type: 'text', text: 'hello' } } as Record<string, unknown>),
    ).toBe('hello');
  });

  test('joinContentBlockArray skips non-text and bad blocks', () => {
    expect(
      joinContentBlockArray([
        { type: 'text', text: 'a' },
        null,
        { foo: 'bar' },
        { type: 'image' },
        { text: 'c' },
      ]),
    ).toBe('a\nc');
  });

  test('extractTurnFailedMessage prefers nested error.message', () => {
    expect(extractTurnFailedMessage({ error: { message: 'boom', code: 'X' } })).toBe('boom');
    expect(extractTurnFailedMessage({ error: { code: 'X' } })).toBe('X');
    expect(extractTurnFailedMessage({ message: 'top-level' })).toBe('top-level');
    expect(extractTurnFailedMessage({})).toBe('本轮对话失败');
  });

  test('extractTurnFailureSummary extracts first Zod issue from JSON array string', () => {
    const zodJson =
      '[{"code":"invalid_enum_value","message":"Invalid enum value. Expected openai","path":["endpointType"]}]';
    const summary = extractTurnFailureSummary({ error: { message: zodJson } });
    expect(summary.message).toBe('Invalid enum value. Expected openai');
    expect(summary.raw).toEqual({ message: zodJson });
  });

  test('extractTurnFailureSummary returns code when present', () => {
    const summary = extractTurnFailureSummary({
      error: { code: 'UPSTREAM_LLM_UNAVAILABLE', message: 'rate limit' },
    });
    expect(summary.code).toBe('UPSTREAM_LLM_UNAVAILABLE');
    expect(summary.message).toBe('rate limit');
  });

  test('reduceReasoningEvent: phase START → append step', () => {
    const t1 = reduceReasoningEvent(undefined, {
      event: 'reasoning-step-v1',
      data: {
        stepId: 's-1',
        kind: 'phase',
        phase: 'planning',
        label: '规划',
        event: 'START',
        time: 1000,
      },
    });
    expect(t1.steps).toHaveLength(1);
    expect(t1.steps[0]?.stepId).toBe('s-1');
    expect(t1.steps[0]?.phase).toBe('planning');
    expect(t1.steps[0]?.ok).toBeUndefined();
  });

  test('reduceReasoningEvent: duplicate START is idempotent', () => {
    const t1 = reduceReasoningEvent(undefined, {
      event: 'reasoning-step-v1',
      data: {
        stepId: 's-1',
        kind: 'phase',
        event: 'START',
        time: 1000,
      },
    });
    const t2 = reduceReasoningEvent(t1, {
      event: 'reasoning-step-v1',
      data: {
        stepId: 's-1',
        kind: 'phase',
        event: 'START',
        time: 1000,
      },
    });
    expect(t2.steps).toHaveLength(1);
  });

  test('reduceReasoningEvent: END updates ok/endTime/error', () => {
    const t0 = reduceReasoningEvent(undefined, {
      event: 'reasoning-step-v1',
      data: { stepId: 's', kind: 'phase', event: 'START', time: 1 },
    });
    const t1 = reduceReasoningEvent(t0, {
      event: 'reasoning-step-v1',
      data: {
        stepId: 's',
        kind: 'phase',
        event: 'END',
        time: 100,
        ok: false,
        error: { code: 'X', message: 'oops' },
      },
    });
    const s = t1.steps[0];
    expect(s?.ok).toBe(false);
    expect(s?.endTime).toBe(100);
    expect(s?.error).toEqual({ code: 'X', message: 'oops' });
  });

  test('reduceReasoningEvent: delta appends text to matching step', () => {
    const t0 = reduceReasoningEvent(undefined, {
      event: 'reasoning-step-v1',
      data: { stepId: 's', kind: 'model-reasoning', event: 'START', time: 1 },
    });
    const t1 = reduceReasoningEvent(t0, {
      event: 'reasoning-delta-v1',
      data: { stepId: 's', text: 'hello ', seqInStep: 1 },
    });
    const t2 = reduceReasoningEvent(t1, {
      event: 'reasoning-delta-v1',
      data: { stepId: 's', text: 'world', seqInStep: 2 },
    });
    expect(t2.steps[0]?.text).toBe('hello world');
  });

  test('reduceReasoningEvent: tool-loop START/END and delta are retained', () => {
    const t0 = reduceReasoningEvent(undefined, {
      event: 'reasoning-step-v1',
      data: {
        stepId: 'loop-1',
        parentStepId: 'phase-1',
        kind: 'tool-loop',
        event: 'START',
        label: '工具循环第 1 轮',
        time: 10,
      },
    });
    const t1 = reduceReasoningEvent(t0, {
      event: 'reasoning-delta-v1',
      data: { stepId: 'loop-1', text: '我先搜索一下', seqInStep: 1, source: 'tool-loop' },
    });
    const t2 = reduceReasoningEvent(t1, {
      event: 'reasoning-step-v1',
      data: { stepId: 'loop-1', kind: 'tool-loop', event: 'END', ok: true, time: 20 },
    });
    expect(t2.steps[0]).toMatchObject({
      stepId: 'loop-1',
      parentStepId: 'phase-1',
      kind: 'tool-loop',
      label: '工具循环第 1 轮',
      text: '我先搜索一下',
      ok: true,
      endTime: 20,
    });
  });

  test('reduceReasoningEvent: tool-call events append and complete a child tool step', () => {
    const t0 = reduceReasoningEvent(undefined, {
      event: 'reasoning-step-v1',
      data: { stepId: 'phase-1', kind: 'phase', phase: 'execution', event: 'START', time: 1, label: '执行中' },
    });
    const t1 = reduceReasoningEvent(t0, {
      event: 'tool-call-started-v1',
      data: {
        turnId: 'turn-1',
        parentStepId: 'phase-1',
        toolCallId: 'tc_1',
        toolName: 'platform.search',
        args: { query: 'alarm' },
      },
    });
    const t2 = reduceReasoningEvent(t1, {
      event: 'tool-call-completed-v1',
      data: {
        turnId: 'turn-1',
        parentStepId: 'phase-1',
        toolCallId: 'tc_1',
        toolName: 'platform.search',
        durationMs: 42,
        ok: true,
        output: { count: 1 },
      },
    });

    expect(t2.steps).toHaveLength(2);
    expect(t2.steps[1]).toMatchObject({
      stepId: 'tool:tc_1',
      parentStepId: 'phase-1',
      kind: 'tool-call',
      label: '调用 platform.search',
      toolCallId: 'tc_1',
      toolName: 'platform.search',
      args: { query: 'alarm' },
      ok: true,
      durationMs: 42,
      output: { count: 1 },
    });
    expect(t2.steps[1]?.endTime).toBeGreaterThanOrEqual(t2.steps[1]?.startTime ?? 0);
  });

  test('reduceReasoningEvent: unrelated event returns same tree', () => {
    const t0 = reduceReasoningEvent(undefined, {
      event: 'reasoning-step-v1',
      data: { stepId: 's', kind: 'phase', event: 'START', time: 1 },
    });
    const t1 = reduceReasoningEvent(t0, {
      event: 'message-delta-v1',
      data: { delta: 'x' },
    });
    expect(t1).toBe(t0);
  });

  test('forceCloseActiveReasoning marks active steps with ok=false and error', () => {
    const t0 = reduceReasoningEvent(undefined, {
      event: 'reasoning-step-v1',
      data: { stepId: 'a', kind: 'phase', event: 'START', time: 1 },
    });
    const t1 = reduceReasoningEvent(t0, {
      event: 'reasoning-step-v1',
      data: { stepId: 'b', kind: 'model-reasoning', event: 'START', time: 2 },
    });
    const t2 = reduceReasoningEvent(t1, {
      event: 'reasoning-step-v1',
      data: {
        stepId: 'a',
        kind: 'phase',
        event: 'END',
        time: 50,
        ok: true,
      },
    });
    const closed = forceCloseActiveReasoning(
      t2,
      { code: 'STREAM_DISCONNECTED', message: 'lost' },
      999,
    );
    const a = closed.steps.find((s) => s.stepId === 'a');
    const b = closed.steps.find((s) => s.stepId === 'b');
    expect(a?.ok).toBe(true);
    expect(a?.endTime).toBe(50);
    expect(b?.ok).toBe(false);
    expect(b?.endTime).toBe(999);
    expect(b?.error?.code).toBe('STREAM_DISCONNECTED');
  });

  test('shouldExpandReasoningStepByDefault: model-reasoning always open', () => {
    const s: ReasoningStep = {
      stepId: 's',
      kind: 'model-reasoning',
      label: 'thinking',
      startTime: 1,
      text: '',
    };
    expect(shouldExpandReasoningStepByDefault(s)).toBe(true);
  });

  test('shouldExpandReasoningStepByDefault: planning/execution/output open by default', () => {
    const base = { kind: 'phase' as const, stepId: 's', label: 'l', startTime: 1, text: '' };
    expect(shouldExpandReasoningStepByDefault({ ...base, phase: 'planning' })).toBe(true);
    expect(shouldExpandReasoningStepByDefault({ ...base, phase: 'execution' })).toBe(true);
    expect(shouldExpandReasoningStepByDefault({ ...base, phase: 'output' })).toBe(true);
    expect(shouldExpandReasoningStepByDefault({ ...base, phase: 'safety' })).toBe(false);
    expect(shouldExpandReasoningStepByDefault({ ...base, phase: 'session' })).toBe(false);
  });

  test('hasVisibleReasoning checks for non-empty steps', () => {
    expect(hasVisibleReasoning(undefined)).toBe(false);
    expect(hasVisibleReasoning({ steps: [] })).toBe(false);
    expect(
      hasVisibleReasoning({
        steps: [
          {
            stepId: 's',
            kind: 'phase',
            label: 'l',
            startTime: 1,
            text: '',
          },
        ],
      }),
    ).toBe(true);
  });
});
