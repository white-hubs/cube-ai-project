import { describe, expect, it, mock } from "bun:test";

/**
 * LeaderElection — business assertions (P3-08).
 */
import {
  DEFAULT_LEADER_KEY,
  DEFAULT_LEADER_TTL_MS,
  DEFAULT_RENEW_INTERVAL_MS,
  LeaderElection,
  type LeaderElectionRedis,
} from "../leader-election";

function fakeOk(): LeaderElectionRedis {
  return {
    async releaseIfHeld() {},
    async renewIfHeld() {
      return true;
    },
    async setNxPx() {
      return true;
    },
  };
}

describe("LeaderElection defaults", () => {
  it("DEFAULT_LEADER_KEY matches P3-08", () => {
    expect(DEFAULT_LEADER_KEY).toBe("agentic:engine:outbox:leader");
  });

  it("TTL 30s / renew 10s", () => {
    expect(DEFAULT_LEADER_TTL_MS).toBe(30_000);
    expect(DEFAULT_RENEW_INTERVAL_MS).toBe(10_000);
  });
});

describe("LeaderElection.tryAcquire", () => {
  it("acquire 成功时 isLeader 为 true", async () => {
    const le = new LeaderElection({
      nodeId: "node-a",
      nonce: "1234567890123456789",
      redis: fakeOk(),
    });
    const ok = await le.tryAcquire();
    expect(ok).toBe(true);
    expect(le.isLeader).toBe(true);
    expect(le.lockToken).toBe("node-a:1234567890123456789");
  });

  it("acquire 失败时 isLeader 为 false", async () => {
    const redis: LeaderElectionRedis = {
      async releaseIfHeld() {},
      async renewIfHeld() {
        return false;
      },
      async setNxPx() {
        return false;
      },
    };
    const le = new LeaderElection({ nodeId: "n", nonce: "9876543210987654321", redis });
    expect(await le.tryAcquire()).toBe(false);
    expect(le.isLeader).toBe(false);
  });
});

describe("LeaderElection.renewLease", () => {
  it("续约成功时返回 true", async () => {
    const renew = true;
    const redis: LeaderElectionRedis = {
      async releaseIfHeld() {},
      async renewIfHeld() {
        return renew;
      },
      async setNxPx() {
        return true;
      },
    };
    const le = new LeaderElection({ nodeId: "n", nonce: "1111111111111111111", redis });
    await le.tryAcquire();
    expect(await le.renewLease()).toBe(true);
  });

  it("续约失败时 isLeader 变为 false", async () => {
    const redis: LeaderElectionRedis = {
      async releaseIfHeld() {},
      async renewIfHeld() {
        return false;
      },
      async setNxPx() {
        return true;
      },
    };
    const le = new LeaderElection({ nodeId: "n", nonce: "2222222222222222222", redis });
    await le.tryAcquire();
    expect(await le.renewLease()).toBe(false);
    expect(le.isLeader).toBe(false);
  });
});

describe("LeaderElection.start — leadership callbacks", () => {
  it("成为 leader 时触发 onBecomeLeader", async () => {
    const onBecomeLeader = mock(() => {});
    const le = new LeaderElection({
      followerProbeIntervalMs: 100,
      nodeId: "lead",
      nonce: "3333333333333333333",
      redis: fakeOk(),
    });
    await le.start({ onBecomeLeader });
    expect(le.isLeader).toBe(true);
    expect(onBecomeLeader).toHaveBeenCalled();
    await le.stop();
  });

  it("stop 清理续约定时器且不抛错", async () => {
    const redis: LeaderElectionRedis = {
      async releaseIfHeld() {},
      async renewIfHeld() {
        return true;
      },
      async setNxPx() {
        return true;
      },
    };
    const le = new LeaderElection({
      nodeId: "s",
      nonce: "4444444444444444444",
      redis,
      renewIntervalMs: 50,
    });
    await le.tryAcquire();
    le.startRenewTimer();
    await le.stop();
    expect(le.isLeader).toBe(false);
  });
});
