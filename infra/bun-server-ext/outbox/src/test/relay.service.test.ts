import { beforeEach, describe, expect, it, mock } from "bun:test";
import { type Pool, type PoolConnection } from "mysql2/promise";

import { type OutboxDispatcherI } from "../dispatcher";
import { type LeaderElection } from "../leader-election";
/**
 * OutboxRelayService 业务断言单测（假 mysql + 假 dispatcher）
 */
import { OutboxRelayService, backoffMsAfterFailure } from "../relay.service";
import { type OutboxEventRow } from "../types";

const fakeLeader = {
  isLeader: () => true,
  start: async () => {},
  stop: async () => {},
} as unknown as LeaderElection;

const fakeDispatcher: OutboxDispatcherI = {
  dispatch: async () => {},
};

describe("backoffMsAfterFailure", () => {
  it("1s / 4s / 16s 指数退避首段", () => {
    expect(backoffMsAfterFailure(1)).toBe(1_000);
    expect(backoffMsAfterFailure(2)).toBe(4_000);
    expect(backoffMsAfterFailure(3)).toBe(16_000);
    expect(backoffMsAfterFailure(4)).toBe(64_000);
  });
});

describe("OutboxRelayService.relayOnce", () => {
  let sqlLog: string[];
  let mockConn: PoolConnection;
  let mockPool: Pool;

  beforeEach(() => {
    sqlLog = [];
    const dbRow = {
      attempts: 0,
      channel: "usage_bus",
      create_by: "system",
      create_time: new Date(),
      creator_id: null,
      creator_type: "SYSTEM",
      deleted: 0n,
      event_type: "usage.job_duration",
      id: 1000000000000000001n,
      last_error: null,
      next_attempt_time: null,
      payload_json: { jobId: "1" },
      publish_time: null,
      schedule_time: new Date(),
      status: "PENDING",
      target: null,
      tenant: 1001,
      update_by: "system",
      update_time: new Date(),
      updater_id: null,
      updater_type: "SYSTEM",
    };

    mockConn = {
      beginTransaction: mock(async () => {}),
      commit: mock(async () => {}),
      query: mock(async (sql: string) => {
        sqlLog.push(sql);
        if (sql.includes("FOR UPDATE SKIP LOCKED")) {
          return [[dbRow], []];
        }
        return [[], []];
      }),
      release: mock(() => {}),
      rollback: mock(async () => {}),
    } as unknown as PoolConnection;

    mockPool = {
      getConnection: mock(async () => mockConn),
    } as unknown as Pool;
  });

  it("非 leader 时不执行 SELECT（假 gate）", async () => {
    const relay = new OutboxRelayService(fakeLeader, fakeDispatcher, {
      isRelayLeader: () => false,
      mysqlPool: mockPool,
    });
    await relay.start({
      dispatch: mock(async () => {}),
    } as unknown as OutboxDispatcherI);

    await relay.relayOnce();
    expect(sqlLog.some((s) => s.includes("FOR UPDATE SKIP LOCKED"))).toBe(false);
    await relay.stop();
  });

  it("FOR UPDATE SKIP LOCKED + dispatch 调用 + 成功则 UPDATE PUBLISHED", async () => {
    const dispatch = mock(async (_row: OutboxEventRow) => {});
    const relay = new OutboxRelayService(fakeLeader, fakeDispatcher, {
      isRelayLeader: () => true,
      mysqlPool: mockPool,
    });
    await relay.start({ dispatch } as unknown as OutboxDispatcherI);

    await relay.relayOnce();

    expect(sqlLog.some((s) => s.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);
    expect(dispatch.mock.calls.length).toBe(1);
    expect(sqlLog.some((s) => s.includes("status = 'PUBLISHED'"))).toBe(true);
    await relay.stop();
  });

  it("dispatch 失败则 attempts++ 且仍为 PENDING（未满 10）", async () => {
    const dispatch = mock(async () => {
      throw new Error("downstream unavailable");
    });

    const relay = new OutboxRelayService(fakeLeader, fakeDispatcher, {
      isRelayLeader: () => true,
      mysqlPool: mockPool,
    });
    await relay.start({ dispatch } as unknown as OutboxDispatcherI);

    await relay.relayOnce();

    const upd = sqlLog.find((s) => s.includes("attempts") && s.includes("next_attempt_time"));
    expect(upd).toBeTruthy();
    await relay.stop();
  });

  it("attempts>=10 时转入 DEAD", async () => {
    const dbRowDead = {
      attempts: 9,
      channel: "usage_bus",
      create_by: "system",
      create_time: new Date(),
      creator_id: null,
      creator_type: "SYSTEM",
      deleted: 0n,
      event_type: "usage.job_duration",
      id: 1000000000000000002n,
      last_error: null,
      next_attempt_time: null,
      payload_json: {},
      publish_time: null,
      schedule_time: new Date(),
      status: "PENDING",
      target: null,
      tenant: 1001,
      update_by: "system",
      update_time: new Date(),
      updater_id: null,
      updater_type: "SYSTEM",
    };

    const conn = {
      beginTransaction: mock(async () => {}),
      commit: mock(async () => {}),
      query: mock(async (sql: string) => {
        sqlLog.push(sql);
        if (sql.includes("FOR UPDATE SKIP LOCKED")) {
          return [[dbRowDead], []];
        }
        return [[], []];
      }),
      release: mock(() => {}),
      rollback: mock(async () => {}),
    } as unknown as PoolConnection;

    const pool = {
      getConnection: mock(async () => conn),
    } as unknown as Pool;

    const dispatch = mock(async () => {
      throw new Error("fail");
    });

    const relay = new OutboxRelayService(fakeLeader, fakeDispatcher, {
      isRelayLeader: () => true,
      mysqlPool: pool,
    });
    await relay.start({ dispatch } as unknown as OutboxDispatcherI);

    await relay.relayOnce();

    expect(sqlLog.some((s) => s.includes("status = 'DEAD'"))).toBe(true);
    expect(relay.getRelayMetrics().deadTotal).toBeGreaterThanOrEqual(1);
    await relay.stop();
  });

  it("preserves original relay error when rollback fails on a closed connection", async () => {
    const original = new Error("primary query failed");
    const rollbackError = new Error("Can't add new command when connection is in closed state");
    const conn = {
      beginTransaction: mock(async () => {}),
      commit: mock(async () => {}),
      query: mock(async () => {
        throw original;
      }),
      release: mock(() => {}),
      rollback: mock(async () => {
        throw rollbackError;
      }),
    } as unknown as PoolConnection;

    const pool = {
      getConnection: mock(async () => conn),
    } as unknown as Pool;

    const relay = new OutboxRelayService(fakeLeader, fakeDispatcher, {
      isRelayLeader: () => true,
      mysqlPool: pool,
    });
    await relay.start({ dispatch: mock(async () => {}) } as unknown as OutboxDispatcherI);

    await expect(relay.relayOnce()).rejects.toThrow("primary query failed");
    expect((conn.rollback as unknown as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((conn.release as unknown as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    await relay.stop();
  });
});
