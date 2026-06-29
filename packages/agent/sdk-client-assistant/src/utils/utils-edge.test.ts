import { describe, expect, test } from "bun:test";

/**
 * Utils 边界分支补充测试（utils.test.ts 未覆盖的路径）：
 *   - content：getDataString / flatten 递归与坏输入 / parseMessageAttachments
 *   - message-delta：chunk/text 兜底键、对象 delta 无 text
 *   - system-suffix：空列表 / 连续 user / 非法 maxTurns / 角色过滤
 *   - turn-failure：非法 JSON / 顶层兜底键
 *   - reasoning reducer：非法 kind / 未知 stepId / 空 delta / tool-call 异常分支
 *   - formatReasoningElapsedMs 阶梯边界
 */
import { type AssistantMessage, type AssistantSessionSummary } from "../types";
import {
  buildSystemSuffixFromMessages,
  extractMessageDeltaChunk,
  extractTurnFailedMessage,
  extractTurnFailureSummary,
  filterSessionsByKeyword,
  flattenAssistantContentPayload,
  forceCloseActiveReasoning,
  formatReasoningElapsedMs,
  getDataString,
  groupSessionsByDate,
  joinContentBlockArray,
  parseMessageAttachments,
  reduceReasoningEvent,
  shouldExpandReasoningStepByDefault,
} from "./index";
import { createEmptyReasoningTree } from "./reasoning";

describe("content — getDataString / joinContentBlockArray", () => {
  test('getDataString 取第一个非空白字符串键；全空 → ""', () => {
    const data = { a: "   ", b: 42, c: "hit", d: "later" };
    expect(getDataString(data, ["a", "b", "c", "d"])).toBe("hit");
    expect(getDataString(data, ["a", "b"])).toBe("");
    expect(getDataString({}, ["x"])).toBe("");
  });

  test('joinContentBlockArray 空数组 → ""', () => {
    expect(joinContentBlockArray([])).toBe("");
  });
});

describe("content — flattenAssistantContentPayload 边界", () => {
  test('null / undefined / number / boolean → ""', () => {
    expect(flattenAssistantContentPayload(null)).toBe("");
    expect(flattenAssistantContentPayload(undefined)).toBe("");
    expect(flattenAssistantContentPayload(42)).toBe("");
    expect(flattenAssistantContentPayload(true)).toBe("");
  });

  test('普通字符串原样返回；"["开头但非 JSON → 原样返回', () => {
    expect(flattenAssistantContentPayload("plain text")).toBe("plain text");
    expect(flattenAssistantContentPayload("[not-json")).toBe("[not-json");
  });

  test("JSON 空数组字符串 → join 为空时回退原始字符串", () => {
    expect(flattenAssistantContentPayload("[]")).toBe("[]");
  });

  test("裸 blocks 数组直接 join", () => {
    expect(
      flattenAssistantContentPayload([
        { text: "a", type: "text" },
        { text: "b", type: "text" },
      ]),
    ).toBe("a\nb");
  });

  test("嵌套 content 递归展开（对象 → content 字符串 / content 数组）", () => {
    expect(flattenAssistantContentPayload({ content: "inner" })).toBe("inner");
    expect(
      flattenAssistantContentPayload({
        content: { blocks: [{ text: "deep", type: "text" }] },
      }),
    ).toBe("deep");
  });

  test("对象顶层 text 优先于 blocks", () => {
    expect(
      flattenAssistantContentPayload({
        blocks: [{ type: "text", text: "block" }],
        text: "top",
      }),
    ).toBe("top");
  });

  test("message-content schema 走 blocks ?? content", () => {
    expect(
      flattenAssistantContentPayload({
        content: [{ type: "text", text: "from-content" }],
        schema: "message-content-v2",
      }),
    ).toBe("from-content");
  });
});

describe("content — parseMessageAttachments", () => {
  const valid = {
    attachmentId: "att-1",
    fileId: "f-1",
    kind: "image",
    mimeType: "image/png",
  };

  test("非数组 / 空数组 → undefined", () => {
    expect(parseMessageAttachments(undefined)).toBeUndefined();
    expect(parseMessageAttachments("x")).toBeUndefined();
    expect(parseMessageAttachments([])).toBeUndefined();
  });

  test("过滤非法条目；全非法 → undefined", () => {
    expect(parseMessageAttachments([{ kind: "image" }, null, "str"])).toBeUndefined();
    const out = parseMessageAttachments([valid, { attachmentId: "x", kind: "video" }]);
    expect(out).toHaveLength(1);
    expect(out?.[0]?.attachmentId).toBe("att-1");
  });

  test("kind 非 image → 过滤", () => {
    expect(parseMessageAttachments([{ ...valid, kind: "file" }])).toBeUndefined();
  });
});

