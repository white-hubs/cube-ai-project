import type { Pool, PoolConnection } from 'mysql2/promise';
import type { AppendOutboxInput } from '@cube-ai/contracts';
import { OutboxEventRowSchema, systemAuditFields } from '@cube-ai/contracts';
import { OutboxSfidGenerator } from './sfid-generator';

/**
 * Opaque transaction context: must hold an open `mysql2` connection
 * participating in the caller's transaction (BEGIN…COMMIT).
 *
 * ref: docs/technical-design/phase-1/P1-03-data-outbox.md §3.5
 */
export interface TransactionContext {
  readonly _brand: 'TransactionContext';
  readonly mysqlConnection: PoolConnection;
}

/**
 * OutboxWriter interface: write a single outbox row inside an existing DB transaction.
 *
 * ref: docs/detailed-design/02-data/README.md §10.1
 */
export interface OutboxWriter {
  append(tx: TransactionContext, row: AppendOutboxInput): Promise<void>;
}

/** DI token — Symbol.for('agentic.outbox.writer') */
export const OUTBOX_WRITER_TOKEN = Symbol.for('agentic.outbox.writer');

export interface OutboxWriterDeps {
  /** Defaults to bundled {@link OutboxSfidGenerator} when omitted (ADR-0014). */
  nextSfid?: () => string;
  /**
   * When set, {@link OutboxWriterImpl.append} may open its own transaction
   * (`getConnection` + `BEGIN`/`COMMIT`) if `tx.mysqlConnection` is missing.
   * Required for callers that use `null as TransactionContext` (e.g. best-effort
   * usage/audit emission after unrelated transactions have already committed).
   */
  pool?: Pool | null;
}

/** Placeholder error — retained for callers/tests that distinguish Phase 1 skeleton failures. */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

function extractBorrowedConnection(
  tx: TransactionContext | null | undefined,
): PoolConnection | null {
  const raw = tx as unknown as { mysqlConnection?: PoolConnection | null } | null;
  const c = raw?.mysqlConnection;
  if (c && typeof c.query === 'function') {
    return c;
  }
  return null;
}

function epochToDate(ms: number): Date {
  return new Date(ms);
}

/**
 * Strong-consistency INSERT into `outbox_events` (M1 DDL — 06-jobs/README.md §4.1).
 */
export class OutboxWriterImpl implements OutboxWriter {
  private readonly nextId: () => string;
  private readonly pool: Pool | null;

  constructor(deps?: OutboxWriterDeps) {
    const gen = new OutboxSfidGenerator();
    this.nextId = deps?.nextSfid ?? (() => gen.next());
    this.pool = deps?.pool ?? null;
  }

  /** 同 `append`，仅显式传入事务中的 `PoolConnection`（不写 BEGIN/COMMIT）。 */
  async appendInTx(conn: PoolConnection, row: AppendOutboxInput): Promise<void> {
    await this.append({ _brand: 'TransactionContext', mysqlConnection: conn }, row);
  }

  async append(tx: TransactionContext, row: AppendOutboxInput): Promise<void> {
    const borrowed = extractBorrowedConnection(tx);
    if (borrowed) {
      await this.insertOutboxRow(borrowed, row);
      return;
    }

    const pool = this.pool;
    if (!pool) {
      throw new Error(
        'OutboxWriterImpl.append: TransactionContext.mysqlConnection is required when no pool was configured (pass pool in OutboxWriterDeps for standalone writes)',
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await this.insertOutboxRow(conn, row);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  private async insertOutboxRow(conn: PoolConnection, row: AppendOutboxInput): Promise<void> {
    const now = Date.now();
    const id = this.nextId();
    const audit = systemAuditFields(row.tenant, now);

    const partial = {
      ...row,
      id,
      ...audit,
      status: 'PENDING' as const,
      attempts:     0,
      lastError:    null,
      publishTime:  null,
      nextAttemptTime: null,
    };

    OutboxEventRowSchema.parse(partial);

    const payloadJson =
      typeof row.payloadJson === 'string'
        ? row.payloadJson
        : JSON.stringify(row.payloadJson);

    const sql = `
      INSERT INTO outbox_events (
        id, tenant, channel, event_type, payload_json, target,
        status, attempts, last_error,
        schedule_time, publish_time, next_attempt_time,
        deleted,
        create_by, creator_id, creator_type, create_time,
        update_by, updater_id, updater_type, update_time
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        'PENDING', 0, NULL,
        ?, NULL, NULL,
        ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `;

    const params: unknown[] = [
      id,
      row.tenant,
      row.channel,
      row.eventType,
      payloadJson,
      row.target,
      epochToDate(row.scheduleTime),
      Number(audit.deleted),
      audit.createBy,
      audit.creatorId,
      audit.creatorType,
      epochToDate(audit.createTime),
      audit.updateBy,
      audit.updaterId,
      audit.updaterType,
      epochToDate(audit.updateTime),
    ];

    await conn.query(sql, params);
  }
}
