import { describe, expect, it, beforeEach } from 'bun:test';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MysqlProjectionOutbox } from './mysql-projection-outbox';

type Row = Record<string, unknown>;

function createMemoryPool(): Pool & { _rows: Row[]; _nextId: () => bigint } {
  const rows: Row[] = [];
  let idSeq = 1n;

  const pool = {
    async query<T extends RowDataPacket[] | ResultSetHeader>(
      sql: string,
      params?: unknown[],
    ): Promise<[T, unknown]> {
      const p = params ?? [];
      if (sql.includes('INSERT INTO memory_projection_outbox') && p.length >= 8) {
        const isMarkFailedInsert = typeof p[4] === 'string' && ['failed', 'dead'].includes(String(p[4]));
        rows.push({
          id: p[0],
          tenant: p[1],
          session_id: p[2],
          ref: p[3],
          state: isMarkFailedInsert ? p[4] : 'pending',
          attempts: isMarkFailedInsert ? Number(p[5]) : 0,
          vector_id: null,
          last_error: isMarkFailedInsert ? p[6] : null,
          deleted: 0,
          create_time: isMarkFailedInsert ? (p[8] ?? new Date()) : (p[5] ?? new Date()),
          update_time: isMarkFailedInsert ? (p[10] ?? new Date()) : (p[7] ?? new Date()),
        });
        return [{ affectedRows: 1 } as ResultSetHeader, undefined] as [T, unknown];
      }
      if (sql.includes('INSERT INTO memory_projection_outbox')) {
        rows.push({
          id: p[0],
          tenant: p[1],
          session_id: p[2],
          ref: p[3],
          state: 'pending',
          attempts: 0,
          vector_id: null,
          last_error: null,
          deleted: 0,
          create_time: p[5] ?? new Date(),
          update_time: p[7] ?? new Date(),
        });
        return [{ affectedRows: 1 } as ResultSetHeader, undefined] as [T, unknown];
      }
      if (sql.includes('SELECT ref, state') && sql.includes('LIMIT 1')) {
        const hit = rows.find(
          (r) =>
            r['tenant'] === p[0] &&
            r['session_id'] === p[1] &&
            r['ref'] === p[2] &&
            r['deleted'] === 0,
        );
        return [(hit ? [hit] : []) as T, undefined];
      }
      if (sql.includes('UPDATE memory_projection_outbox') && sql.includes("'retrying'")) {
        const hit = rows.find(
          (r) =>
            r['tenant'] === p[1] &&
            r['session_id'] === p[2] &&
            r['ref'] === p[3] &&
            r['deleted'] === 0,
        );
        if (hit) hit['state'] = 'retrying';
        return [{ affectedRows: hit ? 1 : 0 } as ResultSetHeader, undefined] as [T, unknown];
      }
      if (sql.includes("state = 'indexed'")) {
        const hit = rows.find(
          (r) =>
            r['tenant'] === p[3] &&
            r['session_id'] === p[4] &&
            r['ref'] === p[5] &&
            r['deleted'] === 0,
        );
        if (hit) {
          hit['state'] = 'indexed';
          hit['vector_id'] = p[0];
        }
        return [{ affectedRows: hit ? 1 : 0 } as ResultSetHeader, undefined] as [T, unknown];
      }
      if (sql.includes('state = ?, attempts = ?')) {
        const hit = rows.find(
          (r) =>
            r['tenant'] === p[5] &&
            r['session_id'] === p[6] &&
            r['ref'] === p[7] &&
            r['deleted'] === 0,
        );
        if (hit) {
          hit['state'] = p[0];
          hit['attempts'] = Number(p[1]);
          hit['last_error'] = p[2];
        }
        return [{ affectedRows: hit ? 1 : 0 } as ResultSetHeader, undefined] as [T, unknown];
      }
      if (sql.includes('ORDER BY create_time ASC')) {
        const filtered = rows.filter(
          (r) =>
            r['tenant'] === p[0] && r['session_id'] === p[1] && r['deleted'] === 0,
        );
        return [filtered as T, undefined];
      }
      if (sql.includes('SELECT DISTINCT session_id')) {
        const filtered = rows.filter(
          (r) =>
            r['tenant'] === p[0] &&
            r['deleted'] === 0 &&
            ['pending', 'failed', 'retrying'].includes(String(r['state'])),
        );
        return [
          filtered.map((r) => ({ sessionId: r['session_id'] })) as unknown as T,
          undefined,
        ];
      }
      if (sql.includes('COUNT(*)')) {
        const c = rows.filter(
          (r) =>
            r['tenant'] === p[0] &&
            r['session_id'] === p[1] &&
            r['deleted'] === 0 &&
            ['pending', 'failed', 'retrying'].includes(String(r['state'])),
        ).length;
        return [{ c } as unknown as T, undefined];
      }
      if (sql.includes("state = 'pending'") && sql.includes('UPDATE')) {
        const hit = rows.find(
          (r) =>
            r['tenant'] === p[2] &&
            r['session_id'] === p[3] &&
            r['ref'] === p[4] &&
            r['deleted'] === 0,
        );
        if (hit) hit['state'] = 'pending';
        return [{ affectedRows: hit ? 1 : 0 } as ResultSetHeader, undefined] as [T, unknown];
      }
      throw new Error(`unhandled sql in memory pool mock: ${sql.slice(0, 80)}`);
    },
  } as unknown as Pool;

  return Object.assign(pool, {
    _rows: rows,
    _nextId: () => idSeq++,
  });
}