describe("message-delta — extractMessageDeltaChunk 兜底", () => {
  test("无 delta 时回退 chunk / text 键", () => {
    expect(extractMessageDeltaChunk({ chunk: "from-chunk" })).toBe("from-chunk");
    expect(extractMessageDeltaChunk({ text: "from-text" })).toBe("from-text");
    expect(extractMessageDeltaChunk({})).toBe("");
  });

  test("对象 delta 无 text → 走 flatten（blocks）；flatten 失败 → 兜底键", () => {
    expect(
      extractMessageDeltaChunk({
        delta: { blocks: [{ text: "block-text", type: "text" }] },
      }),
    ).toBe("block-text");
    expect(extractMessageDeltaChunk({ chunk: "fb", delta: { foo: 1 } })).toBe("fb");
  });

  test("delta 为空字符串 → 兜底键", () => {
    expect(extractMessageDeltaChunk({ delta: "", text: "t" })).toBe("t");
  });
});

describe("system-suffix — buildSystemSuffixFromMessages 边界", () => {
  test('空消息 / 仅 system+tool 消息 → ""', () => {
    expect(buildSystemSuffixFromMessages([], 3)).toBe("");
    const msgs: AssistantMessage[] = [
      { content: "sys", createdAt: 1, id: "1", role: "system" },
      { content: "tool", createdAt: 2, id: "2", role: "tool" },
    ];
    expect(buildSystemSuffixFromMessages(msgs, 3)).toBe("");
  });

  test("连续两条 user → 前一条成为独立轮（assistant 为空）", () => {
    const msgs: AssistantMessage[] = [
      { content: "Q1", createdAt: 1, id: "u1", role: "user" },
      { content: "Q2", createdAt: 2, id: "u2", role: "user" },
      { content: "A2", createdAt: 3, id: "a1", role: "assistant" },
    ];
    const suffix = buildSystemSuffixFromMessages(msgs, 10);
    expect(suffix).toContain("用户：Q1");
    expect(suffix).toContain("助手：（空）");
    expect(suffix).toContain("用户：Q2");
    expect(suffix).toContain("助手：A2");
  });

  test("maxTurns 非法（NaN / 0 / 负数 / 小数）→ 归一为至少 1 轮", () => {
    const msgs: AssistantMessage[] = [
      { content: "Q1", createdAt: 1, id: "u1", role: "user" },
      { content: "A1", createdAt: 2, id: "a1", role: "assistant" },
      { content: "Q2", createdAt: 3, id: "u2", role: "user" },
      { content: "A2", createdAt: 4, id: "a2", role: "assistant" },
    ];
    for (const bad of [Number.NaN, 0, -3, 1.9]) {
      const suffix = buildSystemSuffixFromMessages(msgs, bad);
      expect(suffix).toContain("用户：Q2");
      expect(suffix).not.toContain("用户：Q1");
    }
  });

  test("末尾未应答的 user 也计 1 轮", () => {
    const msgs: AssistantMessage[] = [{ content: "pending", createdAt: 1, id: "u1", role: "user" }];
    const suffix = buildSystemSuffixFromMessages(msgs, 2);
    expect(suffix).toContain("用户：pending");
    expect(suffix).toContain("助手：（空）");
  });

  test("空白 content 渲染为（空）", () => {
    const msgs: AssistantMessage[] = [
      { content: "   ", createdAt: 1, id: "u1", role: "user" },
      { content: "", createdAt: 2, id: "a1", role: "assistant" },
    ];
    const suffix = buildSystemSuffixFromMessages(msgs, 1);
    expect(suffix).toContain("用户：（空）");
    expect(suffix).toContain("助手：（空）");
  });
});

describe("turn-failure — 边界", () => {
  test("error 是数组 → 忽略，落到顶层兜底键", () => {
    expect(extractTurnFailedMessage({ error: ["x"], message: "top" })).toBe("top");
  });

  test("error.message 空白 → 回退 error.code", () => {
    expect(extractTurnFailedMessage({ error: { code: "C1", message: "  " } })).toBe("C1");
  });

  test("extractTurnFailureSummary：message 以 [ 开头但非法 JSON → 保留原文", () => {
    const s = extractTurnFailureSummary({ error: { message: "[broken json" } });
    expect(s.message).toBe("[broken json");
    expect(s.code).toBeNull();
  });

  test("extractTurnFailureSummary：JSON 数组首项无 message → 保留原文", () => {
    const raw = '[{"code":"X"}]';
    const s = extractTurnFailureSummary({ error: { message: raw } });
    expect(s.message).toBe(raw);
  });

  test("extractTurnFailureSummary：code 从顶层 code/errorCode 兜底", () => {
    expect(extractTurnFailureSummary({ code: "TOP", message: "m" }).code).toBe("TOP");
    expect(extractTurnFailureSummary({ errorCode: "EC", message: "m" }).code).toBe("EC");
  });

  test("extractTurnFailureSummary：raw 优先 error 对象，无 error 时整个 data", () => {
    const err = { message: "m" };
    expect(extractTurnFailureSummary({ error: err }).raw).toBe(err);
    const data = { message: "m2" };
    expect(extractTurnFailureSummary(data).raw).toBe(data);
  });
});

