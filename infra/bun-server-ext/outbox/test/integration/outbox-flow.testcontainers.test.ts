/**
 * Outbox 写入 + Relay 派发 — MySQL Testcontainers（含 outbox_events DDL）。
 *
 *   USE_TESTCONTAINERS=1 bun test …/outbox-flow.testcontainers.test.ts
 *   bun run test:containers
 */
import { afterAll, beforeAll, describe, expect, test, setDefaultTimeout } from 'bun:test';
import { createPool } from 'mysql2/promise';
import {
  applyMinimalMysqlSchema,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlOnly,
  stopTrackedTestcontainersIfAny,
  type MysqlOnlyStack,
} from '@cube-ai/test-infra';
import type { AppendOutboxInput, OutboxEventRow } from '@cube-ai/contracts';
import type { OutboxDispatcherI } from '../../src/dispatcher';
import type { LeaderElection } from '../../src/leader-election';
import {
  OutboxWriterImpl,
  OutboxRelayService,
  type TransactionContext,
} from '../../src/index';

const fakeLeader = {
  start: async () => {},
  stop: async () => {},
  isLeader: () => true,
} as unknown as LeaderElection;

const noopDispatcher: OutboxDispatcherI = { dispatch: async () => {} };

const run = await resolveShouldRunTestcontainers();
const stackHolder: { current: MysqlOnlyStack | null } = { current: null };
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

(run ? describe : describe.skip)('outbox flow [testcontainers]', () => {
  beforeAll(async () => {
    const s = await startMysqlOnly();
    try {
      await applyMinimalMysqlSchema(s.mysqlUrl);
      stackHolder.current = s;
    } catch (e) {
      await s.stop();
      throw e;
    }
  }, HOOK_MS);

  afterAll(async () => {
    if (stackHolder.current) {
      await stackHolder.current.stop().catch(() => {});
      stackHolder.current = null;
    }
    await stopTrackedTestcontainersIfAny();
  });

  test('INSERT outbox PENDING → relayOnce → dispatcher → status PUBLISHED', async () => {
    const s = stackHolder.current!;
    const pool = createPool({
      uri: s.mysqlUrl,
      connectionLimit: 4,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });

    const writer = new OutboxWriterImpl({
      nextSfid: () => '1234567890123456789',
    });

    const rowInput: AppendOutboxInput = {
      tenant: 1001,
      channel: 'usage_bus',
      eventType: 'usage.job_duration',
      payloadJson: {
        schema: 'usage.job_duration.v1',
        jobId: '1',
        tenant: 1001,
      },
      target: null,
      /** 避免容器 MySQL NOW(3) 与宿主机 epoch 边界导致「尚未到期」选不中 */
      scheduleTime: Date.now() - 3_600_000,
    };

    const conn = await pool.getConnection();
    let eventId = '';
    try {
      await conn.beginTransaction();

      const tx: TransactionContext = {
        _brand: 'TransactionContext',
        mysqlConnection: conn,
      };

      await writer.append(tx, rowInput);

      const [[pick]] = await conn.query<{ id: string }[]>(
        `SELECT CAST(id AS CHAR) AS id FROM outbox_events WHERE tenant=? ORDER BY create_time DESC LIMIT 1`,
        [1001],
      );
      eventId = pick?.id ?? '';
      expect(eventId).toMatch(/^\d{19}$/);

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    const dispatched: string[] = [];
    const relay = new OutboxRelayService(fakeLeader, noopDispatcher, {
      mysqlPool: pool,
      batchSize: 10,
      pollIntervalMs: 200,
      isRelayLeader: () => true,
    });

    await relay.start({
      dispatch: async (ev: OutboxEventRow) => {
        dispatched.push(ev.id);
      },
    } as unknown as OutboxDispatcherI);

    await relay.relayOnce();
    await relay.stop();

    expect(dispatched).toContain(eventId);

    const [rows] = await pool.query<{ status: string }[]>(
      `SELECT status FROM outbox_events WHERE id = ?`,
      [eventId],
    );
    expect(rows[0]?.status).toBe('PUBLISHED');

    await pool.end();
  });
});
