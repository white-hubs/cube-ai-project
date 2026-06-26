/**
 * createAgenticEnginePort 适配层测试：
 *   - SseEvent → NormalizedSseEvent 归一化规则（schema → event 名 / data spread / raw 保留）
 *   - listMessages / listSessions / createSession / getSession 字段映射
 *   - patch / delete / cancelTurn / respondGrant 透传
 *   - listModels 可选注入
 *
 * 离线：用最小 fake AgenticClient（仅 port 实际访问的 sessions / grants 面）。
 */
import { describe, expect, test } from "bun:test";

import type { AgenticClient, SseEvent } from "@cube-ai/agent-sdk-client";

import { createAgenticEnginePort } from "./engine-port";
import type { NormalizedSseEvent } from "./port";

interface FakeClientCalls {
  startTurn: Array<{ sessionId: string; body: unknown }>;
  streamEvents: Array<{ sessionId: string; opts: unknown }>;
  listMessages: Array<{ sessionId: string; opts: unknown }>;
  create: unknown[];
  list: unknown[];
  get: string[];
  patch: Array<{ sessionId: string; patch: unknown }>;
  delete: string[];
  cancelTurn: Array<{ sessionId: string; turnId: string }>;
  grantRespond: unknown[];
}

function makeFakeClient(
  config: {
    sseEvents?: Array<Record<string, unknown>>;
    messages?: Array<Record<string, unknown>>;
    sessions?: Array<Record<string, unknown>>;
    hasMore?: boolean;
    created?: Record<string, unknown>;
    session?: Record<string, unknown>;
  } = {},
): { client: AgenticClient; calls: FakeClientCalls } {
  const calls: FakeClientCalls = {
    startTurn: [],
    streamEvents: [],
    listMessages: [],
    create: [],
    list: [],
    get: [],
    patch: [],
    delete: [],
    cancelTurn: [],
    grantRespond: [],
  };
  const fake = {
    sessions: {
      startTurn: async (sessionId: string, body: unknown) => {
        calls.startTurn.push({ sessionId, body });
        return { turnId: "turn-1" };
      },
      async *streamEvents(sessionId: string, opts: unknown): AsyncIterable<unknown> {
        calls.streamEvents.push({ sessionId, opts });
        for (const ev of config.sseEvents ?? []) yield ev;
      },
      listMessages: async (sessionId: string, opts: unknown) => {
        calls.listMessages.push({ sessionId, opts });
        return { items: config.messages ?? [] };
      },
      create: async (req: unknown) => {
        calls.create.push(req);
        return config.created ?? { id: "new-id", createTime: 111 };
      },
      list: async (filter: unknown) => {
        calls.list.push(filter);
        return {
          items: config.sessions ?? [],
          page: { hasMore: config.hasMore ?? false },
        };
      },
      get: async (sessionId: string) => {
        calls.get.push(sessionId);
        return config.session ?? { id: sessionId, updateTime: 5 };
      },
      patch: async (sessionId: string, patch: unknown) => {
        calls.patch.push({ sessionId, patch });
      },
      delete: async (sessionId: string) => {
        calls.delete.push(sessionId);
      },
      cancelTurn: async (sessionId: string, turnId: string) => {
        calls.cancelTurn.push({ sessionId, turnId });
      },
    },
    grants: {
      respond: async (req: unknown) => {
        calls.grantRespond.push(req);
      },
    },
  };
  return { client: fake as unknown as AgenticClient, calls };
}