describe("reasoning reducer — 非法输入与异常分支", () => {
  test("reasoning-step-v1：缺 stepId / 非法 kind → 原树返回（同引用）", () => {
    const t0 = createEmptyReasoningTree();
    const t1 = reduceReasoningEvent(t0, {
      data: { event: "START", kind: "phase", time: 1 },
      event: "reasoning-step-v1",
    });
    expect(t1).toBe(t0);
    const t2 = reduceReasoningEvent(t0, {
      data: { event: "START", kind: "tool-call", stepId: "s", time: 1 },
      event: "reasoning-step-v1",
    });
    expect(t2).toBe(t0); // tool-call kind 只能由 tool-call-* 事件合成
  });

  test("reasoning-step-v1：event 标记非 START/END → 原树返回", () => {
    const t0 = createEmptyReasoningTree();
    const t1 = reduceReasoningEvent(t0, {
      data: { event: "PROGRESS", kind: "phase", stepId: "s", time: 1 },
      event: "reasoning-step-v1",
    });
    expect(t1).toBe(t0);
  });

  test("END 未知 stepId → steps 不变（map 无命中）", () => {
    const t0 = reduceReasoningEvent(undefined, {
      data: { event: "START", kind: "phase", stepId: "a", time: 1 },
      event: "reasoning-step-v1",
    });
    const t1 = reduceReasoningEvent(t0, {
      data: { event: "END", kind: "phase", stepId: "ghost", time: 9 },
      event: "reasoning-step-v1",
    });
    expect(t1.steps).toHaveLength(1);
    expect(t1.steps[0]?.ok).toBeUndefined();
  });

  test("delta：未知 stepId / 空 text → 不变", () => {
    const t0 = reduceReasoningEvent(undefined, {
      data: { event: "START", kind: "phase", stepId: "a", time: 1 },
      event: "reasoning-step-v1",
    });
    const t1 = reduceReasoningEvent(t0, {
      data: { stepId: "ghost", text: "x" },
      event: "reasoning-delta-v1",
    });
    expect(t1.steps[0]?.text).toBe("");
    const t2 = reduceReasoningEvent(t0, {
      data: { stepId: "a", text: "" },
      event: "reasoning-delta-v1",
    });
    expect(t2).toBe(t0);
  });

  test("tool-call-started-v1：缺 toolCallId → 原树；重复 started 幂等", () => {
    const t0 = createEmptyReasoningTree();
    expect(reduceReasoningEvent(t0, { data: {}, event: "tool-call-started-v1" })).toBe(t0);
    const t1 = reduceReasoningEvent(t0, {
      data: { time: 1, toolCallId: "tc", toolName: "t" },
      event: "tool-call-started-v1",
    });
    const t2 = reduceReasoningEvent(t1, {
      data: { time: 2, toolCallId: "tc", toolName: "t" },
      event: "tool-call-started-v1",
    });
    expect(t2).toBe(t1);
    expect(t2.steps).toHaveLength(1);
  });

  test('tool-call-started 缺 toolName → label "调用 unknown"', () => {
    const t = reduceReasoningEvent(undefined, {
      data: { time: 1, toolCallId: "tc" },
      event: "tool-call-started-v1",
    });
    expect(t.steps[0]?.toolName).toBe("unknown");
    expect(t.steps[0]?.label).toBe("调用 unknown");
  });

  test("tool-call-completed：error + ok=false 写入 error；durationMs 负数 → 截为 0", () => {
    const t0 = reduceReasoningEvent(undefined, {
      data: { time: 100, toolCallId: "tc", toolName: "t" },
      event: "tool-call-started-v1",
    });
    const t1 = reduceReasoningEvent(t0, {
      data: {
        durationMs: -50,
        error: { code: "TOOL_FAIL", message: "boom" },
        ok: false,
        time: 200,
        toolCallId: "tc",
        toolName: "t",
      },
      event: "tool-call-completed-v1",
    });
    const step = t1.steps[0];
    expect(step?.ok).toBe(false);
    expect(step?.error).toEqual({ code: "TOOL_FAIL", message: "boom" });
    expect(step?.durationMs).toBe(0);
    expect(step?.endTime).toBe(200);
  });

  test("tool-call-completed 无先行 started + durationMs → startTime = time - durationMs", () => {
    const t = reduceReasoningEvent(undefined, {
      data: { durationMs: 80, ok: true, time: 500, toolCallId: "tc", toolName: "t" },
      event: "tool-call-completed-v1",
    });
    expect(t.steps[0]?.startTime).toBe(420);
    expect(t.steps[0]?.endTime).toBe(500);
  });

  test("tool-call-completed：output 显式 undefined 也保留键存在语义（hasOwn）", () => {
    const t = reduceReasoningEvent(undefined, {
      data: { output: undefined, time: 1, toolCallId: "tc", toolName: "t" },
      event: "tool-call-completed-v1",
    });
    expect(Object.hasOwn(t.steps[0], "output")).toBe(true);
  });

  test("forceCloseActiveReasoning：tree undefined → 空树；全部已 END → 原值保留", () => {
    const closed = forceCloseActiveReasoning(undefined, { code: "C", message: "m" });
    expect(closed.steps).toEqual([]);
    const t0 = reduceReasoningEvent(undefined, {
      data: { event: "START", kind: "phase", stepId: "a", time: 1 },
      event: "reasoning-step-v1",
    });
    const t1 = reduceReasoningEvent(t0, {
      data: { event: "END", kind: "phase", ok: true, stepId: "a", time: 5 },
      event: "reasoning-step-v1",
    });
    const closed2 = forceCloseActiveReasoning(t1, { code: "C", message: "m" }, 999);
    expect(closed2.steps[0]?.ok).toBe(true);
    expect(closed2.steps[0]?.endTime).toBe(5);
  });

  test("shouldExpandReasoningStepByDefault：无 phase 的 phase-kind / tool-call → false", () => {
    expect(
      shouldExpandReasoningStepByDefault({
        kind: "phase",
        label: "l",
        startTime: 1,
        stepId: "s",
        text: "",
      }),
    ).toBe(false);
    expect(
      shouldExpandReasoningStepByDefault({
        kind: "tool-call",
        label: "l",
        startTime: 1,
        stepId: "s",
        text: "",
      }),
    ).toBe(false);
  });
});

