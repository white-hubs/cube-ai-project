import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import Redis from "ioredis";

import {
  type RedisOnlyStack,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startRedisOnly,
  stopTrackedTestcontainersIfAny,
} from "@cube-ai/test-infra";

import { LeaderElection, createLeaderElectionRedis } from "../../src/leader-election";

/**
 * Leader election — Redis Testcontainers。
 *
 *   USE_TESTCONTAINERS=1 bun test packages/bun-server-ext-outbox/test/integration/leader-election.testcontainers.test.ts
 *   bun run test:containers
 */

const run = await resolveShouldRunTestcontainers();
const stackHolder: { current: RedisOnlyStack | null } = { current: null };
const HOOK_MS = 1_800_000;

if (run) {
  setDefaultTimeout(3_600_000);
  registerProcessShutdown(
    async () => {
      await stopTrackedTestcontainersIfAny();
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
    },
    { exitProcessAfterSignal: true },
  );
}

(run ? describe : describe.skip)("leader-election [testcontainers]", () => {
  beforeAll(async () => {
    const s = await startRedisOnly();
    stackHolder.current = s;
  }, HOOK_MS);

  afterAll(async () => {
    if (stackHolder.current) {
      await stackHolder.current.stop().catch(() => {});
      stackHolder.current = null;
    }
    await stopTrackedTestcontainersIfAny();
  });

  it("双实例竞争：同一时刻仅一个 leader（SET NX + TTL）", async () => {
    const s = stackHolder.current!;
    const redis = new Redis(s.redisUrl, { maxRetriesPerRequest: null });
    const key = `agentic:engine:outbox:leader:test:${Date.now()}`;

    const leA = new LeaderElection({
      leaderKey: key,
      nodeId: "a",
      nonce: "1111111111111111111",
      redis: createLeaderElectionRedis(redis),
    });
    const leB = new LeaderElection({
      leaderKey: key,
      nodeId: "b",
      nonce: "2222222222222222222",
      redis: createLeaderElectionRedis(redis),
    });

    const aOk = await leA.tryAcquire();
    const bOk = await leB.tryAcquire();
    expect(aOk && !bOk).toBe(true);

    await leA.release();
    await redis.quit();
  });
});
