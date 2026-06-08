import { Injectable } from '@dangao/bun-server';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type {
  Sfid,
  Tenant,
  SessionRow,
  SessionRowStatus,
  CreateSessionInput,
} from '@cube-ai/contracts';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import { execDynamic, queryRowsDynamic, type SqlValue } from '../../../infra/mysql/sql-helpers';

/**
 * SessionRepository interface.
 *
 * Aligned with:
 *   docs/detailed-design/02-data/mysql-tables.md §6 (sessions table DDL + access patterns)
 *   docs/technical-design/phase-1/P1-03-data-outbox.md §3.7
 */
export interface SessionRepository {
  findById(tenant: Tenant, id: Sfid): Promise<SessionRow | null>;

  /**
   * Insert within an existing transaction (caller owns BEGIN/COMMIT).
   */
  insertWithConnection(
    conn: PoolConnection,
    tenant: Tenant,
    sessionId: Sfid,
    input: CreateSessionInput,
  ): Promise<SessionRow>;

  updateStatus(tenant: Tenant, id: Sfid, status: SessionRowStatus): Promise<void>;

  updatePartial(
    tenant: Tenant,
    id: Sfid,
    patch: { title?: string | null; status?: SessionRowStatus },
    actorUserId: string,
  ): Promise<void>;

  updatePartialWithConnection(
    conn: PoolConnection,
    tenant: Tenant,
    id: Sfid,
    patch: { title?: string | null; status?: SessionRowStatus },
    actorUserId: string,
  ): Promise<void>;

  touchActivity(tenant: Tenant, id: Sfid, lastTurnId: Sfid): Promise<void>;

  softDelete(tenant: Tenant, id: Sfid, actorUserId: string): Promise<void>;

  softDeleteWithConnection(
    conn: PoolConnection,
    tenant: Tenant,
    id: Sfid,
    actorUserId: string,
  ): Promise<void>;

  listByOwner(
    tenant: Tenant,
    userId: string,
    opts: {
      statuses?: SessionRowStatus[];
      limit: number;
      cursor?: string;
    },
  ): Promise<{ items: SessionRow[]; nextCursor?: string; hasMore: boolean }>;
}

function requirePool(pool: Pool | null): Pool {
  if (!pool) {
    throw AgenticEngineError.fromCode(
      'INTERNAL_UNKNOWN',
      'MySQL pool is not configured — set AGENTIC_ENGINE_MYSQL_URL',
      {},
    );
  }
  return pool;
}