describe("formatReasoningElapsedMs — 阶梯边界", () => {
  test("负数 → 0ms；999 → 999ms；1000 → 1s", () => {
    expect(formatReasoningElapsedMs(-5)).toBe("0ms");
    expect(formatReasoningElapsedMs(999)).toBe("999ms");
    expect(formatReasoningElapsedMs(1000)).toBe("1s");
  });

  test("10s 以下保留 1 位小数；整数化（9.999s → 10s）", () => {
    expect(formatReasoningElapsedMs(9_940)).toBe("9.9s");
    expect(formatReasoningElapsedMs(9_999)).toBe("10s");
    expect(formatReasoningElapsedMs(2_000)).toBe("2s");
  });

  test("分钟段：60000 → 1m；61000 → 1m1s；小时段：3600000 → 1h", () => {
    expect(formatReasoningElapsedMs(59_999)).toBe("60s");
    expect(formatReasoningElapsedMs(60_000)).toBe("1m");
    expect(formatReasoningElapsedMs(61_000)).toBe("1m1s");
    expect(formatReasoningElapsedMs(3_600_000)).toBe("1h");
  });
});

describe("sessions — 分组 / 过滤补充", () => {
  test("groupSessionsByDate：今天零点整恰好归 today；昨天零点整归 yesterday", () => {
    const now = new Date("2026-06-11T12:00:00").getTime();
    const todayStart = new Date("2026-06-11T00:00:00").getTime();
    const yesterdayStart = new Date("2026-06-10T00:00:00").getTime();
    const sessions: AssistantSessionSummary[] = [
      { id: "edge-today", title: "", updatedAt: todayStart },
      { id: "edge-yest", title: "", updatedAt: yesterdayStart },
      { id: "before", title: "", updatedAt: yesterdayStart - 1 },
    ];
    const g = groupSessionsByDate(sessions, now);
    expect(g.today.map((s) => s.id)).toEqual(["edge-today"]);
    expect(g.yesterday.map((s) => s.id)).toEqual(["edge-yest"]);
    expect(g.earlier.map((s) => s.id)).toEqual(["before"]);
  });

  test("filterSessionsByKeyword 大小写不敏感", () => {
    const sessions: AssistantSessionSummary[] = [
      { id: "1", title: "Alarm Report", updatedAt: 1 },
      { id: "2", title: "other", updatedAt: 1 },
    ];
    expect(filterSessionsByKeyword(sessions, "aLaRm").map((s) => s.id)).toEqual(["1"]);
  });
});