async function collect(iter: AsyncIterable<NormalizedSseEvent>): Promise<NormalizedSseEvent[]> {
  const out: NormalizedSseEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe("createAgenticEnginePort — SSE normalize", () => {
  test("schema 字段作为 event 名；其余字段 spread 进 data；raw 保留原事件", async () => {
    const raw = {
      schema: "turn-started-v1",
      turnId: "t-1",
      sessionId: "s-1",
      data: { nested: true },
    };
    const { client } = makeFakeClient({ sseEvents: [raw] });
    const port = createAgenticEnginePort(client);
    const events = await collect(port.streamEvents("s-1"));
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.event).toBe("turn-started-v1");
    expect(ev.data.schema).toBeUndefined(); // schema 自身被剔除
    expect(ev.data.turnId).toBe("t-1");
    expect(ev.data.sessionId).toBe("s-1");
    expect(ev.data.data).toEqual({ nested: true }); // 已有 data 字段保留嵌套
    expect(ev.raw).toBe(raw as unknown as SseEvent);
  });

  test('无 schema 时 fallback 到 event 字段；两者皆无 → "unknown"', async () => {
    const { client } = makeFakeClient({
      sseEvents: [{ event: "legacy-event", x: 1 }, { y: 2 }],
    });
    const port = createAgenticEnginePort(client);
    const events = await collect(port.streamEvents("s-1"));
    expect(events[0]?.event).toBe("legacy-event");
    expect(events[0]?.data.x).toBe(1);
    expect(events[1]?.event).toBe("unknown");
    expect(events[1]?.data.y).toBe(2);
  });

  test("streamEvents 透传 sessionId + opts（turnId / lastEventId）", async () => {
    const { client, calls } = makeFakeClient();
    const port = createAgenticEnginePort(client);
    await collect(port.streamEvents("s-9", { turnId: "t-9", lastEventId: "e-1" }));
    expect(calls.streamEvents).toHaveLength(1);
    expect(calls.streamEvents[0]?.sessionId).toBe("s-9");
    expect(calls.streamEvents[0]?.opts).toMatchObject({ turnId: "t-9", lastEventId: "e-1" });
  });
});

describe("createAgenticEnginePort — listMessages 映射", () => {
  test("turnId 缺省 → null；attachments 数组透传；非数组 attachments 丢弃", async () => {
    const { client } = makeFakeClient({
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "hi",
          createTime: 1,
          turnId: "t-1",
          attachments: [
            {
              attachmentId: "att-1",
              kind: "image",
              fileId: "f-1",
              mimeType: "image/png",
            },
          ],
        },
        { id: "m2", role: "user", content: "q", createTime: 2 },
        { id: "m3", role: "user", content: "q2", createTime: 3, attachments: "oops" },
      ],
    });
    const port = createAgenticEnginePort(client);
    const { items } = await port.listMessages("s-1", { limit: 10 });
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ id: "m1", turnId: "t-1" });
    expect(items[0]?.attachments?.[0]?.attachmentId).toBe("att-1");
    expect(items[1]?.turnId).toBeNull();
    expect(items[1]?.attachments).toBeUndefined();
    expect(items[2]?.attachments).toBeUndefined();
  });

  test("opts 缺省时传空对象给 sdk listMessages", async () => {
    const { client, calls } = makeFakeClient();
    const port = createAgenticEnginePort(client);
    await port.listMessages("s-1");
    expect(calls.listMessages[0]?.opts).toEqual({});
  });
});

