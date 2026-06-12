/**
 * Outbox Relay Service — leader-election + poll loop + dispatch (P3-07 + P3-08).
 *
 * P3-07 contributes:
 *   - mysql2 pool (env-driven lazy build / DI inject)
 *   - SELECT … FOR UPDATE SKIP LOCKED inside per-conn transaction
 *   - dispatchUnderTx + markPublished/markFailed (UPDATE PUBLISHED / PENDING+backoff / DEAD)
 *   - backoffMsAfterFailure (1s/4s/16s/64s exponential)
 *   - Metrics snapshot + isRelayLeader gate option
 *
 * P3-08 contributes:
 *   - LeaderElection (Redis SETNX) injected via DI
 *   - start({ onBecomeLeader, onLoseLeadership }) — timer only runs on leader
 *   - skipLeaderElection for `bun test` (single-process, no Redis)
 *   - CompositeDispatcher injected via OUTBOX_DISPATCHER_TOKEN
 *
 * Refs:
 *   - docs/detailed-design/06-jobs/bullmq-protocol.md §5
 *   - docs/technical-design/prompts/phase-3/P3-07-outbox-writer-relay.md
 *   - docs/technical-design/prompts/phase-3/P3-08-outbox-leader-dispatch.md
 */
import { Inject, Injectable } from '@dangao/bun-server';
import { createPool, type Pool, type PoolConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import type { OutboxEventRow } from '@cube-ai/contracts';
import { LeaderElection } from './leader-election';
import {
  OUTBOX_DISPATCHER_TOKEN,
  type OutboxDispatcherI,
} from './dispatcher';
import type { OutboxRelayOptions } from './types';

export interface OutboxRelayServiceOptions {
  /** Polling interval in ms (default 200 — P3-07). */
  pollIntervalMs?: number;
  /** Max rows per poll batch (default 100 — P3-07). */
  batchSize?: number;
  /** Injected pool — preferred for tests / explicit DI. */
  mysqlPool?: Pool;
  /**
   * When set, gates relay polling (multi-instance leader override).
   * Omit to use Redis {@link LeaderElection}; if Redis 未接线则回退单机 true。
   */
  isRelayLeader?: () => boolean | Promise<boolean>;
  /**
   * When true, skip `LeaderElection.start` and act as single-process leader
   * (used for `bun test` without Redis). Set `AGENTIC_OUTBOX_LEADER_IN_TEST=1`
   * in integration tests to force real election.
   */
  skipLeaderElection?: boolean;
}

export const DEFAULT_RELAY_OPTIONS: Required<
  Omit<OutboxRelayServiceOptions, 'mysqlPool' | 'isRelayLeader' | 'skipLeaderElection'>
> = {
  pollIntervalMs: 200,
  batchSize:      100,
};

export interface OutboxRelayMetricsSnapshot {
  dispatchTotal:   number;
  dispatchSuccess: number;
  dispatchFailure: number;
  deadTotal:       number;
  lastDispatchMs:  number;
}

function envSkipLeaderElection(options?: OutboxRelayServiceOptions): boolean {
  if (options?.skipLeaderElection === true) return true;
  if (options?.skipLeaderElection === false) return false;
  if (process.env['AGENTIC_OUTBOX_LEADER_IN_TEST'] === '1') return false;
  return process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test';
}

function toEpochMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  return 0;
}

function isTransientRelayErr(e: unknown): boolean {
  const code =
    typeof e === 'object' && e && 'code' in e
      ? String((e as { code: unknown }).code)
      : '';
  const errno =
    typeof e === 'object' && e && 'errno' in e
      ? Number((e as { errno: unknown }).errno)
      : 0;
  const msg = e instanceof Error ? e.message : String(e);
  return (
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'ER_NO_SUCH_TABLE' ||
    errno === 1146 ||
    msg.includes('PROTOCOL_CONNECTION_LOST') ||
    msg.includes("doesn't exist")
  );
}

function truncateErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 1024 ? `${msg.slice(0, 1021)}...` : msg;
}

/** Exponential backoff (seconds): 1s, 4s, 16s, 64s… → `4^(attempts-1)` seconds after increment. */
export function backoffMsAfterFailure(nextAttempts: number): number {
  if (nextAttempts <= 0) return 1_000;
  return Math.pow(4, nextAttempts - 1) * 1000;
}

