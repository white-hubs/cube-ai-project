import { describe, test, expect, mock } from 'bun:test';
import type { Pool } from 'mysql2/promise';
import { SessionRepositoryImpl } from './session.repository';
import { MYSQL_POOL_TOKEN } from '../../../infra/mysql/mysql.tokens';

describe('SessionRepositoryImpl', () => {
  test('findById maps row and enforces tenant in SQL', async () => {
    const row = {
      id: '28147497671065600001',
      tenant: 10,
      user_id: 'alice',
      agent_id: '28147497671065600002',
      agent_version_no: 2,
      agent_snapshot_json: '{"schema":"agent-snapshot-v1"}',
      user_principal_snapshot_json: '{"schema":"user-principal-v1"}',
      title: null,
      status: 'ACTIVE',
      last_turn_id: null,
      last_active_time: new Date('2026-01-01T00:00:00.000Z'),
      context_json: null,
      deleted: 0,
      create_by: 'alice',
      creator_id: 'alice',
      creator_type: 'USER',
      create_time: new Date('2026-01-01T00:00:00.000Z'),
      update_by: 'alice',
      updater_id: 'alice',
      updater_type: 'USER',
      update_time: new Date('2026-01-01T00:00:00.000Z'),
    };

    let capturedSql = '';
    const pool = {
      execute: mock(async (sql: string) => {
        capturedSql = sql;
        return [[row], []] as never;
      }),
    } as unknown as Pool;

    const repo = new SessionRepositoryImpl(pool);
    const session = await repo.findById(10, '28147497671065600001');

    expect(session?.userId).toBe('alice');
    expect(session?.tenant).toBe(10);
    expect(capturedSql).toContain('tenant = ?');
    expect(capturedSql).toContain('deleted = 0');
  });

  test('findByIdAsOwner enforces user_id for non-admin reads', async () => {
    const row = {
      id: '28147497671065600001',
      tenant: 10,
      user_id: 'alice',
      agent_id: '28147497671065600002',
      agent_version_no: 2,
      agent_snapshot_json: '{"schema":"agent-snapshot-v1"}',
      user_principal_snapshot_json: '{"schema":"user-principal-v1"}',
      title: null,
      status: 'ACTIVE',
      last_turn_id: null,
      last_active_time: new Date('2026-01-01T00:00:00.000Z'),
      context_json: null,
      deleted: 0,
      create_by: 'alice',
      creator_id: 'alice',
      creator_type: 'USER',
      create_time: new Date('2026-01-01T00:00:00.000Z'),
      update_by: 'alice',
      updater_id: 'alice',
      updater_type: 'USER',
      update_time: new Date('2026-01-01T00:00:00.000Z'),
    };

    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const pool = {
      execute: mock(async (sql: string, params: unknown[]) => {
        capturedSql = sql;
        capturedParams = params;
        return [[row], []] as never;
      }),
    } as unknown as Pool;

    const repo = new SessionRepositoryImpl(pool);
    const session = await repo.findByIdAsOwner(10, '28147497671065600001', 'alice', {
      admin: false,
    });

    expect(session?.userId).toBe('alice');
    expect(capturedSql).toContain('user_id = ?');
    expect(capturedParams).toEqual(['28147497671065600001', 10, 'alice']);
  });

  test('updateStatus throws when no row matched', async () => {
    const pool = {
      execute: mock(async () => [{ affectedRows: 0 }, []] as never),
    } as unknown as Pool;

    const repo = new SessionRepositoryImpl(pool);

    await expect(repo.updateStatus(1, '28147497671065600001', 'CLOSED')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND_SESSION',
    });
  });

  test('listByOwner returns cursor when more rows exist', async () => {
    const mk = (id: string, t: number) => ({
      id,
      tenant: 1,
      user_id: 'u',
      agent_id: '28147497671065600002',
      agent_version_no: 1,
      agent_snapshot_json: '{}',
      user_principal_snapshot_json: '{}',
      title: null,
      status: 'ACTIVE',
      last_turn_id: null,
      last_active_time: new Date(t),
      context_json: null,
      deleted: 0,
      create_by: 'u',
      creator_id: 'u',
      creator_type: 'USER',
      create_time: new Date(t),
      update_by: 'u',
      updater_id: 'u',
      updater_type: 'USER',
      update_time: new Date(t),
    });

    const rows = [mk('28147497671065600003', 100), mk('28147497671065600002', 99)];

    const pool = {
      execute: mock(async () => [rows, []] as never),
    } as unknown as Pool;

    const repo = new SessionRepositoryImpl(pool);
    const result = await repo.listByOwner(1, 'u', { limit: 1 });

    expect(result.items.length).toBe(1);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeDefined();
  });

  test('listByOwner omits user_id filter for admin reads', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const pool = {
      execute: mock(async (sql: string, params: unknown[]) => {
        capturedSql = sql;
        capturedParams = params;
        return [[], []] as never;
      }),
    } as unknown as Pool;

    const repo = new SessionRepositoryImpl(pool);
    await repo.listByOwner(1, 'admin-user', { limit: 20, admin: true });

    expect(capturedSql).not.toContain('user_id = ?');
    expect(capturedParams).toEqual([1, 'ACTIVE', 'CLOSED']);
  });

  test('MYSQL_POOL_TOKEN uses agentic.infra.mysql namespace', () => {
    expect(String(MYSQL_POOL_TOKEN)).toBe('Symbol(agentic.infra.mysql)');
  });
});
