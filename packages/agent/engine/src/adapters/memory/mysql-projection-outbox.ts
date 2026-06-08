import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export type ProjectionState =
  | 'pending'
  | 'retrying'
  | 'indexed'
  | 'failed'
  | 'dead';

export interface ProjectionRecord {
  ref: string;
  state: ProjectionState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
  vectorId?: string;
}

export interface MysqlProjectionOutboxOptions {
  pool: Pool;
  /** Default tenant when not passed per-call (env / assembler). */
  tenantId?: number;
  maxAttempts?: number;
  staleAfterMs?: number;
  nextId?: () => bigint;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_STALE_MS = 5 * 60_000;
const SYSTEM_ACTOR = 'memory-projection';

interface OutboxRow extends RowDataPacket {
  ref: string;
  state: ProjectionState;
  attempts: number;
  vector_id: string | null;
  last_error: string | null;
  create_time: Date;
  update_time: Date;
}

function epochMs(v: Date): number {
  return v.getTime();
}

/**
 * MySQL-backed projection outbox — API-compatible with tachu {@link ProjectionOutbox}.
 */
export class MysqlProjectionOutbox {
  private readonly maxAttempts: number;
  private readonly staleAfterMs: number;
  private readonly tenantId: number;
  private readonly nextId: () => bigint;
  private idSeq = 1n;

  constructor(private readonly options: MysqlProjectionOutboxOptions) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_MS;
    this.tenantId =
      options.tenantId ??
      Number(process.env['AGENTIC_ENGINE_MEMORY_TENANT_ID'] ?? '1');
    this.nextId = options.nextId ?? (() => this.idSeq++);
  }

  private resolveTenant(tenant?: number): number {
    return tenant ?? this.tenantId;
  }

  private async fetchRow(
    tenant: number,
    sessionId: string,
    ref: string,
  ): Promise<OutboxRow | null> {
    const [rows] = await this.options.pool.query<OutboxRow[]>(
      `SELECT ref, state, attempts, vector_id, last_error, create_time, update_time
       FROM memory_projection_outbox
       WHERE tenant = ? AND session_id = ? AND ref = ? AND deleted = 0
       LIMIT 1`,
      [tenant, sessionId, ref],
    );
    return rows[0] ?? null;
  }

  private rowToRecord(row: OutboxRow): ProjectionRecord {
    return {
      ref: row.ref,
      state: row.state,
      attempts: row.attempts,
      createdAt: epochMs(row.create_time),
      updatedAt: epochMs(row.update_time),
      ...(row.last_error ? { lastError: row.last_error } : {}),
      ...(row.vector_id ? { vectorId: row.vector_id } : {}),
    };
  }

  async recover(sessionId: string, now: number = Date.now()): Promise<number> {
    const tenant = this.resolveTenant();
    const staleBefore = new Date(now - this.staleAfterMs);
    const [result] = await this.options.pool.query<ResultSetHeader>(
      `UPDATE memory_projection_outbox
       SET state = 'pending', update_time = NOW(3), update_by = ?
       WHERE tenant = ? AND session_id = ? AND deleted = 0
         AND state = 'retrying' AND update_time < ?`,
      [SYSTEM_ACTOR, tenant, sessionId, staleBefore],
    );
    return result.affectedRows ?? 0;
  }

  async enqueue(
    sessionId: string,
    ref: string,
    now: number = Date.now(),
    tenant?: number,
  ): Promise<void> {
    const t = this.resolveTenant(tenant);
    const existing = await this.fetchRow(t, sessionId, ref);
    if (existing?.state === 'indexed') return;

    if (existing) {
      await this.options.pool.query(
        `UPDATE memory_projection_outbox
         SET state = 'pending', update_time = ?, update_by = ?
         WHERE tenant = ? AND session_id = ? AND ref = ? AND deleted = 0`,
        [new Date(now), SYSTEM_ACTOR, t, sessionId, ref],
      );
      return;
    }

    const id = this.nextId();
    await this.options.pool.query(
      `INSERT INTO memory_projection_outbox (
         id, tenant, session_id, ref, state, attempts, deleted,
         create_by, create_time, update_by, update_time
       ) VALUES (?, ?, ?, ?, 'pending', 0, 0, ?, ?, ?, ?)`,
      [id.toString(), t, sessionId, ref, SYSTEM_ACTOR, new Date(now), SYSTEM_ACTOR, new Date(now)],
    );
  }