describe("createAgenticEnginePort — session CRUD 映射", () => {
  test("createSession：title 缺省 → null；可选字段仅在定义时透传", async () => {
    const { client, calls } = makeFakeClient({
      created: { id: "new-1", createTime: 42 },
    });
    const port = createAgenticEnginePort(client);
    const r = await port.createSession({ agentId: "agent-1" });
    expect(r).toEqual({ id: "new-1", title: null, createTime: 42 });
    expect(calls.create[0]).toEqual({ agentId: "agent-1" }); // 无 undefined 键
  });

  test("createSession：全字段透传 + 返回 title", async () => {
    const { client, calls } = makeFakeClient({
      created: { id: "new-2", createTime: 43, title: "标题" },
    });
    const port = createAgenticEnginePort(client);
    const r = await port.createSession({
      agentId: "agent-1",
      title: "标题",
      modelCode: "gpt-x",
      context: { systemSuffix: "ctx" },
    });
    expect(r.title).toBe("标题");
    expect(calls.create[0]).toEqual({
      agentId: "agent-1",
      title: "标题",
      modelCode: "gpt-x",
      context: { systemSuffix: "ctx" },
    });
  });

  test('listSessions：title null → ""；updateTime → updatedAt；hasMore 来自 page', async () => {
    const { client, calls } = makeFakeClient({
      sessions: [
        { id: "s1", title: null, updateTime: 100 },
        { id: "s2", title: "named", updateTime: 200 },
      ],
      hasMore: true,
    });
    const port = createAgenticEnginePort(client);
    const r = await port.listSessions({ limit: 20, cursor: "c-1" });
    expect(r.hasMore).toBe(true);
    expect(r.items).toEqual([
      { id: "s1", title: "", updatedAt: 100 },
      { id: "s2", title: "named", updatedAt: 200 },
    ]);
    expect(calls.list[0]).toEqual({ limit: 20, cursor: "c-1", purpose: "chat" });
  });

  test("listSessions 无参 → 默认 purpose=chat", async () => {
    const { client, calls } = makeFakeClient();
    const port = createAgenticEnginePort(client);
    await port.listSessions();
    expect(calls.list[0]).toEqual({ purpose: "chat" });
  });

  test("getSession：title 缺省 → null + updateTime 透传", async () => {
    const { client } = makeFakeClient({
      session: { id: "s-1", updateTime: 7 },
    });
    const port = createAgenticEnginePort(client);
    const r = await port.getSession("s-1");
    expect(r).toEqual({ id: "s-1", title: null, updateTime: 7 });
  });

  test("patchSession / deleteSession / cancelTurn / startTurn 直接透传", async () => {
    const { client, calls } = makeFakeClient();
    const port = createAgenticEnginePort(client);
    await port.patchSession("s-1", { title: "new", status: "CLOSED" });
    await port.deleteSession("s-2");
    await port.cancelTurn("s-3", "t-3");
    const r = await port.startTurn("s-4", {
      content: { schema: "message-content-v1", blocks: [{ type: "text", text: "hi" }] },
      attachments: [],
    });
    expect(calls.patch[0]).toEqual({
      sessionId: "s-1",
      patch: { title: "new", status: "CLOSED" },
    });
    expect(calls.delete).toEqual(["s-2"]);
    expect(calls.cancelTurn[0]).toEqual({ sessionId: "s-3", turnId: "t-3" });
    expect(calls.startTurn[0]?.sessionId).toBe("s-4");
    expect(r.turnId).toBe("turn-1");
  });
});

describe("createAgenticEnginePort — grants / listModels", () => {
  test("respondGrant 转发到 client.grants.respond（字段一一对应）", async () => {
    const { client, calls } = makeFakeClient();
    const port = createAgenticEnginePort(client);
    await port.respondGrant({
      grantRequestId: "gr-1",
      decision: "APPROVE",
      scopeChoice: "SESSION",
      rememberTtlSeconds: 60,
      note: "ok",
    });
    expect(calls.grantRespond[0]).toMatchObject({
      grantRequestId: "gr-1",
      decision: "APPROVE",
      scopeChoice: "SESSION",
      rememberTtlSeconds: 60,
      note: "ok",
    });
  });

  test("listModels 缺省不暴露；注入后可调用", async () => {
    const { client } = makeFakeClient();
    const bare = createAgenticEnginePort(client);
    expect(bare.listModels).toBeUndefined();

    const models = [{ modelCode: "gpt-x", displayName: "GPT X", providerName: "openai" }];
    const withModels = createAgenticEnginePort(client, {
      listModels: async () => models,
    });
    expect(withModels.listModels).toBeDefined();
    expect(await withModels.listModels!()).toEqual(models);
  });
});
