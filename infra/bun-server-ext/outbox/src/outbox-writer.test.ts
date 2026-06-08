import { describe, test, expect, mock } from 'bun:test';
import { OutboxWriterImpl, type TransactionContext } from './outbox-writer';
import type { PoolConnection } from 'mysql2/promise';
import type { AppendOutboxInput } from '@cube-ai/contracts';

const VALID_INPUT: AppendOutboxInput = {
  tenant: 1001,
  channel: 'usage_bus',
  eventType: 'usage.job_duration',
  payloadJson: {
    schema: 'usage.job_duration.v1',
    tenant: 1001,
    jobId: '1820345678900000077',
    toolRef: 'builtin:platform.flow.invoke',
    toolName: 'platform.flow.invoke',
    totalDurationMs: 186700,
    waitDurationMs: 1200,
    execDurationMs: 185500,
    attempts: 1,
    finalStatus: 'COMPLETED',
    occurredTime: Date.now(),
  },
  target:       null,
  scheduleTime: Date.now(),
};

function mockConn(queryImpl: (sql: string, p: unknown[]) => Promise<unknown>): PoolConnection {
  return { query: mock(queryImpl) } as unknown as PoolConnection;
}

describe('OutboxWriterImpl.append — Phase 3 mysql2 INSERT', () => {
  test('execute INSERT with SFID id 位、audit 字段、status=PENDING', async () => {
    let sqlCaptured = '';
    let params: unknown[] = [];

    const conn = mockConn(async (sql, p) => {
      sqlCaptured = sql;
      params = p;
      return [[], []];
    });

    const sfid = '1234567890123456789';
    const writer = new OutboxWriterImpl({ nextSfid: () => sfid });

    await writer.append({ _brand: 'TransactionContext', mysqlConnection: conn }, VALID_INPUT);

    expect(sqlCaptured).toContain('INSERT INTO outbox_events');
    expect(sqlCaptured).toContain("'PENDING'");
    expect(params[0]).toBe(sfid);
    expect(params[1]).toBe(1001);
    expect(params[5]).toBe(null);
    expect(params[6]).toBeInstanceOf(Date);
  });

  test('SFID id 为正则 19 位十进制（ADR-0014）', async () => {
    const conn = mockConn(async () => [[], []]);

    const writer = new OutboxWriterImpl({
      nextSfid: () => '1234567890123456789',
    });

    await writer.append({ _brand: 'TransactionContext', mysqlConnection: conn }, VALID_INPUT);

    const queryMock = conn.query as ReturnType<typeof mock>;
    const p = queryMock.mock.calls[0]?.[1] as unknown[];
    expect(p[0]).toMatch(/^\d{19}$/);
  });

  test('audit 默认值 createBy/updateBy 为 system、creatorType/updaterType 为 SYSTEM', async () => {
    const conn = mockConn(async () => [[], []]);

    const writer = new OutboxWriterImpl({
      nextSfid: () => '1234567890123456789',
    });

    await writer.append({ _brand: 'TransactionContext', mysqlConnection: conn }, VALID_INPUT);

    const queryMock = conn.query as ReturnType<typeof mock>;
    const p = queryMock.mock.calls[0]?.[1] as unknown[];
    expect(p[8]).toBe('system');
    expect(p[10]).toBe('SYSTEM');
    expect(p[12]).toBe('system');
    expect(p[14]).toBe('SYSTEM');
  });

  test('appendInTx 等价于 append（不开新事务语义由调用方保证）', async () => {
    const conn = mockConn(async () => [[], []]);
    const writer = new OutboxWriterImpl({
      nextSfid: () => '1234567890123456789',
    });

    await writer.appendInTx(conn, VALID_INPUT);

    const queryMock = conn.query as ReturnType<typeof mock>;
    expect(queryMock.mock.calls.length).toBe(1);
  });

  test('reject invalid channel（Zod）', async () => {
    const conn = mockConn(async () => [[], []]);
    const writer = new OutboxWriterImpl({
      nextSfid: () => '1234567890123456789',
    });

    const bad = {
      ...VALID_INPUT,
      channel: 'bad_channel' as AppendOutboxInput['channel'],
    };

    await expect(
      writer.append({ _brand: 'TransactionContext', mysqlConnection: conn }, bad),
    ).rejects.toThrow();
    expect((conn.query as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  test('reject TransactionContext without mysqlConnection when no pool', async () => {
    const writer = new OutboxWriterImpl({
      nextSfid: () => '1234567890123456789',
    });

    await expect(
      writer.append({ _brand: 'TransactionContext' } as TransactionContext, VALID_INPUT),
    ).rejects.toThrow(/mysqlConnection.*pool|pool was configured/s);
  });

  test('standalone append opens a pool transaction when mysqlConnection is absent', async () => {
    const query = mock(async () => [[], []]);
    const conn = {
      query,
      beginTransaction: mock(async () => {}),
      commit: mock(async () => {}),
      rollback: mock(async () => {}),
      release: mock(() => {}),
    };
    const pool = {
      getConnection: mock(async () => conn),
    };

    const writer = new OutboxWriterImpl({
      nextSfid: () => '1234567890123456789',
      pool: pool as unknown as import('mysql2/promise').Pool,
    });

    await writer.append({ _brand: 'TransactionContext' } as TransactionContext, VALID_INPUT);

    expect(pool.getConnection.mock.calls.length).toBe(1);
    expect(conn.beginTransaction.mock.calls.length).toBe(1);
    expect(conn.commit.mock.calls.length).toBe(1);
    expect(conn.release.mock.calls.length).toBe(1);
    expect(query.mock.calls.length).toBe(1);
  });
});
