import { HostError } from "@tachu/core";
import type { EngineOutput, StreamChunkPayload } from "@tachu/core";
import { describe, expect, test } from "bun:test";

import { createTachuSseMapperState, mapStreamChunkToSseEvents } from "./tachu-sse-mapper";

function makeEngineOutput(input: {
  content: string;
  tokenUsage?: { input: number; output: number; total: number };
  durationMs?: number;
}): EngineOutput {
  return {
    type: "text",
    content: input.content,
    steps: [],
    metadata: {
      outcome: "completed",
      toolCalls: [],
      durationMs: input.durationMs ?? 0,
      tokenUsage: input.tokenUsage ?? { input: 0, output: 0, total: 0 },
    },
    correlation: {
      traceId: "trace-test",
      requestId: "trace-test",
      sessionId: "session-test",
      turnId: TURN_ID,
    },
    deliveryMode: "streaming",
  };
}

/**
 * Tachu StreamChunk → SSE event 单元测试。
 *
 * 这一组测试把 tachu.Engine.runStream 产出的 chunk 流和本仓 SSE 事件协议（v1）
 * 之间的映射钉死在一处，让 TurnService 只剩一条"逐 chunk dispatch"的循环。
 * mapper 自己不做副作用、不知道 SSE 传输层——纯函数。
 */

const TURN_ID = "2054102360564695041";
const MESSAGE_ID = "2054102360564695042";

