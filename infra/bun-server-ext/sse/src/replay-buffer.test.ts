import { beforeEach, describe, expect, test } from "bun:test";

import { InMemoryReplayBufferStore, RedisReplayBufferStore, replayRedisKey } from "./replay-buffer";
import { type ReplayBufferEntry } from "./types";

/**
 * Unit tests — replay-buffer (P3-06)
 * ref: concurrency-and-replay.md §3.2-§3.4
 */

const SESSION_ID = "281474976710656";
const TURN_ID = "281474976710657";
const OTHER_TURN_ID = "281474976710658";
const SCOPE = { sessionId: SESSION_ID, tenant: 1 };

function makeEntry(seq: number, turnId: string = TURN_ID): ReplayBufferEntry {
  return {
    event: "message.delta",
    eventId: `${turnId}:${String(seq).padStart(6, "0")}`,
    payload: { chunk: `chunk-${seq}`, schema: "message-delta-v1" },
    schema: "message-delta-v1",
    time: Date.now() + seq,
  };
}

describe("InMemoryReplayBufferStore — append and since", () => {
  let store: InMemoryReplayBufferStore;

  beforeEach(() => {
    store = new InMemoryReplayBufferStore();
  });

  test("since(null) returns all entries", async () => {
    await store.append(SCOPE, makeEntry(1));
    await store.append(SCOPE, makeEntry(2));
    await store.append(SCOPE, makeEntry(3));

    const result = await store.since(SCOPE, null);
    expect(result).toHaveLength(3);
  });

  test("since(lastEventId) returns entries AFTER that eventId", async () => {
    const e1 = makeEntry(1);
    const e2 = makeEntry(2);
    const e3 = makeEntry(3);
    await store.append(SCOPE, e1);
    await store.append(SCOPE, e2);
    await store.append(SCOPE, e3);

    const result = await store.since(SCOPE, e1.eventId);
    expect(result).toHaveLength(2);
    expect(result[0]!.eventId).toBe(e2.eventId);
    expect(result[1]!.eventId).toBe(e3.eventId);
  });

  test("since(lastEventId) on unknown id returns all (buffer may be trimmed)", async () => {
    await store.append(SCOPE, makeEntry(5));
    await store.append(SCOPE, makeEntry(6));

    const result = await store.since(SCOPE, `${TURN_ID}:000001`);
    expect(result).toHaveLength(2);
  });

  test("since for unknown session scope returns []", async () => {
    const result = await store.since({ sessionId: "nonexistent", tenant: 99 }, null);
    expect(result).toHaveLength(0);
  });

  test("returned entries are ordered ascending", async () => {
    for (let i = 1; i <= 5; i++) {
      await store.append(SCOPE, makeEntry(i));
    }
    const result = await store.since(SCOPE, null);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.eventId > result[i - 1]!.eventId).toBe(true);
    }
  });

  test("since(scope, null, turnId) filters by eventId prefix (per-turn SSE)", async () => {
    await store.append(SCOPE, makeEntry(1, TURN_ID));
    await store.append(SCOPE, makeEntry(2, OTHER_TURN_ID));
    await store.append(SCOPE, makeEntry(3, TURN_ID));
    await store.append(SCOPE, makeEntry(4, OTHER_TURN_ID));

    const onlyT1 = await store.since(SCOPE, null, TURN_ID);
    expect(onlyT1.map((e) => e.eventId)).toEqual([`${TURN_ID}:000001`, `${TURN_ID}:000003`]);
    const onlyT2 = await store.since(SCOPE, null, OTHER_TURN_ID);
    expect(onlyT2.map((e) => e.eventId)).toEqual([`${OTHER_TURN_ID}:000002`, `${OTHER_TURN_ID}:000004`]);
  });

  test("since(scope, lastEventId, turnId) combines Last-Event-ID resume + turn filter", async () => {
    const t1a = makeEntry(1, TURN_ID);
    const t2a = makeEntry(2, OTHER_TURN_ID);
    const t1b = makeEntry(3, TURN_ID);
    const t2b = makeEntry(4, OTHER_TURN_ID);
    for (const e of [t1a, t2a, t1b, t2b]) {
      await store.append(SCOPE, e);
    }

    // 续传 from t1a 之后 + 仅本 turn → 只剩 t1b
    const result = await store.since(SCOPE, t1a.eventId, TURN_ID);
    expect(result.map((e) => e.eventId)).toEqual([t1b.eventId]);
  });

  test("since with empty turnId behaves as no filter", async () => {
    await store.append(SCOPE, makeEntry(1));
    await store.append(SCOPE, makeEntry(2, OTHER_TURN_ID));
    const result = await store.since(SCOPE, null, "");
    expect(result).toHaveLength(2);
  });

  test("default capacity can be overridden by AGENTIC_SSE_REPLAY_CAPACITY", async () => {
    const prev = process.env.AGENTIC_SSE_REPLAY_CAPACITY;
    try {
      process.env.AGENTIC_SSE_REPLAY_CAPACITY = "2";
      const capped = new InMemoryReplayBufferStore();
      await capped.append(SCOPE, makeEntry(1));
      await capped.append(SCOPE, makeEntry(2));
      await capped.append(SCOPE, makeEntry(3));
      const result = await capped.since(SCOPE, null);
      expect(result.map((e) => e.eventId)).toEqual([`${TURN_ID}:000002`, `${TURN_ID}:000003`]);
    } finally {
      if (prev === undefined) {
        delete process.env.AGENTIC_SSE_REPLAY_CAPACITY;
      } else {
        process.env.AGENTIC_SSE_REPLAY_CAPACITY = prev;
      }
    }
  });
});

describe("RedisReplayBufferStore — fake redis", () => {
  test("expireAfterSessionClose calls EXPIRE 86400", async () => {
    const expireCalls: { key: string; ttl: number }[] = [];
    const redis = {
      del: async () => 1,
      expire: async (key: string, ttl: number) => {
        expireCalls.push({ key, ttl });
        return 1;
      },
      lrange: async () => [] as string[],
      pipeline() {
        const cmds: (() => Promise<unknown>)[] = [];
        const pipe = {
          lpush(_k: string, _v: string) {
            cmds.push(async () => {});
            return pipe;
          },
          ltrim(_k: string, _s: number, _e: number) {
            cmds.push(async () => {});
            return pipe;
          },
          exec: async () => {
            for (const c of cmds) {
              await c();
            }
          },
        };
        return pipe;
      },
    };
    const store = new RedisReplayBufferStore(redis as never);
    await store.expireAfterSessionClose(SCOPE);
    expect(expireCalls).toEqual([{ key: replayRedisKey(SCOPE), ttl: 86_400 }]);
  });
});
