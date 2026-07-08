import type { AdapterCallContext, MemoryEntry } from "@tachu/core";
import { describe, expect, it } from "bun:test";
import type Redis from "ioredis";

import { InMemoryStore } from "./in-memory-store";
import { RedisMemoryStore } from "./redis-memory-store";

/**
 * B2 —— 记忆键去 tenant：`{prefix}{tenant}:{sessionId}` → `{prefix}{sessionId}`。
 * 隔离改由「全局唯一 sessionId + turn-start 归属门禁」承担；同一 sessionId 无论
 * ctx.tenant 为何，都命中同一记忆空间（修掉 loadFull 用默认租户读错空间的 P2）。
 */
const ctx = (tenant?: number): AdapterCallContext => ({
  correlation: { traceId: "t", requestId: "t", sessionId: "t", turnId: "t" },
  ...(tenant !== undefined ? { tenant } : {}),
});

const entry = (content: string): MemoryEntry => ({
  id: `e-${content}-${Date.now()}-${Math.random()}`,
  role: "user",
  content,
  timestamp: Date.now(),
  anchored: false,
});

function capturingRedis(): { redis: Redis; keys: Set<string>; lists: Map<string, string[]> } {
  const lists = new Map<string, string[]>();
  const keys = new Set<string>();
  const pipeline = () => {
    const chain = {
      lpush(k: string, v: string) {
        keys.add(k);
        const a = lists.get(k) ?? [];
        a.unshift(v);
        lists.set(k, a);
        return chain;
      },
      ltrim() {
        return chain;
      },
      expire() {
        return chain;
      },
      del(k: string) {
        keys.add(k);
        lists.delete(k);
        return chain;
      },
      exec: async () => [],
    };
    return chain;
  };
  const redis = {
    status: "ready",
    connect: async () => {},
    lrange: async (k: string) => {
      keys.add(k);
      return [...(lists.get(k) ?? [])];
    },
    pipeline,
    del: async (k: string) => {
      keys.add(k);
      lists.delete(k);
      return 1;
    },
    quit: async () => {},
  } as unknown as Redis;
  return { redis, keys, lists };
}

describe("InMemoryStore — key ignores tenant (B2)", () => {
  it("append under one tenant is visible when loaded under another tenant", async () => {
    const s = new InMemoryStore();
    await s.append("sess-shared", entry("hello"), ctx(2));
    const w = await s.load("sess-shared", ctx(9));
    expect(w.entries.map((e) => e.content)).toEqual(["hello"]);
  });

  it("getSize / clear match by exact sessionId (no tenant prefix)", async () => {
    const s = new InMemoryStore();
    await s.append("sess-size", entry("a"), ctx(5));
    expect((await s.getSize("sess-size")).entries).toBe(1);
    await s.clear("sess-size");
    expect((await s.getSize("sess-size")).entries).toBe(0);
    expect((await s.load("sess-size", ctx(9))).entries).toEqual([]);
  });

  it("trim matches by exact sessionId after a tenant-scoped append", async () => {
    const s = new InMemoryStore();
    await s.append("sess-trim", entry("1"), ctx(3));
    await s.append("sess-trim", entry("2"), ctx(3));
    await s.append("sess-trim", entry("3"), ctx(3));
    await s.trim("sess-trim", { keepHead: 0, keepTail: 1 });
    const w = await s.load("sess-trim", ctx());
    expect(w.entries.map((e) => e.content)).toEqual(["3"]);
  });
});

describe("RedisMemoryStore — key ignores tenant (B2)", () => {
  it("redis key has no tenant segment", async () => {
    const { redis, keys } = capturingRedis();
    const store = new RedisMemoryStore({ redisUrl: "redis://mock", tenantId: 1, redisFactory: () => redis });
    await store.append("sid-x", entry("one"), ctx(7));
    expect(keys.has("agentic:engine:memory:sid-x")).toBe(true);
    for (const k of keys) {
      expect(k).not.toMatch(/agentic:engine:memory:\d+:sid-x/);
    }
  });

  it("loadFull() no longer depends on ctx/tenant (P2 fix)", async () => {
    const { redis } = capturingRedis();
    const store = new RedisMemoryStore({ redisUrl: "redis://mock", tenantId: 1, redisFactory: () => redis });
    await store.append("sid-lf", entry("remembered"), ctx(7));
    const entries = await store.loadFull("sid-lf");
    expect(entries.map((e) => e.content)).toEqual(["remembered"]);
  });
});