/**
 * 单调递增 stub：模拟 SfidService 的 19 位十进制 ID 产出。
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

describe("mapStreamChunkToSseEvents", () => {
  test('{type:"delta", content:"Hi"} → exactly one message.delta event with text payload and advances seqInTurn', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const chunk: StreamChunkPayload = { type: "delta", content: "Hi" };

    const events = mapStreamChunkToSseEvents(state, chunk);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      sseEvent: "message.delta",
      payload: {
        schema: "message-delta-v1",
        turnId: TURN_ID,
        messageId: MESSAGE_ID,
        seqInTurn: 1,
        delta: { type: "text", text: "Hi" },
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
      type: "usage",
      tokens: 50,
      toolCalls: 0,
      wallTimeMs: 100,
    });
    expect(first).toEqual([]);

    const second = mapStreamChunkToSseEvents(state, {
      type: "usage",
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
      type: "usage",
      tokens: 18,
      toolCalls: 0,
      wallTimeMs: 100,
      usage: { input: 10, output: 8, total: 18 },
      cumulative: { input: 10, output: 8, total: 18 },
      attribution: {
        id: "2054102360564695999",
        kind: "llm_call",
        parentId: "2054102360564695100",
        label: "tool-use",
        meta: { phase: "execution", provider: "openai", model: "gpt-4o-mini" },
      },
      accuracy: "estimated",
    });

    expect(events).toEqual([
      {
        sseEvent: "usage.delta",
        payload: {
          schema: "usage-delta-v2",
          turnId: TURN_ID,
          cumulative: { input: 10, output: 8, total: 18 },
          usage: { input: 10, output: 8, total: 18 },
          attribution: {
            id: "2054102360564695999",
            kind: "llm_call",
            parentId: "2054102360564695100",
            label: "tool-use",
            meta: { phase: "execution", provider: "openai", model: "gpt-4o-mini" },
          },
          accuracy: "estimated",
        },
      },
    ]);
  });

  test('{type:"progress"} → one tool.call.progress with safe telemetry projection', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(
      state,
      {
        type: "progress",
        payload: {
          status: "mcp.query.running",
          message: "SELECT * FROM ai_sm_risk_unit WHERE tenant = 1",
          safeDisplayMessage: "正在查询业务数据",
          progress: 42,
          toolName: "mcp.biz-ontology.ask_business_data",
          toolCallId: "tcall_biz_1",
          providerId: "provider-1",
          sql: "SELECT * FROM ai_sm_risk_unit",
          args: { question: "x" },
          rows: [{ id: 1 }],
          api_key: "sk-secret",
        },
      } as StreamChunkPayload,
      () => 1_700_000_000_777,
    );

    expect(events).toEqual([
      {
        sseEvent: "tool.call.progress",
        payload: {
          schema: "tool-call-progress-v1",
          turnId: TURN_ID,
          toolName: "mcp.biz-ontology.ask_business_data",
          toolCallId: "tcall_biz_1",
          status: "mcp.query.running",
          display: { text: "正在查询业务数据" },
          progress: 0.42,
          meta: {
            status: "mcp.query.running",
            progress: 42,
            toolName: "mcp.biz-ontology.ask_business_data",
            toolCallId: "tcall_biz_1",
            providerId: "provider-1",
          },
          time: 1_700_000_000_777,
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("SELECT");
    expect(JSON.stringify(events)).not.toContain("sk-secret");
    expect(JSON.stringify(events)).not.toContain("rows");
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
        type: "tool-call-start",
        callId: "tcall_alpha_1",
        tool: "platform.knowledge.query",
        argumentsPreview: '{"query":"hello"}',
      },
      () => 1_700_000_000_500,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      sseEvent: "tool.call.started",
      payload: {
        schema: "tool-call-started-v1",
        turnId: TURN_ID,
        toolCallId: "tcall_alpha_1",
        toolName: "platform.knowledge.query",
        args: { query: "hello" },
        // tachu chunk 不携带 execution/consent；默认安全档：本地、首次同意。
        // activity=knowledge-retrieval：下游据此渲染「正在检索知识库」缩略态，不必猜 toolName。
        meta: { execution: "LOCAL", consent: "ON_FIRST_USE", activity: "knowledge-retrieval" },
      },
    });
    expect(state.pendingToolCalls.get("tcall_alpha_1")?.startedAt).toBe(1_700_000_000_500);
  });

  test('{type:"tool-call-start"} for mcp.web-search.* → meta REMOTE + consent NEVER + activity=web-search（与 bridge 注册一致）', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(state, {
      type: "tool-call-start",
      callId: "tcall_ws_1",
      tool: "mcp.web-search.web_search",
      argumentsPreview: '{"query":"news"}',
    });
    expect(events[0]?.payload).toMatchObject({
      toolName: "mcp.web-search.web_search",
      meta: { execution: "REMOTE", consent: "NEVER", activity: "web-search" },
    });
  });

  test('{type:"tool-call-start"} for runtime.skill.refs → activity=skill-load（技能引用注入，非普通工具）', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(state, {
      type: "tool-call-start",
      callId: "tcall_skill_1",
      tool: "runtime.skill.refs",
      argumentsPreview: "{}",
    });
    expect(events[0]?.payload).toMatchObject({
      toolName: "runtime.skill.refs",
      meta: { execution: "LOCAL", consent: "ON_FIRST_USE", activity: "skill-load" },
    });
  });

  test('{type:"tool-call-start"} for unrecognized/domain-specific tool name → activity=tool（通用兜底，含 agent 自定义 groundingPrefetch 工具）', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(state, {
      type: "tool-call-start",
      callId: "tcall_generic_1",
      tool: "mcp.some-domain.custom_lookup",
      argumentsPreview: "{}",
    });
    expect(events[0]?.payload).toMatchObject({
      toolName: "mcp.some-domain.custom_lookup",
      meta: { execution: "LOCAL", consent: "ON_FIRST_USE", activity: "tool" },
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
      type: "tool-call-start",
      callId: "tcall_beta_1",
      tool: "some.tool",
      argumentsPreview: "not-json-but-truncated…",
    });
    expect(events[0]?.payload).toMatchObject({
      toolCallId: "tcall_beta_1",
      toolName: "some.tool",
      args: {},
    });
  });

  test('{type:"tool-call-start"} inside active lifecycle attaches parentStepId to the current lifecycle step', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });

    const events = mapStreamChunkToSseEvents(state, {
      type: "tool-call-start",
      callId: "tcall_parented_1",
      tool: "platform.knowledge.query",
      argumentsPreview: '{"query":"hello"}',
    });

    expect(events[0]?.payload).toMatchObject({
      schema: "tool-call-started-v1",
      toolCallId: "tcall_parented_1",
      parentStepId: "2054102360564695100",
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
      type: "tool-call-end",
      callId: "tcall_alpha_1",
      tool: "platform.knowledge.query",
      success: true,
      durationMs: 123,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      sseEvent: "tool.call.completed",
      payload: {
        schema: "tool-call-completed-v1",
        turnId: TURN_ID,
        toolCallId: "tcall_alpha_1",
        toolName: "platform.knowledge.query",
        durationMs: 123,
        ok: true,
      },
    });
  });

  test('{type:"tool-call-end"} for mcp.*.ask_business_data redacts raw business rows from SSE output', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(state, {
      type: "tool-call-end",
      callId: "tcall_biz_1",
      tool: "mcp.biz-ontology.ask_business_data",
      success: true,
      durationMs: 123,
      output: {
        status: "answered",
        clarification: null,
        answer: {
          summary: "查询完成，共返回 1 条风险管控结果。",
          columns: [{ key: "unit_name", label: "单元名称" }],
          rows: [{ id: 1, unit_name: "A区", tenant: 1, deleted: 0, sql: "SELECT * FROM ai_sm_risk_unit" }],
        },
      },
    });

    expect(events[0]).toEqual({
      sseEvent: "tool.call.completed",
      payload: {
        schema: "tool-call-completed-v1",
        turnId: TURN_ID,
        toolCallId: "tcall_biz_1",
        toolName: "mcp.biz-ontology.ask_business_data",
        durationMs: 123,
        ok: true,
        output: {
          redacted: true,
          policy: "business-data-v1",
          status: "answered",
          summary: "查询完成，共返回 1 条风险管控结果。",
          columnCount: 1,
          rowCount: 1,
        },
      },
    });
    expect(JSON.stringify(events)).not.toContain("SELECT");
    expect(JSON.stringify(events)).not.toContain("tenant");
    expect(JSON.stringify(events)).not.toContain("deleted");

    const terminalEvents = mapStreamChunkToSseEvents(state, {
      type: "done",
      output: makeEngineOutput({ content: "查询完成，共返回 1 条风险管控结果。" }),
    });
    expect(terminalEvents.some((event) => event.sseEvent === "turn.completed")).toBe(true);
    expect(terminalEvents.some((event) => event.sseEvent === "turn.failed")).toBe(false);
  });

  test('{type:"tool-call-end"} exposes safe clarification labels and opaque confirmation tokens for the chat UI', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(state, {
      type: "tool-call-end",
      callId: "tcall_biz_clarify",
      tool: "mcp.biz-ontology.ask_business_data",
      success: true,
      durationMs: 100,
      output: {
        structuredContent: {
          status: "needs_clarification",
          answer: null,
          clarification: {
            question: "请选择报警率口径",
            question_id: "q-internal",
            options: [
              { id: "timeout_alarm_rate", label: "超时报警率", source: "exact_evidence" },
              { option_id: "all_alarm_rate", label: "全部报警率", asset_id: "metric-secret" },
            ],
          },
        },
      },
    });

    expect(events[0]).toMatchObject({
      sseEvent: "tool.call.completed",
      payload: {
        output: {
          redacted: true,
          policy: "business-data-v1",
          status: "needs_clarification",
          summary: "请选择报警率口径",
          clarification: {
            question: "请选择报警率口径",
            questionId: "q-internal",
            options: [
              { label: "超时报警率", optionId: "timeout_alarm_rate" },
              { label: "全部报警率", optionId: "all_alarm_rate" },
            ],
          },
        },
      },
    });
    expect(JSON.stringify(events)).toContain("q-internal");
    expect(JSON.stringify(events)).toContain("timeout_alarm_rate");
    expect(JSON.stringify(events)).not.toContain("metric-secret");
  });

  test('{type:"tool-call-end"} preserves failed status when answer and clarification are null', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(state, {
      type: "tool-call-end",
      callId: "tcall_biz_empty",
      tool: "mcp.biz-ontology.ask_business_data",
      success: true,
      durationMs: 100,
      output: JSON.stringify({ status: "failed", answer: null, clarification: null }),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sseEvent: "tool.call.completed",
      payload: {
        output: {
          redacted: true,
          policy: "business-data-v1",
          status: "failed",
          summary: "业务问数工具已返回结果。",
          columnCount: 0,
          rowCount: 0,
        },
      },
    });
    expect(JSON.stringify(events)).not.toContain('"clarification"');
  });

  test('{type:"tool-call-end"} reuses the parentStepId captured by tool-call-start', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });
    mapStreamChunkToSseEvents(state, {
      type: "tool-call-start",
      callId: "tcall_parented_2",
      tool: "platform.knowledge.query",
      argumentsPreview: "{}",
    });
    // turnStop enter 关闭 turnStart 伞 step；但 tool-call-end 仍复用 start 时捕获的 parent。
    mapStreamChunkToSseEvents(state, {
      type: "lifecycle",
      point: "turnStop",
      status: "enter",
    });

    const events = mapStreamChunkToSseEvents(state, {
      type: "tool-call-end",
      callId: "tcall_parented_2",
      tool: "platform.knowledge.query",
      success: true,
      durationMs: 123,
    });

    expect(events[0]?.payload).toMatchObject({
      schema: "tool-call-completed-v1",
      toolCallId: "tcall_parented_2",
      parentStepId: "2054102360564695100",
    });
  });

  test('{type:"done"} with orphan tool-call-start（无 tool-call-end）→ 补 tool.call.completed，必要时再补 lifecycle END + 三件终态', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });
    mapStreamChunkToSseEvents(
      state,
      {
        type: "tool-call-start",
        callId: "orphan_call",
        tool: "mcp.web-search.web_search",
        argumentsPreview: '{"query":"x"}',
      },
      () => 1_700_000_000_100,
    );
    const chunk: StreamChunkPayload = {
      type: "done",
      output: makeEngineOutput({
        content: "final answer",
        tokenUsage: { input: 30, output: 90, total: 120 },
      }),
    };
    const events = mapStreamChunkToSseEvents(state, chunk, () => 1_700_000_001_500);
    expect(events).toHaveLength(6);
    expect(events[0]).toEqual({
      sseEvent: "tool.call.completed",
      payload: {
        schema: "tool-call-completed-v1",
        turnId: TURN_ID,
        parentStepId: "2054102360564695100",
        toolCallId: "orphan_call",
        toolName: "mcp.web-search.web_search",
        durationMs: 1400,
        ok: true,
      },
    });
    expect(events[1]?.sseEvent).toBe("reasoning.step");
    expect(events[1]?.payload).toMatchObject({
      schema: "reasoning-step-v1",
      kind: "lifecycle",
      event: "END",
      point: "turnStart",
      ok: true,
    });
    expect(events[2]).toEqual({
      sseEvent: "message.delta",
      payload: {
        schema: "message-delta-v1",
        turnId: TURN_ID,
        messageId: MESSAGE_ID,
        seqInTurn: 1,
        delta: { type: "text", text: "final answer" },
      },
    });
    expect(events[3]?.sseEvent).toBe("message.completed");
    expect(events[4]?.sseEvent).toBe("usage.delta");
    expect(events[5]?.sseEvent).toBe("turn.completed");
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
      type: "done",
      output: makeEngineOutput({
        content: "final answer",
        tokenUsage: { input: 30, output: 90, total: 120 },
      }),
    };
    const events = mapStreamChunkToSseEvents(state, chunk, () => 1_700_000_001_500);

    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({
      sseEvent: "message.delta",
      payload: {
        schema: "message-delta-v1",
        turnId: TURN_ID,
        messageId: MESSAGE_ID,
        seqInTurn: 1,
        delta: { type: "text", text: "final answer" },
      },
    });
    expect(events[1]).toEqual({
      sseEvent: "message.completed",
      payload: {
        schema: "message-completed-v1",
        turnId: TURN_ID,
        messageId: MESSAGE_ID,
      },
    });
    expect(events[2]).toEqual({
      sseEvent: "usage.delta",
      payload: {
        schema: "usage-delta-v2",
        turnId: TURN_ID,
        // 单次权威 emit：usage == cumulative，从 output.metadata.tokenUsage 取准确拆分
        usage: { input: 30, output: 90, total: 120 },
        cumulative: { input: 30, output: 90, total: 120 },
      },
    });
    expect(events[3]).toEqual({
      sseEvent: "turn.completed",
      payload: {
        schema: "turn-completed-v1",
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
    mapStreamChunkToSseEvents(state, { type: "delta", content: "already streamed" });
    const events = mapStreamChunkToSseEvents(
      state,
      {
        type: "done",
        output: makeEngineOutput({
          content: "already streamed",
          tokenUsage: { input: 30, output: 90, total: 120 },
        }),
      },
      () => 1_700_000_001_500,
    );
    expect(events).toHaveLength(3);
    expect(events.some((e) => e.sseEvent === "message.delta")).toBe(false);
  });

  test('{type:"done"} after reasoning-delta-only path emits synthetic message.delta before completed', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });
    mapStreamChunkToSseEvents(state, { type: "reasoning-delta", content: "模型内部思考…" });
    const events = mapStreamChunkToSseEvents(
      state,
      {
        type: "done",
        output: makeEngineOutput({
          content: "面向用户的最终句子。",
          tokenUsage: { input: 5, output: 10, total: 15 },
        }),
      },
      () => 1_700_000_001_500,
    );
    const deltaIdx = events.findIndex((e) => e.sseEvent === "message.delta");
    const completedIdx = events.findIndex((e) => e.sseEvent === "message.completed");
    expect(deltaIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBeGreaterThan(deltaIdx);
    if (events[deltaIdx]?.sseEvent === "message.delta") {
      expect(events[deltaIdx].payload).toMatchObject({
        schema: "message-delta-v1",
        delta: { type: "text", text: "面向用户的最终句子。" },
      });
    }
  });

  test('{type:"done"} after a tool-loop-delta-only turn (model answered without calling any tool) does NOT re-send: text already streamed live, bubble reconciles with terminalDraft', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });
    mapStreamChunkToSseEvents(state, { type: "tool-loop-step", step: 1, maxSteps: 25 });
    // Option B：tool-loop-delta 已在到达时即时 message.delta 进气泡（真流式）。
    const d1 = mapStreamChunkToSseEvents(state, { type: "tool-loop-delta", step: 1, content: "我先" });
    const d2 = mapStreamChunkToSseEvents(state, { type: "tool-loop-delta", step: 1, content: "直接" });
    const d3 = mapStreamChunkToSseEvents(state, { type: "tool-loop-delta", step: 1, content: "回答你。" });
    // 每个 tool-loop-delta 当场产出一条 message.delta（不再囤到 done）。
    for (const d of [d1, d2, d3]) {
      expect(d.filter((e) => e.sseEvent === "message.delta")).toHaveLength(1);
    }
    mapStreamChunkToSseEvents(state, { type: "tool-loop-step-end", step: 1, success: true, reason: "terminal" });

    const events = mapStreamChunkToSseEvents(
      state,
      {
        type: "done",
        output: makeEngineOutput({
          content: "我先直接回答你。",
          tokenUsage: { input: 5, output: 10, total: 15 },
        }),
      },
      () => 1_700_000_001_500,
    );

    // 核心断言：气泡已在 live 阶段逐字流出且与 terminalDraft 对账一致 → done 不再补发。
    expect(events.some((e) => e.sseEvent === "message.delta")).toBe(false);
    expect(events.some((e) => e.sseEvent === "message.reset")).toBe(false);
    expect(events.some((e) => e.sseEvent === "message.completed")).toBe(true);
    // 3 个 live 分片各消费一个 seqInTurn（1..3），done 未再自增。
    expect(state.seqInTurn).toBe(4);
  });

  test('{type:"done"} emits message.reset + a single synthetic message.delta when the live bubble content does not reconcile with the final text (self-heal)', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });
    mapStreamChunkToSseEvents(state, { type: "tool-loop-step", step: 1, maxSteps: 25 });
    // 极端：本轮最后一步流出的正文与 done 抽出的 terminalDraft 不一致（理论上罕见）。
    mapStreamChunkToSseEvents(state, { type: "tool-loop-delta", step: 1, content: "让我查一下…" });
    const chunk: StreamChunkPayload = {
      type: "done",
      output: makeEngineOutput({
        content: "最终答案与流出正文不一致",
        tokenUsage: { input: 5, output: 10, total: 15 },
      }),
    };
    const events = mapStreamChunkToSseEvents(state, chunk, () => 1_700_000_001_500);

    // 先清空脏气泡，再补一条整段最终正文。
    const resetIdx = events.findIndex((e) => e.sseEvent === "message.reset");
    const deltaIdx = events.findIndex((e) => e.sseEvent === "message.delta");
    expect(resetIdx).toBeGreaterThanOrEqual(0);
    expect(deltaIdx).toBeGreaterThan(resetIdx);
    if (events[resetIdx]?.sseEvent === "message.reset") {
      expect(events[resetIdx].payload).toMatchObject({ schema: "message-reset-v1", reason: "final-reconcile" });
    }
    const messageDeltas = events.filter((e) => e.sseEvent === "message.delta");
    expect(messageDeltas).toHaveLength(1);
    expect(messageDeltas[0]?.payload).toMatchObject({
      delta: { type: "text", text: "最终答案与流出正文不一致" },
    });
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
        type: "done",
        output: makeEngineOutput({
          content: "  \n\t  ",
          tokenUsage: { input: 0, output: 0, total: 0 },
        }),
      },
      () => 1_700_000_001_500,
    );
    expect(events.some((e) => e.sseEvent === "message.delta")).toBe(false);
    expect(events).toHaveLength(3);
  });

  test('{type:"error"} → one turn.failed event with code/message/retryable mapped from EngineError', () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const err = new HostError("HOST_FAILURE", "provider exploded", { retryable: true });
    const events = mapStreamChunkToSseEvents(state, { type: "error", error: err }, () => 1_700_000_000_999);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      sseEvent: "turn.failed",
      payload: {
        schema: "turn-failed-v1",
        turnId: TURN_ID,
        error: {
          code: "HOST_FAILURE",
          message: "provider exploded",
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
    const err1 = new HostError("FIRST_ERROR", "first", { retryable: false });
    const err2 = new HostError("SECOND_ERROR", "second", { retryable: false });
    const first = mapStreamChunkToSseEvents(state, { type: "error", error: err1 });
    const second = mapStreamChunkToSseEvents(state, { type: "error", error: err2 });
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
      type: "tool-call-end",
      callId: "tcall_alpha_2",
      tool: "platform.flow.invoke",
      success: false,
      durationMs: 88,
      error: {
        code: "TOOL_EXECUTION_FAILED",
        message: "flow not found",
        retryable: false,
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      sseEvent: "tool.call.completed",
      payload: {
        schema: "tool-call-completed-v1",
        turnId: TURN_ID,
        toolCallId: "tcall_alpha_2",
        toolName: "platform.flow.invoke",
        durationMs: 88,
        ok: false,
        error: {
          code: "TOOL_EXECUTION_FAILED",
          message: "flow not found",
          retryable: false,
        },
      },
    });
  });

  // ── reasoning step / delta mapper coverage ─────────────────────────────────

  test("lifecycle turnStart enter emits reasoning-step START with point + 中文 label", () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" }, () => 1_700_000_001_000);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      sseEvent: "reasoning.step",
      payload: {
        schema: "reasoning-step-v1",
        turnId: TURN_ID,
        stepId: "2054102360564695100",
        kind: "lifecycle",
        event: "START",
        label: "开始处理",
        point: "turnStart",
        time: 1_700_000_001_000,
      },
    });
    expect(state.activeLifecycleStepId).toBe("2054102360564695100");
    expect(state.activeLifecyclePoint).toBe("turnStart");
  });

  test("non-surfaced lifecycle point (e.g. preLLM) is a no-op (forward-compat)", () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const events = mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "preLLM", status: "enter" });
    expect(events).toEqual([]);
    expect(state.activeLifecycleStepId).toBeNull();
  });

  test("reasoning-delta after lifecycle turnStart opens model-reasoning sub-step with parentStepId = lifecycle step", () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });
    const events = mapStreamChunkToSseEvents(state, { type: "reasoning-delta", content: "让我想想…" }, () => 1_700_000_002_000);
    // 首次 reasoning-delta：先 START 再 delta
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      sseEvent: "reasoning.step",
      payload: {
        schema: "reasoning-step-v1",
        turnId: TURN_ID,
        stepId: "2054102360564695101",
        parentStepId: "2054102360564695100",
        kind: "model-reasoning",
        event: "START",
        label: "模型思考",
        time: 1_700_000_002_000,
      },
    });
    expect(events[1]).toEqual({
      sseEvent: "reasoning.delta",
      payload: {
        schema: "reasoning-delta-v1",
        turnId: TURN_ID,
        stepId: "2054102360564695101",
        seqInStep: 1,
        text: "让我想想…",
        source: "model",
      },
    });
    // 连续第二条 reasoning-delta 只发 delta（不重复 START），seq 递增
    const second = mapStreamChunkToSseEvents(state, {
      type: "reasoning-delta",
      content: "继续思考…",
    });
    expect(second).toHaveLength(1);
    expect(second[0]?.sseEvent).toBe("reasoning.delta");
    if (second[0]?.sseEvent === "reasoning.delta") {
      expect(second[0].payload.seqInStep).toBe(2);
    }
  });

  test("text-delta auto-closes active model-reasoning sub-step (Q5 boundary)", () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });
    mapStreamChunkToSseEvents(state, { type: "reasoning-delta", content: "thinking…" });
    expect(state.activeModelReasoningStepId).not.toBeNull();
    const events = mapStreamChunkToSseEvents(state, { type: "delta", content: "Hello" }, () => 1_700_000_003_000);
    // 应先 END model-reasoning，再 emit message.delta
    expect(events).toHaveLength(2);
    expect(events[0]?.sseEvent).toBe("reasoning.step");
    if (events[0]?.sseEvent === "reasoning.step") {
      expect(events[0].payload.event).toBe("END");
      expect(events[0].payload.kind).toBe("model-reasoning");
      expect(events[0].payload.ok).toBe(true);
    }
    expect(events[1]?.sseEvent).toBe("message.delta");
    expect(state.activeModelReasoningStepId).toBeNull();
  });

  test("turnStop enter closes the active turnStart umbrella + sub model-reasoning, then opens turnStop; turnStop exit ends it", () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });
    mapStreamChunkToSseEvents(state, { type: "reasoning-delta", content: "route thinking" });
    // turnStop enter：先关活跃 model-reasoning，再 END turnStart 伞 step，最后 START turnStop 伞 step。
    const events = mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStop", status: "enter" });
    expect(events.map((e) => e.sseEvent)).toEqual(["reasoning.step", "reasoning.step", "reasoning.step"]);
    if (events[0]?.sseEvent === "reasoning.step" && events[1]?.sseEvent === "reasoning.step" && events[2]?.sseEvent === "reasoning.step") {
      expect(events[0].payload.kind).toBe("model-reasoning");
      expect(events[0].payload.event).toBe("END");
      expect(events[1].payload.kind).toBe("lifecycle");
      expect(events[1].payload.event).toBe("END");
      expect(events[1].payload.point).toBe("turnStart");
      expect(events[1].payload.ok).toBe(true);
      expect(events[2].payload.kind).toBe("lifecycle");
      expect(events[2].payload.event).toBe("START");
      expect(events[2].payload.point).toBe("turnStop");
    }
    expect(state.activeModelReasoningStepId).toBeNull();
    expect(state.activeLifecyclePoint).toBe("turnStop");

    // turnStop exit：END 对偶的 turnStop 伞 step。
    const exitEvents = mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStop", status: "exit", ok: true });
    expect(exitEvents).toHaveLength(1);
    if (exitEvents[0]?.sseEvent === "reasoning.step") {
      expect(exitEvents[0].payload.kind).toBe("lifecycle");
      expect(exitEvents[0].payload.event).toBe("END");
      expect(exitEvents[0].payload.point).toBe("turnStop");
      expect(exitEvents[0].payload.ok).toBe(true);
    }
    expect(state.activeLifecycleStepId).toBeNull();
    expect(state.activeLifecyclePoint).toBeNull();
  });

  test("tool-loop lifecycle maps to nested reasoning step, process delta, and tool call parent", () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });

    const start = mapStreamChunkToSseEvents(state, { type: "tool-loop-step", step: 1, maxSteps: 25 }, () => 1_700_000_001_000);
    expect(start).toHaveLength(1);
    expect(start[0]).toEqual({
      sseEvent: "reasoning.step",
      payload: {
        schema: "reasoning-step-v1",
        turnId: TURN_ID,
        stepId: "2054102360564695101",
        parentStepId: "2054102360564695100",
        kind: "tool-loop",
        event: "START",
        label: "工具循环第 1 轮",
        time: 1_700_000_001_000,
        meta: { step: 1, maxSteps: 25 },
      },
    });

    const delta = mapStreamChunkToSseEvents(state, {
      type: "tool-loop-delta",
      step: 1,
      content: "我先搜索一下",
    });
    // Option B：tool-loop-delta 双通道——reasoning.delta（思考区）+ 乐观 message.delta（正文气泡）。
    expect(delta).toHaveLength(2);
    expect(delta[0]).toEqual({
      sseEvent: "reasoning.delta",
      payload: {
        schema: "reasoning-delta-v1",
        turnId: TURN_ID,
        stepId: "2054102360564695101",
        seqInStep: 1,
        text: "我先搜索一下",
        source: "tool-loop",
      },
    });
    expect(delta[1]).toEqual({
      sseEvent: "message.delta",
      payload: {
        schema: "message-delta-v1",
        turnId: TURN_ID,
        messageId: MESSAGE_ID,
        seqInTurn: 1,
        delta: { type: "text", text: "我先搜索一下" },
      },
    });

    const callStart = mapStreamChunkToSseEvents(state, {
      type: "tool-call-start",
      callId: "call-1",
      tool: "mcp.web-search.web_search",
      argumentsPreview: '{"query":"x"}',
    });
    expect(callStart[0]?.sseEvent).toBe("tool.call.started");
    if (callStart[0]?.sseEvent === "tool.call.started") {
      expect(callStart[0].payload.parentStepId).toBe("2054102360564695101");
    }

    const callEnd = mapStreamChunkToSseEvents(state, {
      type: "tool-call-end",
      callId: "call-1",
      tool: "mcp.web-search.web_search",
      success: true,
      durationMs: 12,
      output: { raw: "full output" },
    });
    expect(callEnd[0]?.sseEvent).toBe("tool.call.completed");
    if (callEnd[0]?.sseEvent === "tool.call.completed") {
      expect(callEnd[0].payload.parentStepId).toBe("2054102360564695101");
      expect(callEnd[0].payload.output).toEqual({ raw: "full output" });
    }

    const end = mapStreamChunkToSseEvents(state, {
      type: "tool-loop-step-end",
      step: 1,
      success: true,
      reason: "terminal",
    });
    expect(end[0]?.sseEvent).toBe("reasoning.step");
    if (end[0]?.sseEvent === "reasoning.step") {
      expect(end[0].payload.kind).toBe("tool-loop");
      expect(end[0].payload.event).toBe("END");
      expect(end[0].payload.ok).toBe(true);
    }
  });

  test("error chunk force-ends active reasoning steps with ok=false TURN_INTERRUPTED", () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });
    mapStreamChunkToSseEvents(state, { type: "reasoning-delta", content: "in flight…" });
    const err = new HostError("PROVIDER_DOWN", "upstream 503", { retryable: true });
    const events = mapStreamChunkToSseEvents(state, { type: "error", error: err });
    // 顺序：先 model-reasoning END，再 lifecycle END，最后 turn.failed
    const sseNames = events.map((e) => e.sseEvent);
    expect(sseNames).toEqual(["reasoning.step", "reasoning.step", "turn.failed"]);
    if (events[0]?.sseEvent === "reasoning.step") {
      expect(events[0].payload.event).toBe("END");
      expect(events[0].payload.ok).toBe(false);
      expect(events[0].payload.error?.code).toBe("TURN_INTERRUPTED");
    }
    if (events[1]?.sseEvent === "reasoning.step") {
      expect(events[1].payload.event).toBe("END");
      expect(events[1].payload.ok).toBe(false);
    }
  });
});

/**
 * Option B — 正文气泡真流式：乐观转发 tool-loop-delta + 事后按 step-end.reason 回溯清空。
 *
 * tachu rc.14 契约下，所有 assistant 正文（中间叙述、失败恢复草稿、最终答案）都只经
 * `tool-loop-delta` 流出，且判别信号 `tool-loop-step-end.reason` 总在正文流完后到达。
 * mapper 乐观把每段 delta 即时送进气泡；非 terminal 收尾时补 `message.reset` 清空，
 * 只有 `reason==="terminal"` 那段留存，最终恒等于 `terminalDraft`。
 */