describe('MysqlProjectionOutbox', () => {
  let pool: Pool & { _rows: Row[]; _nextId: () => bigint };
  let outbox: MysqlProjectionOutbox;

  beforeEach(() => {
    pool = createMemoryPool();
    outbox = new MysqlProjectionOutbox({
      pool,
      tenantId: 1,
      maxAttempts: 2,
      nextId: () => pool._nextId(),
    });
  });

  it('enqueue creates pending row', async () => {
    await outbox.enqueue('sess-1', 'entry-a');
    const rows = await outbox.list('sess-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ref).toBe('entry-a');
    expect(rows[0]!.state).toBe('pending');
  });

  it('markRetrying → markIndexed transitions state', async () => {
    await outbox.enqueue('sess-1', 'entry-a');
    await outbox.markRetrying('sess-1', 'entry-a');
    await outbox.markIndexed('sess-1', 'entry-a', 'vec-123');
    const rows = await outbox.list('sess-1');
    expect(rows[0]!.state).toBe('indexed');
    expect(rows[0]!.vectorId).toBe('vec-123');
  });

  it('markFailed reaches dead after maxAttempts', async () => {
    await outbox.enqueue('sess-1', 'entry-a');
    const s1 = await outbox.markFailed('sess-1', 'entry-a', 'err-1');
    expect(s1).toBe('failed');
    const s2 = await outbox.markFailed('sess-1', 'entry-a', 'err-2');
    expect(s2).toBe('dead');
  });

  it('enqueue is idempotent for indexed refs', async () => {
    await outbox.enqueue('sess-1', 'entry-a');
    await outbox.markIndexed('sess-1', 'entry-a', 'vec-1');
    await outbox.enqueue('sess-1', 'entry-a');
    const rows = await outbox.list('sess-1');
    expect(rows[0]!.state).toBe('indexed');
  });

  it('listPending returns pending and failed only', async () => {
    await outbox.enqueue('sess-1', 'a');
    await outbox.enqueue('sess-1', 'b');
    await outbox.markFailed('sess-1', 'b', 'e');
    await outbox.markIndexed('sess-1', 'a', 'v');
    const pending = await outbox.listPending('sess-1');
    expect(pending.map((p) => p.ref)).toEqual(['b']);
  });

  it('listSessions returns sessions with pending work', async () => {
    await outbox.enqueue('sess-a', 'r1');
    await outbox.enqueue('sess-b', 'r2');
    await outbox.markIndexed('sess-b', 'r2', 'v');
    const sessions = await outbox.listSessions();
    expect(sessions).toEqual(['sess-a']);
  });
});
