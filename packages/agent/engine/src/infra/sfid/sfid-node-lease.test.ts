import { describe, expect, test } from "bun:test";

import { SfidNodeLease, type SfidNodeLeaseRedis } from "./sfid-node-lease";

/**
 * Fix A 1b — Redis 节点租约：每进程在 `agentic:engine:sfid:node-lease:{0..1023}`
 * 上 SET NX EX 抢一个空槽；满槽 fail-closed；释放 DEL；心跳 renew CAS 续租。
 * Fake Redis honor 真实 NX 语义（已占返回 null）以覆盖 skip/满槽/复用。
 */
function fakeLeaseRedis(): SfidNodeLeaseRedis & {
  store: Map<string, string>;
  calls: { set: Array<Record<string, unknown>>; eval: Array<Record<string, unknown>> };
} {
  const store = new Map<string, string>();
  const calls = { set: [] as Array<Record<string, unknown>>, eval: [] as Array<Record<string, unknown>> };
  return {
    store,
    calls,
    async set(key, value, ex, ttl, nx) {
      calls.set.push({ key, value, ex, ttl, nx });
      if (store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async eval(script: string, _numKeys: number, key: string, arg1: string, arg2?: string) {
      calls.eval.push({ script, key, arg1, arg2 });
      const cur = store.get(key);
      const owned = cur !== undefined && cur === arg1;
      if (script.includes("DEL")) {
        if (owned) store.delete(key);
        return owned ? 1 : 0;
      }
      // renew (EXPIRE) branch
      return owned ? 1 : 0;
    },
  };
}

const PREFIX = "agentic:engine:sfid:node-lease:";

describe("SfidNodeLease.acquire", () => {
  test("claims node 0 on a fresh cluster (SET NX EX with the instance fingerprint)", async () => {
    const redis = fakeLeaseRedis();
    const lease = new SfidNodeLease({ redis, ttlSeconds: 60, fingerprint: "fp-A" });
    const handle = await lease.acquire();

    expect(handle.nodeId).toBe(0);
    expect(redis.store.get(`${PREFIX}0`)).toBe("fp-A");
    const firstSet = redis.calls.set[0]!;
    expect(firstSet.key).toBe(`${PREFIX}0`);
    expect(firstSet.value).toBe("fp-A");
    expect(firstSet.ex).toBe("EX");
    expect(firstSet.ttl).toBe(60);
    expect(firstSet.nx).toBe("NX");
  });

  test("skips already-leased slots and takes the first free node", async () => {
    const redis = fakeLeaseRedis();
    redis.store.set(`${PREFIX}0`, "someone-else");
    redis.store.set(`${PREFIX}1`, "someone-else");
    const lease = new SfidNodeLease({ redis, fingerprint: "fp-B" });

    const handle = await lease.acquire();
    expect(handle.nodeId).toBe(2);
  });

  test("two acquisitions on a fresh cluster get different node ids", async () => {
    const redis = fakeLeaseRedis();
    const a = await new SfidNodeLease({ redis, fingerprint: "fp-1" }).acquire();
    const b = await new SfidNodeLease({ redis, fingerprint: "fp-2" }).acquire();
    expect(a.nodeId).not.toBe(b.nodeId);
  });

  test("fail-closed: throws when every node slot is occupied", async () => {
    const redis = fakeLeaseRedis();
    for (let n = 0; n <= 3; n++) redis.store.set(`${PREFIX}${n}`, "occupied");
    const lease = new SfidNodeLease({ redis, maxNode: 3, fingerprint: "fp-C" });

    await expect(lease.acquire()).rejects.toThrow(/slot|occupied|fail-closed/i);
  });
});

describe("SfidNodeLease handle — renew / release (CAS on fingerprint)", () => {
  test("renew() returns true while the slot is still held by this instance", async () => {
    const redis = fakeLeaseRedis();
    const handle = await new SfidNodeLease({ redis, fingerprint: "fp-R" }).acquire();
    expect(await handle.renew()).toBe(true);
  });

  test("release() deletes the slot so it can be re-acquired", async () => {
    const redis = fakeLeaseRedis();
    const lease = new SfidNodeLease({ redis, fingerprint: "fp-D" });
    const handle = await lease.acquire();
    expect(redis.store.has(`${PREFIX}${handle.nodeId}`)).toBe(true);

    await handle.release();
    expect(redis.store.has(`${PREFIX}${handle.nodeId}`)).toBe(false);

    const reAcquired = await new SfidNodeLease({ redis, fingerprint: "fp-E" }).acquire();
    expect(reAcquired.nodeId).toBe(handle.nodeId);
  });

  test("renew() returns false after the slot was released (lease lost)", async () => {
    const redis = fakeLeaseRedis();
    const handle = await new SfidNodeLease({ redis, fingerprint: "fp-F" }).acquire();
    await handle.release();
    expect(await handle.renew()).toBe(false);
  });
});