  async markRetrying(
    sessionId: string,
    ref: string,
    now: number = Date.now(),
    tenant?: number,
  ): Promise<void> {
    const t = this.resolveTenant(tenant);
    await this.options.pool.query(
      `UPDATE memory_projection_outbox
       SET state = 'retrying', update_time = ?, update_by = ?
       WHERE tenant = ? AND session_id = ? AND ref = ? AND deleted = 0`,
      [new Date(now), SYSTEM_ACTOR, t, sessionId, ref],
    );
  }

  async markIndexed(
    sessionId: string,
    ref: string,
    vectorId: string,
    now: number = Date.now(),
    tenant?: number,
  ): Promise<void> {
    const t = this.resolveTenant(tenant);
    await this.options.pool.query(
      `UPDATE memory_projection_outbox
       SET state = 'indexed', vector_id = ?, update_time = ?, update_by = ?
       WHERE tenant = ? AND session_id = ? AND ref = ? AND deleted = 0`,
      [vectorId, new Date(now), SYSTEM_ACTOR, t, sessionId, ref],
    );
  }

  async markFailed(
    sessionId: string,
    ref: string,
    error: string,
    now: number = Date.now(),
    tenant?: number,
  ): Promise<ProjectionState> {
    const t = this.resolveTenant(tenant);
    const existing = await this.fetchRow(t, sessionId, ref);
    const attempts = (existing?.attempts ?? 0) + 1;
    const nextState: ProjectionState =
      attempts >= this.maxAttempts ? 'dead' : 'failed';

    if (existing) {
      await this.options.pool.query(
        `UPDATE memory_projection_outbox
         SET state = ?, attempts = ?, last_error = ?, update_time = ?, update_by = ?
         WHERE tenant = ? AND session_id = ? AND ref = ? AND deleted = 0`,
        [nextState, attempts, error, new Date(now), SYSTEM_ACTOR, t, sessionId, ref],
      );
    } else {
      const id = this.nextId();
      await this.options.pool.query(
        `INSERT INTO memory_projection_outbox (
           id, tenant, session_id, ref, state, attempts, last_error, deleted,
           create_by, create_time, update_by, update_time
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [
          id.toString(),
          t,
          sessionId,
          ref,
          nextState,
          attempts,
          error,
          SYSTEM_ACTOR,
          new Date(now),
          SYSTEM_ACTOR,
          new Date(now),
        ],
      );
    }
    return nextState;
  }

  async list(sessionId: string, tenant?: number): Promise<ProjectionRecord[]> {
    const t = this.resolveTenant(tenant);
    const [rows] = await this.options.pool.query<OutboxRow[]>(
      `SELECT ref, state, attempts, vector_id, last_error, create_time, update_time
       FROM memory_projection_outbox
       WHERE tenant = ? AND session_id = ? AND deleted = 0
       ORDER BY create_time ASC`,
      [t, sessionId],
    );
    return rows.map((row) => this.rowToRecord(row));
  }

  async listSessions(tenant?: number): Promise<string[]> {
    const t = this.resolveTenant(tenant);
    const [rows] = await this.options.pool.query<RowDataPacket[]>(
      `SELECT DISTINCT session_id AS sessionId
       FROM memory_projection_outbox
       WHERE tenant = ? AND deleted = 0
         AND state IN ('pending', 'failed', 'retrying')
       ORDER BY session_id`,
      [t],
    );
    return rows.map((r) => String(r['sessionId']));
  }

  async listPending(sessionId: string, tenant?: number): Promise<ProjectionRecord[]> {
    const all = await this.list(sessionId, tenant);
    return all.filter((rec) => rec.state === 'pending' || rec.state === 'failed');
  }

  async pendingCount(sessionId: string, tenant?: number): Promise<number> {
    const t = this.resolveTenant(tenant);
    const [rows] = await this.options.pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM memory_projection_outbox
       WHERE tenant = ? AND session_id = ? AND deleted = 0
         AND state IN ('pending', 'failed', 'retrying')`,
      [t, sessionId],
    );
    return Number(rows[0]?.['c'] ?? 0);
  }

  resetCache(): void {
    /* no in-process cache */
  }
}