describe("mapStreamChunkToSseEvents · Option B optimistic bubble streaming", () => {
  test("non-terminal tool-loop-step-end emits message.reset to discard the optimistically-streamed narration", () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });
    mapStreamChunkToSseEvents(state, { type: "tool-loop-step", step: 1, maxSteps: 25 });
    mapStreamChunkToSseEvents(state, { type: "tool-loop-delta", step: 1, content: "我先查一下天气。" });

    const end = mapStreamChunkToSseEvents(state, {
      type: "tool-loop-step-end",
      step: 1,
      success: true,
      reason: "tool-calls-completed",
    });

    const reset = end.find((e) => e.sseEvent === "message.reset");
    expect(reset).toBeDefined();
    expect(reset?.payload).toEqual({
      schema: "message-reset-v1",
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      reason: "tool-calls-completed",
    });
    // 也仍会 END tool-loop reasoning step（思考区保留叙述）。
    expect(end.some((e) => e.sseEvent === "reasoning.step")).toBe(true);
  });

  test("failure-recovery-injected step-end resets the discarded draft bubble", () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });
    mapStreamChunkToSseEvents(state, { type: "tool-loop-step", step: 2, maxSteps: 25 });
    mapStreamChunkToSseEvents(state, { type: "tool-loop-delta", step: 2, content: "根据经验大概 120 万。" });

    const end = mapStreamChunkToSseEvents(state, {
      type: "tool-loop-step-end",
      step: 2,
      success: false,
      reason: "failure-recovery-injected",
    });

    const reset = end.find((e) => e.sseEvent === "message.reset");
    expect(reset?.payload).toMatchObject({ schema: "message-reset-v1", reason: "failure-recovery-injected" });
  });

  test("terminal tool-loop-step-end keeps the bubble (no message.reset)", () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });
    mapStreamChunkToSseEvents(state, { type: "tool-loop-step", step: 1, maxSteps: 25 });
    mapStreamChunkToSseEvents(state, { type: "tool-loop-delta", step: 1, content: "这就是最终答案。" });

    const end = mapStreamChunkToSseEvents(state, {
      type: "tool-loop-step-end",
      step: 1,
      success: true,
      reason: "terminal",
    });

    expect(end.some((e) => e.sseEvent === "message.reset")).toBe(false);
  });

  test("step-end with no optimistically-streamed content emits no message.reset (no noise)", () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    mapStreamChunkToSseEvents(state, { type: "lifecycle", point: "turnStart", status: "enter" });
    mapStreamChunkToSseEvents(state, { type: "tool-loop-step", step: 1, maxSteps: 25 });
    // 本步只调工具、无正文 delta。
    const end = mapStreamChunkToSseEvents(state, {
      type: "tool-loop-step-end",
      step: 1,
      success: true,
      reason: "tool-calls-completed",
    });
    expect(end.some((e) => e.sseEvent === "message.reset")).toBe(false);
  });

  test("multi-step turn: narration flashes then clears each non-terminal step; only the terminal answer survives and done does not re-send", () => {
    const state = createTachuSseMapperState({
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      startTime: 1_700_000_000_000,
      nextSfid: makeStubNextSfid(),
    });
    const all: { sseEvent: string; payload: unknown }[] = [];
    const feed = (chunk: StreamChunkPayload, now?: () => number): void => {
      for (const e of mapStreamChunkToSseEvents(state, chunk, now)) all.push(e);
    };

    feed({ type: "lifecycle", point: "turnStart", status: "enter" });
    // step 1：叙述 → 工具 → 非 terminal 收尾（清空）
    feed({ type: "tool-loop-step", step: 1, maxSteps: 25 });
    feed({ type: "tool-loop-delta", step: 1, content: "我先查天气。" });
    feed({ type: "tool-loop-step-end", step: 1, success: true, reason: "tool-calls-completed" });
    // step 2：叙述 → 工具 → 非 terminal 收尾（清空）
    feed({ type: "tool-loop-step", step: 2, maxSteps: 25 });
    feed({ type: "tool-loop-delta", step: 2, content: "再看看日程。" });
    feed({ type: "tool-loop-step-end", step: 2, success: true, reason: "tool-calls-completed" });
    // step 3：最终答案 → terminal 收尾（保留）
    feed({ type: "tool-loop-step", step: 3, maxSteps: 25 });
    feed({ type: "tool-loop-delta", step: 3, content: "建议 11:30 后拍摄。" });
    feed({ type: "tool-loop-step-end", step: 3, success: true, reason: "terminal" });
    feed(
      {
        type: "done",
        output: makeEngineOutput({ content: "建议 11:30 后拍摄。", tokenUsage: { input: 1, output: 2, total: 3 } }),
      },
      () => 1_700_000_001_500,
    );

    // 两次 flash-clear（step1/step2 各一次 reset），terminal 段无 reset。
    const resets = all.filter((e) => e.sseEvent === "message.reset");
    expect(resets).toHaveLength(2);
    // 三段叙述各即时流出一条 message.delta。
    const deltas = all.filter((e) => e.sseEvent === "message.delta");
    expect(deltas).toHaveLength(3);
    // 最后一条 message.delta 即最终答案；done 不再补发。
    expect(deltas[2]?.payload).toMatchObject({ delta: { type: "text", text: "建议 11:30 后拍摄。" } });
    const lastResetPos = all.map((e) => e.sseEvent).lastIndexOf("message.reset");
    const lastDeltaPos = all.map((e) => e.sseEvent).lastIndexOf("message.delta");
    // 终答的 delta 在最后一次 reset 之后（气泡最终只剩终答）。
    expect(lastDeltaPos).toBeGreaterThan(lastResetPos);
  });
});
