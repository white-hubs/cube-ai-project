import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, describe, expect, test } from "bun:test";

/**
 * Assistant slice composables 单元测试（离线）：
 *
 * 通过可控的 fake AssistantEnginePort（push 式 SSE channel）驱动底层 AssistantStore，
 * 验证 Vue 适配层各切片的响应式行为：
 *   - useAssistantSessions：reload/open/create/rename/remove + loading + grouped
 *   - useAssistantMessages：send 状态机（running/completed/failed）、SSE message-delta
 *     增量更新、placeholder id 替换、busy 防重、cancel
 *   - useAssistantGrants：grant-request-v1 → pendingGrants/awaitingGrant → respondGrant
 *   - useAssistantTools：tool-call started/completed timeline
 *   - useAssistantReasoning：reasoning-step/delta 折叠为 reasoning 树
 *   - useAssistantTokenUsage：usage-delta-v2 / turn-completed 归集
 *   - useAssistantLlmModels：listModels 注入 + loading
 *   - useAssistantDebug：debugEventBuffer 环形缓冲
 *   - 卸载清理：unmount → store dispose + 活跃 SSE stream abort
 */

const registeredHappyDomForThisFile = globalThis.document === undefined;
if (registeredHappyDomForThisFile) {
  GlobalRegistrator.register();
}
const { defineComponent, h, createApp, nextTick } = await import("vue");
const {
  provideAssistant,
  useAssistant,
  useAssistantSessions,
  useAssistantMessages,
  useAssistantReasoning,
  useAssistantGrants,
  useAssistantTools,
  useAssistantTokenUsage,
  useAssistantDebug,
  useAssistantLlmModels,
} = await import("./index");
const { createMemoryReasoningStore, SessionBusyError, StoreDisposedError } = await import("@cube-ai/agent-sdk-client-assistant");
import type {
  AssistantEnginePort,
  AssistantSessionSummary,
  GrantResponseInput,
  NormalizedSseEvent,
  PortMessageItem,
} from "@cube-ai/agent-sdk-client-assistant";

import type { ProvideAssistantOptions } from "./provide-assistant";

afterAll(async () => {
  if (registeredHappyDomForThisFile) {
    await GlobalRegistrator.unregister();
  }
});

// ---------------------------------------------------------------------------
// 测试基建：push 式 SSE channel + 可控 fake port
// ---------------------------------------------------------------------------

class SseChannel {
  private queue: NormalizedSseEvent[] = [];
  private notify: (() => void) | null = null;
  private closed = false;

  push(ev: NormalizedSseEvent): void {
    this.queue.push(ev);
    this.notify?.();
  }

  close(): void {
    this.closed = true;
    this.notify?.();
  }

  async *stream(signal?: AbortSignal): AsyncGenerator<NormalizedSseEvent> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.closed || signal?.aborted) {
        return;
      }
      await new Promise<void>((resolve) => {
        this.notify = () => {
          this.notify = null;
          resolve();
        };
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  }
}

interface PortCalls {
  startTurn: { sessionId: string; body: Record<string, unknown> }[];
  patchSession: { sessionId: string; patch: { title?: string; status?: string } }[];
  deleteSession: string[];
  cancelTurn: { sessionId: string; turnId: string }[];
  respondGrant: GrantResponseInput[];
}

class FakePort implements AssistantEnginePort {
  readonly calls: PortCalls = {
    cancelTurn: [],
    deleteSession: [],
    patchSession: [],
    respondGrant: [],
    startTurn: [],
  };
  /** streamEvents 收到的 AbortSignal（按调用顺序）。 */
  readonly streamSignals: AbortSignal[] = [];
  sessionsResult: AssistantSessionSummary[] = [];
  messagesResult: PortMessageItem[] = [];

  private readonly channels = new Map<string, SseChannel>();
  private sessionSeq = 0;
  private turnSeq = 0;

  channel(sessionId: string, turnId: string): SseChannel {
    const key = `${sessionId}::${turnId}`;
    let ch = this.channels.get(key);
    if (!ch) {
      ch = new SseChannel();
      this.channels.set(key, ch);
    }
    return ch;
  }

