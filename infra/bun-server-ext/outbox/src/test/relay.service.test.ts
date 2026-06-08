/**
 * OutboxRelayService 业务断言单测（假 mysql + 假 dispatcher）
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { Pool, PoolConnection } from 'mysql2/promise';
import type { OutboxEventRow } from '@cube-ai/contracts';
import { OutboxRelayService, backoffMsAfterFailure } from '../relay.service';
import type { OutboxDispatcherI } from '../dispatcher';
import type { LeaderElection } from '../leader-election';

const fakeLeader = {
  start:  async () => {},
  stop:   async () => {},
  isLeader: () => true,
} as unknown as LeaderElection;

const fakeDispatcher: OutboxDispatcherI = {
  dispatch: async () => {},
};

function makeRow(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
  const now = Date.now();
  const base: OutboxEventRow = {
    id:               '1000000000000000001',
    tenant:           1001,
    deleted:          0,
    createBy:         'system',
    creatorId:        null,
    creatorType:      'SYSTEM',
    createTime:       now,
    updateBy:         'system',
    updaterId:        null,
    updaterType:      'SYSTEM',
    updateTime:       now,
    channel:          'usage_bus',
    eventType:        'usage.job_duration',
    payloadJson:      { x: 1 },
    target:           null,
    status:           'PENDING',
    attempts:         0,
    lastError:        null,
    scheduleTime:     now,
    publishTime:      null,
    nextAttemptTime:  null,
  };
  return { ...base, ...overrides };
}

describe('backoffMsAfterFailure', () => {
  it('1s / 4s / 16s 指数退避首段', () => {
    expect(backoffMsAfterFailure(1)).toBe(1_000);
    expect(backoffMsAfterFailure(2)).toBe(4_000);
    expect(backoffMsAfterFailure(3)).toBe(16_000);
    expect(backoffMsAfterFailure(4)).toBe(64_000);
  });
});

describe('OutboxRelayService.relayOnce', () => {
  let sqlLog: string[];
  let mockConn: PoolConnection;
  let mockPool: Pool;

  beforeEach(() => {
    sqlLog = [];
    const dbRow = {
      id:               BigInt('1000000000000000001'),
      tenant:           1001,
      channel:          'usage_bus',
      event_type:       'usage.job_duration',
      payload_json:     { jobId: '1' },
      target:           null,
      status:           'PENDING',
      attempts:         0,
      last_error:       null,
      schedule_time:    new Date(),
      publish_time:     null,
      next_attempt_time: null,
      deleted:          BigInt(0),
      create_by:        'system',
      creator_id:       null,
      creator_type:     'SYSTEM',
      create_time:      new Date(),
      update_by:        'system',
      updater_id:       null,
      updater_type:     'SYSTEM',
      update_time:      new Date(),
    };

    mockConn = {
      beginTransaction: mock(async () => {}),
      commit:           mock(async () => {}),
      rollback:         mock(async () => {}),
      release:          mock(() => {}),
      query: mock(async (sql: string, params?: unknown[]) => {
        sqlLog.push(sql);
        if (sql.includes('FOR UPDATE SKIP LOCKED')) {
          return [[dbRow], []];
        }
        return [[], []];
      }),
    } as unknown as PoolConnection;

    mockPool = {
      getConnection: mock(async () => mockConn),
    } as unknown as Pool;
  });

  it('非 leader 时不执行 SELECT（假 gate）', async () => {
    const relay = new OutboxRelayService(fakeLeader, fakeDispatcher, {
      mysqlPool:     mockPool,
      isRelayLeader: () => false,
    });
    await relay.start({
      dispatch: mock(async () => {}),
    } as unknown as OutboxDispatcherI);

    await relay.relayOnce();
    expect(sqlLog.some((s) => s.includes('FOR UPDATE SKIP LOCKED'))).toBe(false);
    await relay.stop();
  });

  it('FOR UPDATE SKIP LOCKED + dispatch 调用 + 成功则 UPDATE PUBLISHED', async () => {
    const dispatch = mock(async (_row: OutboxEventRow) => {});
    const relay = new OutboxRelayService(fakeLeader, fakeDispatcher, {
      mysqlPool:     mockPool,
      isRelayLeader: () => true,
    });
    await relay.start({ dispatch } as unknown as OutboxDispatcherI);

    await relay.relayOnce();

    expect(sqlLog.some((s) => s.includes('FOR UPDATE SKIP LOCKED'))).toBe(true);
    expect(dispatch.mock.calls.length).toBe(1);
    expect(sqlLog.some((s) => s.includes("status = 'PUBLISHED'"))).toBe(true);
    await relay.stop();
  });

  it('dispatch 失败则 attempts++ 且仍为 PENDING（未满 10）', async () => {
    const dispatch = mock(async () => {
      throw new Error('downstream unavailable');
    });

    const relay = new OutboxRelayService(fakeLeader, fakeDispatcher, {
      mysqlPool:     mockPool,
      isRelayLeader: () => true,
    });
    await relay.start({ dispatch } as unknown as OutboxDispatcherI);

    await relay.relayOnce();

    const upd = sqlLog.find((s) => s.includes('attempts') && s.includes('next_attempt_time'));
    expect(upd).toBeTruthy();
    await relay.stop();
  });

  it('attempts>=10 时转入 DEAD', async () => {
    const dbRowDead = {
      id:               BigInt('1000000000000000002'),
      tenant:           1001,
      channel:          'usage_bus',
      event_type:       'usage.job_duration',
      payload_json:     {},
      target:           null,
      status:           'PENDING',
      attempts:         9,
      last_error:       null,
      schedule_time:    new Date(),
      publish_time:     null,
      next_attempt_time: null,
      deleted:          BigInt(0),
      create_by:        'system',
      creator_id:       null,
      creator_type:     'SYSTEM',
      create_time:      new Date(),
      update_by:        'system',
      updater_id:       null,
      updater_type:     'SYSTEM',
      update_time:      new Date(),
    };

    const conn = {
      beginTransaction: mock(async () => {}),
      commit:           mock(async () => {}),
      rollback:         mock(async () => {}),
      release:          mock(() => {}),
      query: mock(async (sql: string) => {
        sqlLog.push(sql);
        if (sql.includes('FOR UPDATE SKIP LOCKED')) {
          return [[dbRowDead], []];
        }
        return [[], []];
      }),
    } as unknown as PoolConnection;

    const pool = {
      getConnection: mock(async () => conn),
    } as unknown as Pool;

    const dispatch = mock(async () => {
      throw new Error('fail');
    });

    const relay = new OutboxRelayService(fakeLeader, fakeDispatcher, {
      mysqlPool:     pool,
      isRelayLeader: () => true,
    });
    await relay.start({ dispatch } as unknown as OutboxDispatcherI);

    await relay.relayOnce();

    expect(sqlLog.some((s) => s.includes("status = 'DEAD'"))).toBe(true);
    expect(relay.getRelayMetrics().deadTotal).toBeGreaterThanOrEqual(1);
    await relay.stop();
  });

  it('preserves original relay error when rollback fails on a closed connection', async () => {
    const original = new Error('primary query failed');
    const rollbackError = new Error("Can't add new command when connection is in closed state");
    const conn = {
      beginTransaction: mock(async () => {}),
      commit:           mock(async () => {}),
      rollback:         mock(async () => {
        throw rollbackError;
      }),
      release:          mock(() => {}),
      query:            mock(async () => {
        throw original;
      }),
    } as unknown as PoolConnection;

    const pool = {
      getConnection: mock(async () => conn),
    } as unknown as Pool;

    const relay = new OutboxRelayService(fakeLeader, fakeDispatcher, {
      mysqlPool:     pool,
      isRelayLeader: () => true,
    });
    await relay.start({ dispatch: mock(async () => {}) } as unknown as OutboxDispatcherI);

    await expect(relay.relayOnce()).rejects.toThrow('primary query failed');
    expect((conn.rollback as unknown as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((conn.release as unknown as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    await relay.stop();
  });
});