function mapDbRow(r: RowDataPacket): OutboxEventRow {
  let payloadJson: unknown = r.payload_json;
  if (typeof payloadJson === 'string') {
    try {
      payloadJson = JSON.parse(payloadJson) as unknown;
    } catch {
      /* keep raw string */
    }
  }

  const id = typeof r.id === 'bigint' || typeof r.id === 'number' ? String(r.id) : String(r.id);

  return {
    id,
    tenant:           Number(r.tenant),
    channel:          r.channel,
    eventType:        r.event_type,
    payloadJson,
    target:           r.target ?? null,
    status:           r.status,
    attempts:         Number(r.attempts),
    lastError:        r.last_error ?? null,
    scheduleTime:     toEpochMs(r.schedule_time),
    publishTime:      r.publish_time ? toEpochMs(r.publish_time) : null,
    nextAttemptTime:  r.next_attempt_time ? toEpochMs(r.next_attempt_time) : null,
    deleted:          typeof r.deleted === 'bigint' ? Number(r.deleted) : Number(r.deleted),
    createBy:         r.create_by,
    creatorId:        r.creator_id ?? null,
    creatorType:      r.creator_type ?? null,
    createTime:       toEpochMs(r.create_time),
    updateBy:         r.update_by,
    updaterId:        r.updater_id ?? null,
    updaterType:      r.updater_type ?? null,
    updateTime:       toEpochMs(r.update_time),
  };
}

