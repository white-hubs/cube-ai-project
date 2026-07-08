import type { AdapterCallContext, MemoryEntry } from "@tachu/core";
/**
 * Unit tests — P1-04 Memory adapters
 * ref: docs/technical-design/prompts/phase-1/P1-04-adapters.md §6 unit tests
 * ref: docs/detailed-design/03-core-adapters/memory.md §3 / §5
 *
 * Critical paths covered:
 * CT-M1  InMemoryStore: load() returns empty ContextWindow for unknown sessionId
 * CT-M2  InMemoryStore: append() increments entries and tokenCount
 * CT-M3  InMemoryStore: trim() preserves head and tail correctly
 * CT-M4  InMemoryStore: clear() removes session data (wipe semantics)
 * CT-M5  InMemoryStore: getSize() reflects actual entries/tokens
 * CT-M6  RedisMemoryStore: R18 lazy init — no Redis client in constructor
 * CT-M7  RedisMemoryStore: load() delegates to L1 on cache hit
 */
import { describe, it, expect } from "bun:test";
import type Redis from "ioredis";

import { InMemoryStore } from "../memory/in-memory-store";
import { RedisMemoryStore } from "../memory/redis-memory-store";

/** B2 后键只用 sessionId，tenant 不进键；此处保留 tenant 仅示意 ctx 仍可携带 */
const CTX: AdapterCallContext = {
  correlation: {
    traceId: "memory-unit-test",
    requestId: "memory-unit-test",
    sessionId: "memory-unit-test",
    turnId: "memory-unit-test",
  },
  tenant: 1,
};

/** 无真实 TCP；满足 load/append 对 Redis 的调用 */
function idleRedisStub(): Redis {
  const pipeline = () => {
    const chain = {
      lpush: () => chain,
      ltrim: () => chain,
      expire: () => chain,
      del: () => chain,
      exec: async () => [],
    };
    return chain;
  };
  return {
    status: "ready",
    connect: async () => {},
    lrange: async () => [],
    pipeline,
    del: async () => 1,
    quit: async () => {},
  } as unknown as Redis;
}

const makeEntry = (content: string, role: "user" | "assistant" = "user"): MemoryEntry => ({
  id: `${role}-${content}-${Date.now()}`,
  role,
  content,
  timestamp: Date.now(),
  anchored: false,
});

// ─── InMemoryStore ────────────────────────────────────────────────────────────

describe("InMemoryStore", () => {
  it("CT-M1: load() returns empty ContextWindow for unknown session", async () => {
    const store = new InMemoryStore();
    const window = await store.load("session-unknown", CTX);
    expect(window.entries).toEqual([]);
    expect(window.tokenCount).toBe(0);
    expect(window.limit).toBeGreaterThan(0);
  });

  it("CT-M2: append() adds entry and updates tokenCount", async () => {
    const store = new InMemoryStore();
    const sid = "session-append";
    await store.append(sid, makeEntry("ABCD"), CTX); // 4 chars ≈ 1 token
    const window = await store.load(sid, CTX);
    expect(window.entries).toHaveLength(1);
    expect(window.entries[0]!.content).toBe("ABCD");
    expect(window.tokenCount).toBeGreaterThan(0);
  });

  it("CT-M2b: multiple appends accumulate entries in order", async () => {
    const store = new InMemoryStore();
    const sid = "session-multi";
    await store.append(sid, makeEntry("first"), CTX);
    await store.append(sid, makeEntry("second"), CTX);
    await store.append(sid, makeEntry("third"), CTX);
    const window = await store.load(sid, CTX);
    expect(window.entries).toHaveLength(3);
    expect(window.entries[0]!.content).toBe("first");
    expect(window.entries[2]!.content).toBe("third");
  });

  it("CT-M3: trim() with keepTail=1 preserves only last entry", async () => {
    const store = new InMemoryStore();
    const sid = "session-trim";
    await store.append(sid, makeEntry("first"), CTX);
    await store.append(sid, makeEntry("second"), CTX);
    await store.append(sid, makeEntry("third"), CTX);
    await store.trim(sid, { keepHead: 0, keepTail: 1 });
    const window = await store.load(sid, CTX);
    expect(window.entries).toHaveLength(1);
    expect(window.entries[0]!.content).toBe("third");
  });

  it("CT-M3b: trim() with keepHead=1 preserves only first entry", async () => {
    const store = new InMemoryStore();
    const sid = "session-trim-head";
    await store.append(sid, makeEntry("first"), CTX);
    await store.append(sid, makeEntry("second"), CTX);
    await store.trim(sid, { keepHead: 1, keepTail: 0 });
    const window = await store.load(sid, CTX);
    expect(window.entries).toHaveLength(1);
    expect(window.entries[0]!.content).toBe("first");
  });

  it("CT-M4: clear() removes all session data (wipe semantics)", async () => {
    const store = new InMemoryStore();
    const sid = "session-clear";
    await store.append(sid, makeEntry("hello"), CTX);
    expect(store.getWindowCountForTest()).toBe(1);
    await store.clear(sid);
    expect(store.getWindowCountForTest()).toBe(0);
    const window = await store.load(sid, CTX);
    expect(window.entries).toEqual([]);
  });

  it("CT-M5: getSize() reflects correct entries and token count", async () => {
    const store = new InMemoryStore();
    const sid = "session-size";
    await store.append(sid, makeEntry("ABCD"), CTX); // ≈1 token
    await store.append(sid, makeEntry("EFGH"), CTX); // ≈1 token
    const { entries, tokens } = await store.getSize(sid);
    expect(entries).toBe(2);
    expect(tokens).toBeGreaterThan(0);
  });

  it("CT-M5b: recall() returns empty array (skeleton placeholder)", async () => {
    const store = new InMemoryStore();
    const result = await store.recall("sid", "query");
    expect(result).toEqual([]);
  });
});

// ─── RedisMemoryStore ─────────────────────────────────────────────────────────

describe("RedisMemoryStore", () => {
  it("CT-M6: R18 lazy init — no Redis client in constructor", () => {
    const store = new RedisMemoryStore({ redisUrl: "redis://localhost:6379" });
    expect(store.getRedisClientForTest()).toBeUndefined();
  });

  it("CT-M7: load() delegates to L1 when L1 has data", async () => {
    const store = new RedisMemoryStore({ redisUrl: "redis://localhost:6379" });
    const sid = "session-l1-hit";
    // Append via L1 (no Redis connection needed)
    const l1 = (store as unknown as { l1: InMemoryStore }).l1;
    await l1.append(sid, makeEntry("cached"), CTX);
    const window = await store.load(sid, CTX);
    expect(window.entries).toHaveLength(1);
    expect(window.entries[0]!.content).toBe("cached");
    // Still no Redis client created
    expect(store.getRedisClientForTest()).toBeUndefined();
  });

  it("CT-M7b: load() 对空 session 走 L2 LRANGE → 空窗口", async () => {
    const redis = idleRedisStub();
    const store = new RedisMemoryStore({
      redisUrl: "redis://mock",
      redisFactory: () => redis,
    });
    const window = await store.load("unknown-session", CTX);
    expect(window.entries).toEqual([]);
  });

  it("CT-M7c: append() 更新 L1 并建立 Redis client（LPUSH pipeline）", async () => {
    const redis = idleRedisStub();
    const store = new RedisMemoryStore({
      redisUrl: "redis://mock",
      redisFactory: () => redis,
    });
    await store.append("sid-append", makeEntry("data"), CTX);
    const window = await store.load("sid-append", CTX);
    expect(window.entries).toHaveLength(1);
    expect(store.getRedisClientForTest()).toBeDefined();
  });
});