function toEpochMs(v: Date | string | number): number {
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function mapSessionRow(r: RowDataPacket): SessionRow {
  const deletedRaw = r.deleted;
  const deleted =
    typeof deletedRaw === 'bigint'
      ? Number(deletedRaw)
      : typeof deletedRaw === 'string'
        ? Number(deletedRaw)
        : Number(deletedRaw);

  const lastTurnId = r.last_turn_id != null ? String(r.last_turn_id) : null;

  return {
    id: String(r.id),
    tenant: Number(r.tenant),
    userId: String(r.user_id),
    agentId: String(r.agent_id),
    agentVersionNo: Number(r.agent_version_no),
    agentSnapshotJson: parseJsonColumn(r.agent_snapshot_json),
    userPrincipalSnapshotJson: parseJsonColumn(r.user_principal_snapshot_json),
    title: r.title != null ? String(r.title) : null,
    status: r.status as SessionRowStatus,
    lastTurnId,
    lastActiveTime: toEpochMs(r.last_active_time),
    contextJson: r.context_json != null ? parseJsonColumn(r.context_json) : null,
    deleted,
    createBy: String(r.create_by),
    creatorId: r.creator_id != null ? String(r.creator_id) : null,
    creatorType: r.creator_type ?? null,
    createTime: toEpochMs(r.create_time),
    updateBy: String(r.update_by),
    updaterId: r.updater_id != null ? String(r.updater_id) : null,
    updaterType: r.updater_type ?? null,
    updateTime: toEpochMs(r.update_time),
  };
}

function parseJsonColumn(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

@Injectable()
export class SessionRepositoryImpl implements SessionRepository {
  constructor(private readonly pool: Pool | null) {}

  async findById(tenant: Tenant, id: Sfid): Promise<SessionRow | null> {
    const p = requirePool(this.pool);
    const [rows] = await p.execute<RowDataPacket[]>(
      `SELECT * FROM sessions
       WHERE id = ? AND tenant = ? AND deleted = 0
       LIMIT 1`,
      [id, tenant],
    );
    const r = rows[0];
    return r ? mapSessionRow(r) : null;
  }

  async insertWithConnection(
    conn: PoolConnection,
    tenant: Tenant,
    sessionId: Sfid,
    input: CreateSessionInput,
  ): Promise<SessionRow> {
    const nowMs = Date.now();
    const auditActor = input.userId;
    const ts = new Date(nowMs);
    await conn.execute(
      `INSERT INTO sessions (
        id, tenant, user_id, agent_id, agent_version_no,
        agent_snapshot_json, user_principal_snapshot_json, title, status,
        last_turn_id, last_active_time, context_json,
        deleted,
        create_by, creator_id, creator_type, create_time,
        update_by, updater_id, updater_type, update_time
      ) VALUES (
        ?, ?, ?, ?, ?,
        CAST(? AS JSON), CAST(? AS JSON), ?, 'ACTIVE',
        NULL, ?, CAST(? AS JSON),
        0,
        ?, ?, 'USER', ?,
        ?, ?, 'USER', ?
      )`,
      [
        sessionId,
        tenant,
        input.userId,
        input.agentId,
        input.agentVersionNo,
        JSON.stringify(input.agentSnapshotJson),
        JSON.stringify(input.userPrincipalSnapshotJson),
        input.title ?? null,
        ts,
        input.contextJson != null ? JSON.stringify(input.contextJson) : null,
        auditActor,
        auditActor,
        ts,
        auditActor,
        auditActor,
        ts,
      ],
    );

    const row = await this.findByIdWithConnection(conn, tenant, sessionId);
    if (!row) {
      throw AgenticEngineError.fromCode('INTERNAL_UNKNOWN', 'Session insert failed — row not visible', {
        sessionId,
      });
    }
    return row;
  }

  private async findByIdWithConnection(
    conn: PoolConnection,
    tenant: Tenant,
    id: Sfid,
  ): Promise<SessionRow | null> {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM sessions WHERE id = ? AND tenant = ? AND deleted = 0 LIMIT 1`,
      [id, tenant],
    );
    const r = rows[0];
    return r ? mapSessionRow(r) : null;
  }

  async updateStatus(tenant: Tenant, id: Sfid, status: SessionRowStatus): Promise<void> {
    const p = requirePool(this.pool);
    const now = new Date();
    const [res] = await p.execute(
      `UPDATE sessions
       SET status = ?, update_time = ?, update_by = 'system', updater_type = 'SYSTEM'
       WHERE id = ? AND tenant = ? AND deleted = 0`,
      [status, now, id, tenant],
    );
    const affected = (res as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) {
      throw AgenticEngineError.fromCode('RESOURCE_NOT_FOUND_SESSION', `Session ${id} not found`, {
        sessionId: id,
      });
    }
  }

  async updatePartial(
    tenant: Tenant,
    id: Sfid,
    patch: { title?: string | null; status?: SessionRowStatus },
    actorUserId: string,
  ): Promise<void> {
    const p = requirePool(this.pool);
    const assignments: string[] = [];
    const vals: SqlValue[] = [];
    if (patch.title !== undefined) {
      assignments.push('title = ?');
      vals.push(patch.title);
    }
    if (patch.status !== undefined) {
      assignments.push('status = ?');
      vals.push(patch.status);
    }
    if (assignments.length === 0) return;

    assignments.push('update_time = ?', 'update_by = ?', 'updater_id = ?', 'updater_type = ?');
    vals.push(new Date(), actorUserId, actorUserId, 'USER');
    vals.push(id, tenant);

    const res = await execDynamic(
      p,
      `UPDATE sessions SET ${assignments.join(', ')}
       WHERE id = ? AND tenant = ? AND deleted = 0`,
      vals as ReadonlyArray<SqlValue>,
    );
    const affected = (res as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) {
      throw AgenticEngineError.fromCode('RESOURCE_NOT_FOUND_SESSION', `Session ${id} not found`, {
        sessionId: id,
      });
    }
  }

  async updatePartialWithConnection(
    conn: PoolConnection,
    tenant: Tenant,
    id: Sfid,
    patch: { title?: string | null; status?: SessionRowStatus },
    actorUserId: string,
  ): Promise<void> {
    const assignments: string[] = [];
    const vals: SqlValue[] = [];
    if (patch.title !== undefined) {
      assignments.push('title = ?');
      vals.push(patch.title);
    }
    if (patch.status !== undefined) {
      assignments.push('status = ?');
      vals.push(patch.status);
    }
    if (assignments.length === 0) return;

    assignments.push('update_time = ?', 'update_by = ?', 'updater_id = ?', 'updater_type = ?');
    vals.push(new Date(), actorUserId, actorUserId, 'USER');
    vals.push(id, tenant);

    const res = await execDynamic(
      conn,
      `UPDATE sessions SET ${assignments.join(', ')}
       WHERE id = ? AND tenant = ? AND deleted = 0`,
      vals as ReadonlyArray<SqlValue>,
    );
    const affected = (res as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) {
      throw AgenticEngineError.fromCode('RESOURCE_NOT_FOUND_SESSION', `Session ${id} not found`, {
        sessionId: id,
      });
    }
  }

  async touchActivity(tenant: Tenant, id: Sfid, lastTurnId: Sfid): Promise<void> {
    const p = requirePool(this.pool);
    const now = new Date();
    await p.execute(
      `UPDATE sessions
       SET last_turn_id = ?, last_active_time = ?, update_time = ?, update_by = 'system', updater_type = 'SYSTEM'
       WHERE id = ? AND tenant = ? AND deleted = 0`,
      [lastTurnId, now, now, id, tenant],
    );
  }

  async softDelete(tenant: Tenant, id: Sfid, actorUserId: string): Promise<void> {
    const p = requirePool(this.pool);
    const deletedMs = Date.now();
    const now = new Date();
    const [res] = await p.execute(
      `UPDATE sessions
       SET deleted = ?, status = 'ARCHIVED', update_time = ?,
           update_by = ?, updater_id = ?, updater_type = 'USER'
       WHERE id = ? AND tenant = ? AND deleted = 0`,
      [deletedMs, now, actorUserId, actorUserId, id, tenant],
    );
    const affected = (res as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) {
      throw AgenticEngineError.fromCode('RESOURCE_NOT_FOUND_SESSION', `Session ${id} not found`, {
        sessionId: id,
      });
    }
  }

  async softDeleteWithConnection(
    conn: PoolConnection,
    tenant: Tenant,
    id: Sfid,
    actorUserId: string,
  ): Promise<void> {
    const deletedMs = Date.now();
    const now = new Date();
    const [res] = await conn.execute(
      `UPDATE sessions
       SET deleted = ?, status = 'ARCHIVED', update_time = ?,
           update_by = ?, updater_id = ?, updater_type = 'USER'
       WHERE id = ? AND tenant = ? AND deleted = 0`,
      [deletedMs, now, actorUserId, actorUserId, id, tenant],
    );
    const affected = (res as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) {
      throw AgenticEngineError.fromCode('RESOURCE_NOT_FOUND_SESSION', `Session ${id} not found`, {
        sessionId: id,
      });
    }
  }

  async listByOwner(
    tenant: Tenant,
    userId: string,
    opts: { statuses?: SessionRowStatus[]; limit: number; cursor?: string },
  ): Promise<{ items: SessionRow[]; nextCursor?: string; hasMore: boolean }> {
    const p = requirePool(this.pool);
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    const statuses =
      opts.statuses && opts.statuses.length > 0 ? opts.statuses : (['ACTIVE', 'CLOSED'] as const);

    let cursorMs: number | undefined;
    let cursorId: string | undefined;
    if (opts.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(opts.cursor, 'base64url').toString('utf8')) as {
          t?: number;
          id?: string;
        };
        cursorMs = decoded.t;
        cursorId = decoded.id;
      } catch {
        throw AgenticEngineError.fromCode('INVALID_ARGUMENT_SCHEMA_VIOLATION', 'Invalid cursor', {});
      }
    }

    const statusPlaceholders = statuses.map(() => '?').join(', ');
    const params: SqlValue[] = [tenant, userId, ...statuses];
    let sql = `
      SELECT * FROM sessions
      WHERE tenant = ? AND user_id = ? AND deleted = 0
        AND status IN (${statusPlaceholders})`;

    if (cursorMs !== undefined && cursorId !== undefined) {
      sql += ` AND (last_active_time < ? OR (last_active_time = ? AND id < ?))`;
      params.push(new Date(cursorMs), new Date(cursorMs), cursorId);
    }

    /**
     * Inline LIMIT — MySQL 8.0.22+ rejects integer placeholders for LIMIT in
     * the binary protocol used by mysql2 `execute()` with the error
     * `Incorrect arguments to mysqld_stmt_execute`. `limit` is the result of
     * `Math.min(Math.max(opts.limit, 1), 100)` above, so `limit + 1` is a
     * trusted integer in `2..101` — safe to interpolate, never user-controlled.
     * Cf. `bun-server-ext-outbox/src/relay.service.ts` (uses `query()` for the
     * same reason).
     */
    sql += ` ORDER BY last_active_time DESC, id DESC LIMIT ${limit + 1}`;

    const rows = await queryRowsDynamic<RowDataPacket>(p, sql, params as ReadonlyArray<SqlValue>);
    const items = rows.slice(0, limit).map(mapSessionRow);
    const hasMore = rows.length > limit;
    let nextCursor: string | undefined;
    if (hasMore && items.length > 0) {
      const tail = items[items.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({ t: tail.lastActiveTime, id: tail.id }),
        'utf8',
      ).toString('base64url');
    }
    return { items, nextCursor, hasMore };
  }
}
