import { describe, expect, test } from "bun:test";

import type { SfidNodeLeaseRedis } from "./sfid-node-lease";
import { provisionSfidNode } from "./sfid-node-provisioning";
import { SfidService } from "./sfid.service";

/** 未配置的 SfidService（临时清 env，绕过 preload 注入的 nodeId）。 */
function unconfiguredSfid(): SfidService {
  const prev = process.env.AGENTIC_ENGINE_NODE_ID;
  delete process.env.AGENTIC_ENGINE_NODE_ID;
  try {
    return new SfidService();
  } finally {
    if (prev !== undefined) process.env.AGENTIC_ENGINE_NODE_ID = prev;
  }
}

function fakeLeaseRedis(): SfidNodeLeaseRedis & { store: Map<string, string>; setCalls: number } {
  const store = new Map<string, string>();
  const self = {
    store,
    setCalls: 0,
    async set(key: string, value: string) {
      self.setCalls++;
      if (store.has(key)) return null;
      store.set(key, value);
      return "OK" as const;
    },
    async eval(script: string, _n: number, key: string, arg1: string) {
      const cur = store.get(key);
      const owned = cur !== undefined && cur === arg1;
      if (script.includes("DEL") && owned) store.delete(key);
      return owned ? 1 : 0;
    },
  };
  return self;
}

describe("provisionSfidNode", () => {
  test("explicit env override already configured → skips the lease entirely", async () => {
    const redis = fakeLeaseRedis();
    const sfid = new SfidService(5);

    const handle = await provisionSfidNode({ sfid, redis, heartbeatMs: 0 });

    expect(handle).toBeNull();
    expect(redis.setCalls).toBe(0);
    expect(sfid.parse(sfid.next()).node).toBe(5);
  });

  test("fail-closed: unconfigured + no Redis → refuses to start", async () => {
    const sfid = unconfiguredSfid();
    await expect(provisionSfidNode({ sfid, redis: null, heartbeatMs: 0 })).rejects.toThrow(/fail-closed|refusing to start/i);
    expect(sfid.isConfigured).toBe(false);
  });

  test("unconfigured + Redis → acquires a lease and configures the node", async () => {
    const redis = fakeLeaseRedis();
    const sfid = unconfiguredSfid();

    const handle = await provisionSfidNode({ sfid, redis, heartbeatMs: 0 });

    expect(handle).not.toBeNull();
    expect(sfid.isConfigured).toBe(true);
    expect(sfid.parse(sfid.next()).node).toBe(handle!.nodeId);
    expect(redis.store.has(`agentic:engine:sfid:node-lease:${handle!.nodeId}`)).toBe(true);
  });

  test("registers a shutdown hook that releases the slot", async () => {
    const redis = fakeLeaseRedis();
    const sfid = unconfiguredSfid();
    let shutdown: (() => Promise<void>) | undefined;

    const handle = await provisionSfidNode({
      sfid,
      redis,
      heartbeatMs: 0,
      registerShutdown: (close) => {
        shutdown = close;
      },
    });

    expect(shutdown).toBeDefined();
    const slotKey = `agentic:engine:sfid:node-lease:${handle!.nodeId}`;
    expect(redis.store.has(slotKey)).toBe(true);
    await shutdown!();
    expect(redis.store.has(slotKey)).toBe(false);
  });
});