function createPoolFromEnv(): Pool {
  const url = process.env['AGENTIC_ENGINE_MYSQL_URL']?.trim();
  if (url) {
    return createPool({
      uri: url,
      waitForConnections: true,
      connectionLimit: 10,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
  }
  return createPool({
    host:     process.env.AGENTIC_ENGINE_MYSQL_HOST ?? '127.0.0.1',
    port:     Number(process.env.AGENTIC_ENGINE_MYSQL_PORT ?? 3306),
    user:     process.env.AGENTIC_ENGINE_MYSQL_USER ?? 'root',
    password: process.env.AGENTIC_ENGINE_MYSQL_PASSWORD ?? '',
    database: process.env.AGENTIC_ENGINE_MYSQL_DB ?? 'cube_ai_center',
    waitForConnections: true,
    connectionLimit:    10,
  });
}

@Injectable()
export class OutboxRelayService {
  private _leader = false;
  private shuttingDown = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private _dispatcher: OutboxDispatcherI | null = null;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly skipLeaderElection: boolean;
  private lazyPool: Pool | null = null;
  private relayLock = false;
  private inflightTimer: Promise<void> = Promise.resolve();

  private readonly metrics = {
    dispatchTotal:   0,
    dispatchSuccess: 0,
    dispatchFailure: 0,
    deadTotal:       0,
    lastDispatchMs:  0,
  };

  constructor(
    private readonly leaderElection: LeaderElection,
    @Inject(OUTBOX_DISPATCHER_TOKEN) private readonly defaultDispatcher: OutboxDispatcherI,
    private readonly options: OutboxRelayServiceOptions = {},
  ) {
    this.pollIntervalMs     = options.pollIntervalMs ?? DEFAULT_RELAY_OPTIONS.pollIntervalMs;
    this.batchSize          = options.batchSize      ?? DEFAULT_RELAY_OPTIONS.batchSize;
    this.skipLeaderElection = envSkipLeaderElection(options);
  }

  isLeader(): boolean {
    return this._leader;
  }

  getRelayMetrics(): Readonly<OutboxRelayMetricsSnapshot> {
    return { ...this.metrics };
  }

  /**
   * Begin relay: leader election (unless skipped in test) + poll interval when leader.
   */
  async start(dispatcher?: OutboxDispatcherI): Promise<void> {
    this._dispatcher  = dispatcher ?? this.defaultDispatcher;
    this.shuttingDown = false;

    // P3-07 explicit override: caller-provided isRelayLeader bypasses LeaderElection.
    if (this.options.isRelayLeader) {
      this._leader = await Promise.resolve(this.options.isRelayLeader());
      if (this._leader) this.startRelayTimer();
      return;
    }

    if (this.skipLeaderElection) {
      this._leader = true;
      this.startRelayTimer();
      return;
    }

    await this.leaderElection.start({
      onBecomeLeader: async () => {
        this._leader = true;
        this.startRelayTimer();
      },
      onLoseLeadership: async () => {
        this._leader = false;
        this.stopRelayTimer();
      },
    });
  }

  private startRelayTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.inflightTimer = this.inflightTimer.then(() => this.onTimerTick());
    }, this.pollIntervalMs);
  }

  private stopRelayTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async onTimerTick(): Promise<void> {
    if (this.shuttingDown) return;
    if (this.relayLock) return;
    this.relayLock = true;
    try {
      await this.relayOnce();
    } catch (e) {
      if (!isTransientRelayErr(e)) {
        console.error('[OutboxRelayService] relay tick error', e);
      }
    } finally {
      this.relayLock = false;
    }
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    this.stopRelayTimer();
    await this.inflightTimer;
    this._leader = false;
    try {
      await this.leaderElection.stop();
    } catch {
      /* leader Redis 未接线时可忽略 */
    }
  }

  async emit(row: OutboxEventRow): Promise<void> {
    if (!this._dispatcher) {
      throw new Error('OutboxRelayService.emit: relay not started (call start() first)');
    }
    await this._dispatcher.dispatch(row);
  }

  private pool(): Pool {
    if (this.options.mysqlPool) return this.options.mysqlPool;
    if (!this.lazyPool) this.lazyPool = createPoolFromEnv();
    return this.lazyPool;
  }

  async relayOnce(): Promise<void> {
    if (!this._dispatcher) return;
    if (!this._leader) return;

    const pool = this.pool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const sql = `
        SELECT
          id, tenant, channel, event_type, payload_json, target,
          status, attempts, last_error,
          schedule_time, publish_time, next_attempt_time,
          deleted,
          create_by, creator_id, creator_type, create_time,
          update_by, updater_id, updater_type, update_time
        FROM outbox_events
        WHERE status = 'PENDING'
          AND deleted = 0
          AND schedule_time <= NOW(3)
          AND (next_attempt_time IS NULL OR next_attempt_time <= NOW(3))
        ORDER BY id ASC
        LIMIT ?
        FOR UPDATE SKIP LOCKED
      `;

      const [rows] = await conn.query<RowDataPacket[]>(sql, [this.batchSize]);

      if (rows.length === 0) {
        await conn.commit();
        return;
      }

      const pending: OutboxEventRow[] = rows.map(mapDbRow);

      const byChannel = new Map<string, OutboxEventRow[]>();
      for (const row of pending) {
        const list = byChannel.get(row.channel) ?? [];
        list.push(row);
        byChannel.set(row.channel, list);
      }

      for (const [, batch] of byChannel) {
        await this.dispatchUnderTx(conn, batch);
      }

      await conn.commit();
    } catch (e) {
      try {
        await conn.rollback();
      } catch {
        /* Preserve the original relay failure; rollback may fail after the socket closes. */
      }
      throw e;
    } finally {
      try {
        conn.release();
      } catch {
        /* already released / closed */
      }
    }
  }

  /** 单连接事务内：dispatch + 状态回写，行锁直到 commit 才释放。 */
  private async dispatchUnderTx(conn: PoolConnection, rows: OutboxEventRow[]): Promise<void> {
    for (const row of rows) {
      const t0 = performance.now();
      try {
        await this._dispatcher!.dispatch(row);
        await this.markPublishedConn(conn, row);
        this.metrics.dispatchTotal += 1;
        this.metrics.dispatchSuccess += 1;
      } catch (e) {
        await this.markFailedConn(conn, row, e);
        this.metrics.dispatchTotal += 1;
        this.metrics.dispatchFailure += 1;
      } finally {
        this.metrics.lastDispatchMs = Math.round(performance.now() - t0);
      }
    }
  }

  private async markPublishedConn(conn: PoolConnection, row: OutboxEventRow): Promise<void> {
    await conn.query(
      `
      UPDATE outbox_events SET
        status = 'PUBLISHED',
        publish_time = NOW(3),
        update_by = 'outbox_relay',
        updater_id = NULL,
        updater_type = 'SYSTEM',
        update_time = NOW(3)
      WHERE id = ?
        AND status = 'PENDING'
    `,
      [row.id],
    );
  }

  private async markFailedConn(conn: PoolConnection, row: OutboxEventRow, err: unknown): Promise<void> {
    const nextAttempts = row.attempts + 1;
    const lastErr      = truncateErr(err);

    if (nextAttempts >= 10) {
      await conn.query(
        `
        UPDATE outbox_events SET
          attempts = ?,
          last_error = ?,
          status = 'DEAD',
          update_by = 'outbox_relay',
          updater_id = NULL,
          updater_type = 'SYSTEM',
          update_time = NOW(3)
        WHERE id = ?
          AND status = 'PENDING'
      `,
        [nextAttempts, lastErr, row.id],
      );
      this.metrics.deadTotal += 1;
    } else {
      const delay = backoffMsAfterFailure(nextAttempts);
      const nextAttemptTime = new Date(Date.now() + delay);
      await conn.query(
        `
        UPDATE outbox_events SET
          attempts = ?,
          last_error = ?,
          status = 'PENDING',
          next_attempt_time = ?,
          update_by = 'outbox_relay',
          updater_id = NULL,
          updater_type = 'SYSTEM',
          update_time = NOW(3)
        WHERE id = ?
          AND status = 'PENDING'
      `,
        [nextAttempts, lastErr, nextAttemptTime, row.id],
      );
    }
  }

  getOptions(): Readonly<OutboxRelayServiceOptions> {
    return this.options;
  }
}

export type { OutboxRelayOptions };