  async startTurn(sessionId: string, body: Record<string, unknown>): Promise<{ turnId: string }> {
    this.calls.startTurn.push({ body, sessionId });
    this.turnSeq++;
    return { turnId: `turn-${this.turnSeq}` };
  }

  streamEvents(
    sessionId: string,
    opts?: { turnId?: string; lastEventId?: string; signal?: AbortSignal },
  ): AsyncIterable<NormalizedSseEvent> {
    if (opts?.signal) {
      this.streamSignals.push(opts.signal);
    }
    return this.channel(sessionId, opts?.turnId ?? "").stream(opts?.signal);
  }

  async listMessages(): Promise<{ items: PortMessageItem[] }> {
    return { items: this.messagesResult };
  }

  async createSession(req: { agentId: string; title?: string }): Promise<{ id: string; title: string | null; createTime: number }> {
    this.sessionSeq++;
    return {
      createTime: Date.now(),
      id: `sess-${this.sessionSeq}`,
      title: req.title ?? "",
    };
  }

  async listSessions(): Promise<{ items: AssistantSessionSummary[]; hasMore: boolean }> {
    return { hasMore: false, items: this.sessionsResult };
  }

  async getSession(): Promise<null> {
    return null;
  }

  async patchSession(sessionId: string, patch: { title?: string; status?: "ACTIVE" | "CLOSED" }): Promise<void> {
    this.calls.patchSession.push({ patch, sessionId });
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.calls.deleteSession.push(sessionId);
  }

  async cancelTurn(sessionId: string, turnId: string): Promise<void> {
    this.calls.cancelTurn.push({ sessionId, turnId });
  }

  async respondGrant(input: GrantResponseInput): Promise<void> {
    this.calls.respondGrant.push(input);
  }
}

async function until(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("until(): condition not met within timeout");
    }
    await new Promise((r) => setTimeout(r, 5));
    await nextTick();
  }
}

interface Mounted<T> {
  api: T;
  unmount: () => void;
}

