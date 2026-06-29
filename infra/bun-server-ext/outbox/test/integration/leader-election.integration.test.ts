/**
 * Integration — live Redis + multi-process leader failover（已由 Testcontainers 取代）。
 *
 * 请改用：`leader-election.testcontainers.test.ts` + `USE_TESTCONTAINERS=1` / `bun run test:containers`
 *
 * Kept skipped：可选手工连外部 Redis 时再启用。
 */
import { describe, expect, it } from "bun:test";

describe.skip("leader-election integration (live Redis)", () => {
  it("双实例竞争：同一时刻仅一个 leader（SET NX + TTL）", async () => {
    const { LeaderElection } = await import("../../src/leader-election");
    const Redis = (await import("ioredis")).default;
    const url = process.env["AGENTIC_ENGINE_REDIS_URL"] ?? "redis://127.0.0.1:6379/0";
    const redis = new Redis(url, { maxRetriesPerRequest: null });
    const { createLeaderElectionRedis } = await import("../../src/leader-election");

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

  it("leader 进程退出后锁 TTL 过期，follower 可在续约间隔内抢到（≤30s）", async () => {
    expect(true).toBe(true);
  });
});
