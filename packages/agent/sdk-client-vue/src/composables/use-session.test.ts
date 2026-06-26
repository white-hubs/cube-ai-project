/**
 * useSession 单元测试（离线，纯响应式 — 不需要 DOM）：
 *   - sessionId 为 null → 不发请求、session=null
 *   - watch immediate：初始 id 自动 fetch；loading true→false 状态机
 *   - sessionId ref 变化 → 自动 refetch 新 id
 *   - 变回 null → session 清空
 *   - 非 AgenticClientError 异常被包装；AgenticClientError 原样保留
 *   - 手动 refetch
 *
 * client 用手写 stub（仅 sessions.get），与既有测试 stub port 做法一致。
 */
import { describe, expect, test } from "bun:test";
import { effectScope, nextTick, ref } from "vue";

import type { AgenticClient } from "@cube-ai/agent-sdk-client";
import { AgenticClientError } from "@cube-ai/agent-sdk-client";
import type { Session } from "@cube-ai/contracts";

import { useSession } from "./use-session";

async function until(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("until(): condition not met within timeout");
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** contracts SessionId 是 branded string；测试构造时统一收窄。 */
const sid = (v: string): Session["id"] => v as Session["id"];

function makeSession(id: string): Session {
  return {
    id: sid(id),
    status: "ACTIVE",
    agentId: "1001",
    userId: "user-1",
    title: `title-${id}`,
    purpose: "chat",
    createTime: 1000,
    updateTime: 2000,
  };
}

function stubClient(get: (id: string) => Promise<Session>): {
  client: AgenticClient;
  calls: string[];
} {
  const calls: string[] = [];
  const client = {
    sessions: {
      get: async (id: string) => {
        calls.push(id);
        return get(id);
      },
    },
  } as unknown as AgenticClient;
  return { client, calls };
}

describe("useSession", () => {
  test("sessionId=null → 不请求、session=null", async () => {
    const { client, calls } = stubClient(async (id) => makeSession(id));
    const scope = effectScope();
    const api = scope.run(() => useSession(ref<string | null>(null), client))!;
    await until(() => api.session.value === null);
    expect(calls.length).toBe(0);
    expect(api.loading.value).toBe(false);
    expect(api.error.value).toBeNull();
    scope.stop();
  });

  test("初始 id 自动 fetch（watch immediate）+ loading 状态机", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { client, calls } = stubClient(async (id) => {
      await gate;
      return makeSession(id);
    });
    const scope = effectScope();
    const api = scope.run(() => useSession(() => "sess-1", client))!;
    await until(() => api.loading.value === true);
    expect(api.session.value).toBeNull();
    release!();
    await until(() => api.session.value !== null);
    expect(api.loading.value).toBe(false);
    expect(calls).toEqual(["sess-1"]);
    expect(api.session.value!.id).toBe(sid("sess-1"));
    expect(api.session.value!.title).toBe("title-sess-1");
    scope.stop();
  });

  test("sessionId 变化 → 自动 refetch；变回 null → session 清空", async () => {
    const { client, calls } = stubClient(async (id) => makeSession(id));
    const id = ref<string | null>("sess-1");
    const scope = effectScope();
    const api = scope.run(() => useSession(id, client))!;
    await until(() => api.session.value?.id === "sess-1");

    id.value = "sess-2";
    await nextTick();
    await until(() => api.session.value?.id === "sess-2");
    expect(calls).toEqual(["sess-1", "sess-2"]);

    id.value = null;
    await nextTick();
    await until(() => api.session.value === null);
    expect(calls.length).toBe(2);
    scope.stop();
  });

  test("普通 Error 被包装为 AgenticClientError；session 不被破坏", async () => {
    const { client } = stubClient(async () => {
      throw new Error("boom");
    });
    const scope = effectScope();
    const api = scope.run(() => useSession(() => "sess-x", client))!;
    await until(() => api.error.value !== null);
    expect(api.error.value).toBeInstanceOf(AgenticClientError);
    expect(api.error.value!.message).toContain("boom");
    expect(api.loading.value).toBe(false);
    expect(api.session.value).toBeNull();
    scope.stop();
  });

  test("AgenticClientError 原样保留（code/httpStatus 不丢）", async () => {
    const original = new AgenticClientError("SESSION_NOT_FOUND", 404, "session not found", null, "trace-1", Date.now());
    const { client } = stubClient(async () => {
      throw original;
    });
    const scope = effectScope();
    const api = scope.run(() => useSession(() => "sess-x", client))!;
    await until(() => api.error.value !== null);
    expect(api.error.value).toBe(original);
    expect(api.error.value!.code).toBe("SESSION_NOT_FOUND");
    expect(api.error.value!.httpStatus).toBe(404);
    scope.stop();
  });

  test("手动 refetch 重新拉取并清空上次 error", async () => {
    let failing = true;
    const { client, calls } = stubClient(async (id) => {
      if (failing) throw new Error("boom");
      return makeSession(id);
    });
    const scope = effectScope();
    const api = scope.run(() => useSession(() => "sess-1", client))!;
    await until(() => api.error.value !== null);

    failing = false;
    await api.refetch();
    expect(api.error.value).toBeNull();
    expect(api.session.value?.id).toBe(sid("sess-1"));
    expect(calls).toEqual(["sess-1", "sess-1"]);
    scope.stop();
  });
});