async function mountAssistant<T>(opts: ProvideAssistantOptions, runChildSetup: () => T): Promise<Mounted<T>> {
  let captured: T | undefined;
  const Child = defineComponent({
    setup() {
      captured = runChildSetup();
      return () => h("span");
    },
  });
  const Root = defineComponent({
    setup() {
      provideAssistant(opts);
      return () => h(Child);
    },
  });
  const app = createApp(Root);
  const host = document.createElement("div");
  document.body.append(host);
  app.mount(host);
  await nextTick();
  if (captured === undefined) {
    throw new Error("child setup did not capture");
  }
  return {
    api: captured,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

function baseOpts(port: FakePort): ProvideAssistantOptions {
  return {
    defaultAgentId: "agent-1",
    engine: port,
    reasoningStore: createMemoryReasoningStore(),
  };
}

// ---------------------------------------------------------------------------
// useAssistantSessions
// ---------------------------------------------------------------------------

describe("useAssistantSessions", () => {
  test("reload：loadingSessions 状态机 + sessions/grouped 落位", async () => {
    const port = new FakePort();
    const now = Date.now();
    port.sessionsResult = [
      { id: "s-today", title: "今天", updatedAt: now },
      { id: "s-old", title: "很久以前", updatedAt: now - 30 * 24 * 3600_000 },
    ];
    const { api, unmount } = await mountAssistant(baseOpts(port), () => useAssistantSessions());
    expect(api.sessions.value).toEqual([]);
    const pending = api.reload();
    await until(() => api.loading.value === true || api.sessions.value.length > 0);
    await pending;
    await nextTick();
    expect(api.loading.value).toBe(false);
    expect(api.sessions.value.map((s) => s.id)).toEqual(["s-today", "s-old"]);
    expect(api.grouped.value.today.map((s) => s.id)).toEqual(["s-today"]);
    expect(api.grouped.value.earlier.map((s) => s.id)).toEqual(["s-old"]);
    unmount();
  });

  test("create → currentSessionId 置位 + sessions 头插；open → 拉取历史消息", async () => {
    const port = new FakePort();
    port.messagesResult = [
      { content: "hi", createTime: 1, id: "m-1", role: "user", turnId: null },
      { content: "hello!", createTime: 2, id: "m-2", role: "assistant", turnId: "t-0" },
    ];
    const { api, unmount } = await mountAssistant(baseOpts(port), () => ({
      messages: useAssistantMessages(),
      sessions: useAssistantSessions(),
    }));
    const id = await api.sessions.create({ title: "新会话" });
    await nextTick();
    expect(id).toBe("sess-1");
    expect(api.sessions.currentSessionId.value).toBe("sess-1");
    expect(api.sessions.sessions.value[0]?.id).toBe("sess-1");

    await api.sessions.open("sess-1");
    await until(() => api.messages.messages.value.length === 2);
    expect(api.messages.messages.value[0]).toMatchObject({
      content: "hi",
      id: "m-1",
      role: "user",
    });
    expect(api.messages.messages.value[1]).toMatchObject({
      content: "hello!",
      id: "m-2",
      role: "assistant",
      turnId: "t-0",
    });
    unmount();
  });

  test("rename → engine.patchSession + 标题就地更新；remove → 会话移除 + current 清空", async () => {
    const port = new FakePort();
    const { api, unmount } = await mountAssistant(baseOpts(port), () => useAssistantSessions());
    const id = await api.create({ title: "原标题" });
    await nextTick();

    await api.rename(id, "新标题");
    await nextTick();
    expect(port.calls.patchSession).toContainEqual({
      patch: { title: "新标题" },
      sessionId: id,
    });
    expect(api.sessions.value.find((s) => s.id === id)?.title).toBe("新标题");

    await api.remove(id);
    await nextTick();
    expect(port.calls.deleteSession).toEqual([id]);
    expect(api.sessions.value.find((s) => s.id === id)).toBeUndefined();
    expect(api.currentSessionId.value).toBeNull();
    unmount();
  });
});

// ---------------------------------------------------------------------------
// useAssistantMessages — send 状态机 + SSE 驱动
// ---------------------------------------------------------------------------

describe("useAssistantMessages — send 状态机", () => {
  test("send → running；SSE message-delta 增量 + placeholder id 替换；turn-completed → completed", async () => {
    const port = new FakePort();
    const { api, unmount } = await mountAssistant(baseOpts(port), () => useAssistantMessages());
    expect(api.lastTurnStatus.value).toBe("idle");

    const { turnId } = await api.send("你好");
    await nextTick();
    expect(turnId).toBe("turn-1");
    expect(api.sending.value).toBe(true);
    expect(api.lastTurnStatus.value).toBe("running");
    // user 占位 + assistant 占位
    expect(api.messages.value.length).toBe(2);
    expect(api.messages.value[0]).toMatchObject({ content: "你好", role: "user" });
    expect(api.messages.value[1]?.role).toBe("assistant");
    expect(api.messages.value[1]?.content).toBe("");

    const ch = port.channel("sess-1", "turn-1");
    ch.push({
      data: { delta: "你好，", messageId: "m-srv-1", turnId: "turn-1" },
      event: "message-delta-v1",
    });
    ch.push({
      data: { delta: "世界", messageId: "m-srv-1", turnId: "turn-1" },
      event: "message-delta-v1",
    });
    await until(() => api.messages.value[1]?.content === "你好，世界");
    expect(api.messages.value[1]?.id).toBe("m-srv-1");
    expect(api.messages.value[1]?.turnId).toBe("turn-1");

    ch.push({ data: { turnId: "turn-1" }, event: "turn-completed-v1" });
    await until(() => api.lastTurnStatus.value === "completed");
    expect(api.sending.value).toBe(false);
    expect(api.lastTurnFailure.value).toBeNull();
    unmount();
  });

  test("sending 中再次 send → SessionBusyError（本地预检）", async () => {
    const port = new FakePort();
    const { api, unmount } = await mountAssistant(baseOpts(port), () => useAssistantMessages());
    await api.send("第一条");
    await nextTick();
    expect(api.sending.value).toBe(true);
    await expect(api.send("第二条")).rejects.toBeInstanceOf(SessionBusyError);
    // busy 防重不应产生第二次 startTurn
    expect(port.calls.startTurn.length).toBe(1);
    unmount();
  });

  test("turn-failed → status failed + failure 摘要 + assistant 内容替换为失败信息", async () => {
    const port = new FakePort();
    const { api, unmount } = await mountAssistant(baseOpts(port), () => useAssistantMessages());
    await api.send("触发失败");
    await nextTick();

    port.channel("sess-1", "turn-1").push({
      data: {
        error: { code: "LLM_TIMEOUT", message: "模型超时" },
        turnId: "turn-1",
      },
      event: "turn-failed-v1",
    });
    await until(() => api.lastTurnStatus.value === "failed");
    expect(api.sending.value).toBe(false);
    expect(api.lastTurnFailure.value?.message).toContain("模型超时");
    expect(api.messages.value[1]?.content).toContain("模型超时");
    unmount();
  });

  test("cancel → engine.cancelTurn + sending 复位 + 本 turn stream abort", async () => {
    const port = new FakePort();
    const { api, unmount } = await mountAssistant(baseOpts(port), () => useAssistantMessages());
    await api.send("要取消的");
    await nextTick();
    expect(api.sending.value).toBe(true);
    expect(port.streamSignals.length).toBe(1);
    expect(port.streamSignals[0]!.aborted).toBe(false);

    await api.cancel();
    await nextTick();
    expect(api.sending.value).toBe(false);
    expect(port.calls.cancelTurn).toEqual([{ sessionId: "sess-1", turnId: "turn-1" }]);
    expect(port.streamSignals[0]!.aborted).toBe(true);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// useAssistantGrants
// ---------------------------------------------------------------------------

describe("useAssistantGrants", () => {
  test("grant-request-v1 → pendingGrants/awaitingGrant；respondGrant → 清空并透传 engine", async () => {
    const port = new FakePort();
    const { api, unmount } = await mountAssistant(baseOpts(port), () => ({
      grants: useAssistantGrants(),
      messages: useAssistantMessages(),
    }));
    expect(api.grants.pendingGrants.value).toEqual([]);
    expect(api.grants.awaitingGrant.value).toBe(false);

    await api.messages.send("需要授权的操作");
    await nextTick();

    port.channel("sess-1", "turn-1").push({
      data: {
        argsPreview: { path: "/tmp/x" },
        grantRequestId: "grant-1",
        reason: "destructive op",
        scopeHint: "ONCE",
        toolName: "delete_file",
        turnId: "turn-1",
      },
      event: "grant-request-v1",
    });
    await until(() => api.grants.pendingGrants.value.length === 1);
    expect(api.grants.awaitingGrant.value).toBe(true);
    expect(api.grants.pendingGrants.value[0]).toMatchObject({
      grantRequestId: "grant-1",
      reason: "destructive op",
      scopeHint: "ONCE",
      toolName: "delete_file",
      turnId: "turn-1",
    });

    await api.grants.respondGrant({
      decision: "APPROVE",
      grantRequestId: "grant-1",
      scopeChoice: "ONCE",
    });
    await nextTick();
    expect(api.grants.pendingGrants.value).toEqual([]);
    expect(api.grants.awaitingGrant.value).toBe(false);
    expect(port.calls.respondGrant).toEqual([{ decision: "APPROVE", grantRequestId: "grant-1", scopeChoice: "ONCE" }]);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// useAssistantTools
// ---------------------------------------------------------------------------

describe("useAssistantTools", () => {
  test("tool-call started/completed → timeline phase 迁移 + resultPreview", async () => {
    const port = new FakePort();
    const { api, unmount } = await mountAssistant(baseOpts(port), () => ({
      messages: useAssistantMessages(),
      tools: useAssistantTools(),
    }));
    expect(api.tools.toolEvents.value).toEqual([]);

    await api.messages.send("查个东西");
    await nextTick();
    const ch = port.channel("sess-1", "turn-1");

    ch.push({
      data: { time: 100, toolCallId: "call-1", toolName: "web_search", turnId: "turn-1" },
      event: "tool-call-started-v1",
    });
    await until(() => api.tools.toolEvents.value.length === 1);
    expect(api.tools.toolEvents.value[0]).toMatchObject({
      id: "call-1",
      phase: "started",
      startedAt: 100,
      toolName: "web_search",
      turnId: "turn-1",
    });

    ch.push({
      data: {
        resultPreview: { hits: 3 },
        time: 250,
        toolCallId: "call-1",
        toolName: "web_search",
        turnId: "turn-1",
      },
      event: "tool-call-completed-v1",
    });
    await until(() => api.tools.toolEvents.value[0]?.phase === "completed");
    expect(api.tools.toolEvents.value.length).toBe(1);
    expect(api.tools.toolEvents.value[0]).toMatchObject({
      completedAt: 250,
      id: "call-1",
      resultPreview: { hits: 3 },
    });
    unmount();
  });
});

// ---------------------------------------------------------------------------
// useAssistantReasoning
// ---------------------------------------------------------------------------

describe("useAssistantReasoning", () => {
  test("reasoning-step START/delta/END 折叠进当前 assistant 消息的 reasoning 树", async () => {
    const port = new FakePort();
    const { api, unmount } = await mountAssistant(baseOpts(port), () => ({
      messages: useAssistantMessages(),
      reasoning: useAssistantReasoning(),
    }));
    expect(api.reasoning.lastReasoning.value).toBeNull();

    await api.messages.send("想一想");
    await nextTick();
    // send 后 placeholder assistant 自带空 reasoning 树
    expect(api.reasoning.lastReasoning.value).toEqual({ steps: [] });

    const ch = port.channel("sess-1", "turn-1");
    const clientBefore = Date.now();
    ch.push({
      data: {
        event: "START",
        kind: "lifecycle",
        label: "开始处理",
        point: "turnStart",
        stepId: "step-1",
        time: 10,
        turnId: "turn-1",
      },
      event: "reasoning-step-v1",
    });
    ch.push({
      data: { stepId: "step-1", text: "先查", turnId: "turn-1" },
      event: "reasoning-delta-v1",
    });
    ch.push({
      data: { stepId: "step-1", text: "资料", turnId: "turn-1" },
      event: "reasoning-delta-v1",
    });
    ch.push({
      data: {
        event: "END",
        kind: "lifecycle",
        ok: true,
        stepId: "step-1",
        time: 42,
        turnId: "turn-1",
      },
      event: "reasoning-step-v1",
    });
    await until(() => api.reasoning.lastReasoning.value?.steps[0]?.ok === true);
    const step = api.reasoning.lastReasoning.value!.steps[0]!;
    expect(step).toMatchObject({
      kind: "lifecycle",
      label: "开始处理",
      ok: true,
      point: "turnStart",
      stepId: "step-1",
      text: "先查资料",
    });
    // 计时锚点取【客户端本地时钟】（不再落库服务端 data.time=10/42），且 end 不早于 start
    expect(step.startTime).not.toBe(10);
    expect(step.endTime).not.toBe(42);
    expect(step.startTime).toBeGreaterThanOrEqual(clientBefore);
    expect(step.endTime ?? 0).toBeGreaterThanOrEqual(step.startTime);
    expect(step.endTime ?? 0).toBeLessThanOrEqual(Date.now());
    unmount();
  });
});

// ---------------------------------------------------------------------------
// useAssistantTokenUsage
// ---------------------------------------------------------------------------

describe("useAssistantTokenUsage", () => {
  test("usage-delta-v2 归集 items + cumulative；turn-completed 覆盖最终 cumulative", async () => {
    const port = new FakePort();
    const { api, unmount } = await mountAssistant(baseOpts(port), () => ({
      messages: useAssistantMessages(),
      usage: useAssistantTokenUsage(),
    }));
    expect(api.usage.tokenUsage.value).toBeNull();

    await api.messages.send("算 token");
    await nextTick();
    const ch = port.channel("sess-1", "turn-1");

    ch.push({
      data: {
        accuracy: "final",
        attribution: { id: "llm-1", kind: "llm-call" },
        cumulative: { input: 10, output: 5, total: 15 },
        turnId: "turn-1",
        usage: { input: 10, output: 5, total: 15 },
      },
      event: "usage-delta-v2",
    });
    await until(() => api.usage.tokenUsage.value !== null);
    expect(api.usage.tokenUsage.value).toMatchObject({
      cumulative: { input: 10, output: 5, total: 15 },
      turnId: "turn-1",
    });
    expect(api.usage.tokenUsage.value!.items.length).toBe(1);
    expect(api.usage.tokenUsage.value!.items[0]).toMatchObject({
      accuracy: "final",
      attribution: { id: "llm-1", kind: "llm-call" },
      usage: { input: 10, output: 5, total: 15 },
    });

    ch.push({
      data: { tokenUsage: { input: 12, output: 6, total: 18 }, turnId: "turn-1" },
      event: "turn-completed-v1",
    });
    await until(() => api.usage.tokenUsage.value?.cumulative.total === 18);
    // 同 turn 的 items 保留
    expect(api.usage.tokenUsage.value!.items.length).toBe(1);
    expect(api.messages.lastTurnStatus.value).toBe("completed");
    unmount();
  });
});

// ---------------------------------------------------------------------------
// useAssistantLlmModels / useAssistantDebug
// ---------------------------------------------------------------------------

describe("useAssistantLlmModels", () => {
  test("listModels 注入 → loading true→false + models 落位", async () => {
    const port = new FakePort();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const models = [{ displayName: "GPT-X", modelCode: "gpt-x", providerName: "openai" }];
    const { api, unmount } = await mountAssistant(
      {
        ...baseOpts(port),
        listModels: async () => {
          await gate;
          return models;
        },
      },
      () => useAssistantLlmModels(),
    );
    expect(api.loading.value).toBe(true);
    expect(api.models.value).toEqual([]);
    release!();
    await until(() => api.loading.value === false);
    expect(api.models.value).toEqual(models);
    unmount();
  });

  test("listModels 失败 → swallow，loading 复位、models 保持空", async () => {
    const port = new FakePort();
    const { api, unmount } = await mountAssistant(
      {
        ...baseOpts(port),
        listModels: async () => {
          throw new Error("catalog down");
        },
      },
      () => useAssistantLlmModels(),
    );
    await until(() => api.loading.value === false);
    expect(api.models.value).toEqual([]);
    unmount();
  });
});

describe("useAssistantDebug", () => {
  test("debugEventBuffer 环形缓冲：超过 max 时丢最旧", async () => {
    const port = new FakePort();
    const { api, unmount } = await mountAssistant({ ...baseOpts(port), debugEventBuffer: { max: 2 } }, () => ({
      debug: useAssistantDebug(),
      messages: useAssistantMessages(),
    }));
    await api.messages.send("debug");
    await nextTick();
    const ch = port.channel("sess-1", "turn-1");
    ch.push({ data: { delta: "a", turnId: "turn-1" }, event: "message-delta-v1" });
    ch.push({ data: { delta: "b", turnId: "turn-1" }, event: "message-delta-v1" });
    ch.push({ data: { delta: "c", turnId: "turn-1" }, event: "message-delta-v1" });
    await until(() => api.debug.events.value.length === 2 && api.debug.events.value[1]?.data.delta === "c");
    expect(api.debug.events.value[0]?.data.delta).toBe("b");
    unmount();
  });
});

// ---------------------------------------------------------------------------
// 卸载清理
// ---------------------------------------------------------------------------

describe("卸载清理", () => {
  test("unmount → store dispose：state 清空、活跃 stream abort、再调用抛 StoreDisposedError", async () => {
    const port = new FakePort();
    const { api, unmount } = await mountAssistant(baseOpts(port), () => ({
      instance: useAssistant(),
      messages: useAssistantMessages(),
    }));
    await api.messages.send("卸载前发送");
    await nextTick();
    expect(port.streamSignals.length).toBe(1);
    expect(port.streamSignals[0]!.aborted).toBe(false);

    unmount();
    await nextTick();
    expect(port.streamSignals[0]!.aborted).toBe(true);
    expect(api.instance.store.getState().sessions).toEqual([]);
    expect(api.instance.store.getState().messagesBySessionId).toEqual({});
    await expect(api.instance.store.send("卸载后发送")).rejects.toBeInstanceOf(StoreDisposedError);
  });
});
