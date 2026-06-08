/**
 * 端到端 Outbox（已由 Testcontainers 取代）。
 *
 * 请改用：`outbox-flow.testcontainers.test.ts` + `USE_TESTCONTAINERS=1`
 * ref: docs/technical-design/prompts/phase-3/P3-07-outbox-writer-relay.md §6
 */
import { describe, test, expect } from 'bun:test';
import { createPool } from 'mysql2/promise';
import {
  OutboxWriterImpl,
  OutboxRelayService,
  type TransactionContext,
} from '../../src/index';
import type { AppendOutboxInput } from '@cube-ai/contracts';

const TEST_PORT = Number(process.env.TEST_PORT ?? 4007);

describe.skip(`outbox flow integration (TEST_PORT=${TEST_PORT})`, () => {
  test('INSERT outbox PENDING → relayOnce → dispatcher → status PUBLISHED', async () => {
    const pool = createPool({
      host:     process.env.AGENTIC_ENGINE_MYSQL_HOST ?? '127.0.0.1',
      port:     Number(process.env.AGENTIC_ENGINE_MYSQL_PORT ?? 3306),
      user:     process.env.AGENTIC_ENGINE_MYSQL_USER ?? 'root',
      password: process.env.AGENTIC_ENGINE_MYSQL_PASSWORD ?? '',
      database: process.env.AGENTIC_ENGINE_MYSQL_DB ?? 'agentic',
    });

    const writer = new OutboxWriterImpl({
      nextSfid: () => '1234567890123456789',
    });

    const rowInput: AppendOutboxInput = {
      tenant:       1001,
      channel:      'usage_bus',
      eventType:    'usage.job_duration',
      payloadJson:  { schema: 'usage.job_duration.v1', jobId: '1', tenant: 1001 },
      target:       null,
      scheduleTime: Date.now(),
    };

    const conn = await pool.getConnection();
    let eventId = '';
    try {
      await conn.beginTransaction();

      const tx: TransactionContext = {
        _brand:          'TransactionContext',
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
    const relay = new OutboxRelayService({
      mysqlPool:     pool,
      batchSize:     10,
      pollIntervalMs: 200,
      isRelayLeader: () => true,
    });

    await relay.start({
      dispatch: async (ev) => {
        dispatched.push(ev.id);
      },
    });

    await relay.relayOnce();
    await relay.stop();

    const [rows] = await pool.query<{ status: string }[]>(
      `SELECT status FROM outbox_events WHERE id = ?`,
      [eventId],
    );
    expect(rows[0]?.status).toBe('PUBLISHED');
    expect(dispatched).toContain(eventId);

    await pool.end();
  });
});
