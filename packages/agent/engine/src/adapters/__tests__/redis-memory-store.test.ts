import type { AdapterCallContext, MemoryEntry } from "@tachu/core";
/**
 * RedisMemoryStore — LRANGE / LPUSH+LTRIM / TTL / DEL（Fake Redis）
 */
import { describe, it, expect, mock } from "bun:test";
import type Redis from "ioredis";

import { RedisMemoryStore } from "../memory/redis-memory-store";

const ctx = (tenant: number): AdapterCallContext => ({
  correlation: {
    traceId: "redis-memory-test",
    requestId: "redis-memory-test",
    sessionId: "redis-memory-test",
    turnId: "redis-memory-test",
  },
  tenant,
});

const entry = (text: string): MemoryEntry => ({
  id: `redis-${text}-${Date.now()}`,
  role: "user",
  content: text,
  timestamp: Date.now(),
  anchored: false,
});

function createFakeRedis(lists: Map<string, string[]>) {
  const ttlLog: number[] = [];
  const makePipeline = () => {
    const ops: Array<() => void> = [];
    return {
      lpush: (key: string, v: string) => {
        ops.push(() => {
          const cur = lists.get(key) ?? [];
          cur.unshift(v);
          lists.set(key, cur);
        });
        return makePipeline();
      },
      ltrim: (key: string, start: number, end: number) => {
        ops.push(() => {
          const cur = lists.get(key) ?? [];
          lists.set(key, cur.slice(start, end + 1));
        });
        return makePipeline();
      },
      expire: (_key: string, ttl: number) => {
        ttlLog.push(ttl);
        return makePipeline();
      },
      del: (key: string) => {
        ops.push(() => {
          lists.delete(key);
        });
        return makePipeline();
      },
      exec: mock(async () => {
        for (const op of ops) op();
        return [];
      }),
    };
  };

  const fake = {
    status: "ready",
    connect: mock(async () => {}),
    lrange: mock(async (key: string, start: number, end: number) => {
      const cur = lists.get(key) ?? [];
      if (end === -1) return cur.slice(start);
      return cur.slice(start, end + 1);
    }),
    pipeline: () => makePipeline(),
    del: mock(async (key: string) => {
      lists.delete(key);
      return 1;
    }),
    quit: mock(async () => {}),
  };
  return { client: fake as unknown as Redis, ttlLog };
}

describe("RedisMemoryStore (mock redis)", () => {
  it("append：LPUSH + LTRIM + EXPIRE pipeline（顺序写入 list）", async () => {
    const lists = new Map<string, string[]>();
    const { client: redis } = createFakeRedis(lists);
    const store = new RedisMemoryStore({
      redisUrl: "redis://mock",
      tenantId: 9,
      ttlSeconds: 604800,
      redisFactory: () => redis,
    });

    await store.append("sid-a", entry("one"), ctx(9));
    // B2: 键去 tenant —— 只用 sessionId（tenantId:9 不再进键）。
    const key = "agentic:engine:memory:sid-a";
    expect(lists.get(key)?.length).toBe(1);
    const parsed = JSON.parse(lists.get(key)![0]!) as MemoryEntry;
    expect(parsed.content).toBe("one");
  });

  it("read：LRANGE 逆序还原时间线（LPUSH 最新在前）", async () => {
    const lists = new Map<string, string[]>();
    const key = "agentic:engine:memory:s-chrono";
    lists.set(key, [JSON.stringify(entry("second")), JSON.stringify(entry("first"))]);

    const { client: redis } = createFakeRedis(lists);
    const store = new RedisMemoryStore({
      redisUrl: "redis://mock",
      tenantId: 1,
      redisFactory: () => redis,
    });

    const w = await store.load("s-chrono", ctx(1));
    expect(w.entries.map((e) => e.content)).toEqual(["first", "second"]);
  });

  it("TTL：pipeline 含 expire（秒）", async () => {
    const lists = new Map<string, string[]>();
    const { client: redis, ttlLog } = createFakeRedis(lists);

    const store = new RedisMemoryStore({
      redisUrl: "redis://mock",
      ttlSeconds: 12345,
      redisFactory: () => redis,
    });
    await store.append("s-ttl", entry("x"), ctx(1));
    expect(ttlLog).toContain(12345);
  });

  it("clear：DEL Redis key 且清空 L1", async () => {
    const lists = new Map<string, string[]>();
    const key = "agentic:engine:memory:s-del";
    lists.set(key, [JSON.stringify(entry("z"))]);
    const { client: redis } = createFakeRedis(lists);

    const store = new RedisMemoryStore({
      redisUrl: "redis://mock",
      redisFactory: () => redis,
    });
    await store.clear("s-del");
    expect(lists.has(key)).toBe(false);
  });
});
