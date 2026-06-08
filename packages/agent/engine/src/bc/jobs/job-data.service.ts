/**
 * MySQL access for jobs / outbox / grants (Jobs BC).
 * Pool is lazy — first query opens connections (R24).
 *
 * ref: 06-jobs/README.md §3 / §4; authorization-gateway.md §7.2
 */
import { Injectable } from '@dangao/bun-server';
import type { OutboxEventRow, RuntimeRefs } from '@cube-ai/contracts';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import type { JobRow, MysqlConfig, GrantExpiryCandidateRow } from './job-data.types';
import type { JobStatusDb } from './job-data.types';

/** Parse `mysql://user:pass@host:3306/db` — password/database optional */
export function parseMysqlUrl(urlStr?: string): MysqlConfig {
  const raw =
    urlStr ??
    process.env['AGENTIC_ENGINE_MYSQL_URL'] ??
    'mysql://root@127.0.0.1:3306/agentic_engine';
  const u = new URL(raw);
  const database = u.pathname.replace(/^\//, '') || 'agentic_engine';
  return {
    host: u.hostname || '127.0.0.1',
    port: Number(u.port) || 3306,
    user: decodeURIComponent(u.username || 'root'),
    password: decodeURIComponent(u.password || ''),
    database,
  };
}

function rowBigintString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function mapJobRow(r: RowDataPacket): JobRow {
  const resultRefJson =
    r['result_ref_json'] == null
      ? null
      : typeof r['result_ref_json'] === 'string'
        ? r['result_ref_json']
        : JSON.stringify(r['result_ref_json']);
  const errorDetailJson =
    r['error_detail_json'] == null
      ? null
      : typeof r['error_detail_json'] === 'string'
        ? r['error_detail_json']
        : JSON.stringify(r['error_detail_json']);
  return {
    id: String(r['id']),
    tenant: Number(r['tenant']),
    sessionId: rowBigintString(r['session_id']),
    turnId: rowBigintString(r['turn_id']),
    toolCallId: r['tool_call_id'] != null ? String(r['tool_call_id']) : null,
    userId: r['user_id'] != null ? String(r['user_id']) : null,
    kind: String(r['kind']),
    toolRef: r['tool_ref'] != null ? String(r['tool_ref']) : null,
    queue: String(r['queue']),
    status: String(r['status']) as JobStatusDb,
    attempts: Number(r['attempts']),
    maxAttempts: Number(r['max_attempts']),
    timeoutMs: Number(r['timeout_ms']),
    overallDeadlineTime: new Date(r['overall_deadline_time']),
    inputSnapshotJson:
      typeof r['input_snapshot_json'] === 'string'
        ? r['input_snapshot_json']
        : JSON.stringify(r['input_snapshot_json']),
    principalSnapshotJson:
      typeof r['principal_snapshot_json'] === 'string'
        ? r['principal_snapshot_json']
        : JSON.stringify(r['principal_snapshot_json']),
    resultRefJson,
    errorCode: r['error_code'] != null ? String(r['error_code']) : null,
    errorDetailJson,
    requiresNotification: Boolean(r['requires_notification']),
    createTime: new Date(r['create_time']),
    updateTime: new Date(r['update_time']),
    startTime: r['start_time'] != null ? new Date(r['start_time']) : null,
    endTime: r['end_time'] != null ? new Date(r['end_time']) : null,
  };
}

function mapOutboxRow(x: RowDataPacket): OutboxEventRow {
  const payloadRaw = x['payload_json'];
  const payloadJson =
    typeof payloadRaw === 'string' ? JSON.parse(payloadRaw) : payloadRaw;
  const tenant = Number(x['tenant']);
  const deletedRaw = x['deleted'];
  const deleted =
    typeof deletedRaw === 'bigint'
      ? deletedRaw
      : BigInt(String(deletedRaw ?? 0));

  return {
    tenant,
    deleted,
    createBy: String(x['create_by']),
    creatorId: x['creator_id'] != null ? String(x['creator_id']) : null,
    creatorType:
      x['creator_type'] === 'USER' ||
      x['creator_type'] === 'SERVICE' ||
      x['creator_type'] === 'SYSTEM'
        ? x['creator_type']
        : null,
    createTime: new Date(x['create_time']).getTime(),
    updateBy: String(x['update_by']),
    updaterId: x['updater_id'] != null ? String(x['updater_id']) : null,
    updaterType:
      x['updater_type'] === 'USER' ||
      x['updater_type'] === 'SERVICE' ||
      x['updater_type'] === 'SYSTEM'
        ? x['updater_type']
        : null,
    updateTime: new Date(x['update_time']).getTime(),
    id: String(x['id']),
    channel: x['channel'],
    eventType: String(x['event_type']),
    payloadJson,
    target: x['target'] != null ? String(x['target']) : null,
    status: x['status'],
    attempts: Number(x['attempts']),
    lastError: x['last_error'] != null ? String(x['last_error']) : null,
    scheduleTime: new Date(x['schedule_time']).getTime(),
    publishTime:
      x['publish_time'] != null ? new Date(x['publish_time']).getTime() : null,
    nextAttemptTime:
      x['next_attempt_time'] != null
        ? new Date(x['next_attempt_time']).getTime()
        : null,
  };
}

@Injectable()
export class JobDataService {
  private pool: Pool | null = null;

  /** Lazy pool — no socket at construct time (R24). */
  private getPool(): Pool {
    if (!this.pool) {
      const cfg = parseMysqlUrl();
      // SFID 等 BIGINT 超过 JS 安全整数，必须以字符串返回以保留精度
      this.pool = createPool({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password || undefined,
        database: cfg.database,
        waitForConnections: true,
        connectionLimit: 10,
        supportBigNumbers: true,
        bigNumberStrings: true,
      });
    }
    return this.pool;
  }

  async findJobById(jobId: string): Promise<JobRow | null> {
    const [rows] = await this.getPool().query<RowDataPacket[]>(
      `SELECT * FROM jobs WHERE id = ? AND deleted = 0 LIMIT 1`,
      [jobId],
    );
    const r = rows[0];
    return r ? mapJobRow(r) : null;
  }

  async findJobByIdempotency(
    tenant: number,
    idempotencyKey: string,
  ): Promise<JobRow | null> {
    const [rows] = await this.getPool().query<RowDataPacket[]>(
      `SELECT * FROM jobs WHERE tenant = ? AND idempotency_key = ? AND deleted = 0 LIMIT 1`,
      [tenant, idempotencyKey],
    );
    const r = rows[0];
    return r ? mapJobRow(r) : null;
  }

  /** Load per-turn runtimeRefs for async tool jobs (knowledge authz). */
  async getTurnRuntimeRefs(
    turnId: string,
    tenant: number,
  ): Promise<RuntimeRefs | undefined> {
    const [rows] = await this.getPool().query<RowDataPacket[]>(
      `SELECT input_envelope_json AS input_envelope
       FROM turns WHERE id = ? AND tenant = ? AND deleted = 0 LIMIT 1`,
      [turnId, tenant],
    );
    const raw = rows[0]?.['input_envelope'];
    if (raw == null) return undefined;
    try {
      const envelope =
        typeof raw === 'string' ? (JSON.parse(raw) as { runtimeRefs?: RuntimeRefs }) : raw;
      return envelope?.runtimeRefs;
    } catch {
      return undefined;
    }
  }

  async loadOutboxRowAsContract(id: string): Promise<OutboxEventRow | null> {
    const [rows] = await this.getPool().query<RowDataPacket[]>(
      `SELECT * FROM outbox_events WHERE id = ? AND deleted = 0 LIMIT 1`,
      [id],
    );
    const x = rows[0];
    if (!x) return null;
    return mapOutboxRow(x);
  }

  async updateJobTerminal(
    jobId: string,
    status: 'COMPLETED' | 'FAILED' | 'CANCELLED',
    extras: {
      resultRef?: unknown;
      errorCode?: string;
      errorDetail?: unknown;
    },
  ): Promise<void> {
    const now = new Date();
    await this.getPool().query(
      `UPDATE jobs SET
        status = ?,
        end_time = ?,
        result_ref_json = ?,
        error_code = ?,
        error_detail_json = ?,
        update_time = ?,
        update_by = ?,
        updater_id = ?,
        updater_type = ?
      WHERE id = ? AND deleted = 0`,
      [
        status,
        now,
        extras.resultRef != null ? JSON.stringify(extras.resultRef) : null,
        extras.errorCode ?? null,
        extras.errorDetail != null ? JSON.stringify(extras.errorDetail) : null,
        now,
        'long-running-worker',
        'long-running-worker',
        'SYSTEM',
        jobId,
      ],
    );
  }

  async tryMarkJobRunning(jobId: string): Promise<boolean> {
    const now = new Date();
    const [res] = await this.getPool().query(
      `UPDATE jobs SET
        status = 'RUNNING',
        attempts = attempts + 1,
        start_time = COALESCE(start_time, ?),
        update_time = ?,
        update_by = ?,
        updater_id = ?,
        updater_type = ?
      WHERE id = ? AND status = 'QUEUED' AND deleted = 0`,
      [now, now, 'long-running-worker', 'long-running-worker', 'SYSTEM', jobId],
    );
    const affected = (res as { affectedRows?: number }).affectedRows ?? 0;
    return affected === 1;
  }

  async requeueJobAfterRetryableFailure(jobId: string): Promise<void> {
    const now = new Date();
    await this.getPool().query(
      `UPDATE jobs SET status = 'QUEUED', update_time = ?, update_by = ?, updater_id = ?, updater_type = ?
       WHERE id = ? AND deleted = 0`,
      [now, 'long-running-worker', 'long-running-worker', 'SYSTEM', jobId],
    );
  }

  async cancelJobDb(jobId: string): Promise<boolean> {
    const now = new Date();
    const [res] = await this.getPool().query(
      `UPDATE jobs SET status = 'CANCELLED', end_time = ?, update_time = ?, update_by = ?, updater_id = ?, updater_type = ?
       WHERE id = ? AND status IN ('QUEUED','RUNNING') AND deleted = 0`,
      [now, now, 'scheduler', 'scheduler', 'SYSTEM', jobId],
    );
    const affected = (res as { affectedRows?: number }).affectedRows ?? 0;
    return affected === 1;
  }

  async nextMessageSeqForTurn(turnId: string): Promise<number> {
    const [rows] = await this.getPool().query<RowDataPacket[]>(
      `SELECT COALESCE(MAX(seq), -1) AS s FROM messages WHERE turn_id = ? AND deleted = 0`,
      [turnId],
    );
    const s = rows[0]?.['s'];
    return Number(s) + 1;
  }

  async appendOutboxWithId(
    id: string,
    input: {
      tenant: number;
      channel: OutboxEventRow['channel'];
      eventType: string;
      payloadJson: unknown;
      target?: string | null;
    },
  ): Promise<void> {
    const now = new Date();
    await this.getPool().query(
      `INSERT INTO outbox_events (
        id, tenant, channel, event_type, payload_json, target, status, attempts,
        schedule_time, deleted,
        create_by, creator_id, creator_type, create_time,
        update_by, updater_id, updater_type, update_time
      ) VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, 'PENDING', 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.tenant,
        input.channel,
        input.eventType,
        JSON.stringify(input.payloadJson),
        input.target ?? null,
        now,
        'system',
        null,
        'SYSTEM',
        now,
        'system',
        null,
        'SYSTEM',
        now,
      ],
    );
  }

  async insertAssistantMessage(params: {
    id: string;
    tenant: number;
    sessionId: string;
    turnId: string;
    seq: number;
    contentJson: unknown;
    toolCallId?: string | null;
  }): Promise<void> {
    const now = new Date();
    await this.getPool().query(
      `INSERT INTO messages (
        id, tenant, session_id, turn_id, seq, role, content_json, tool_call_id,
        deleted,
        create_by, creator_id, creator_type, create_time,
        update_by, updater_id, updater_type, update_time
      ) VALUES (
        ?, ?, ?, ?, ?, 'assistant', CAST(? AS JSON), ?,
        0,
        ?, ?, ?, ?, ?, ?, ?, ?
      )`,
      [
        params.id,
        params.tenant,
        params.sessionId,
        params.turnId,
        params.seq,
        JSON.stringify(params.contentJson),
        params.toolCallId ?? null,
        'system',
        null,
        'SYSTEM',
        now,
        'system',
        null,
        'SYSTEM',
        now,
      ],
    );
  }

  async enqueueToolJobAndOutbox(params: {
    jobId: string;
    outboxEventId: string;
    tenant: number;
    queue: string;
    sessionId?: string | null;
    turnId?: string | null;
    toolCallId?: string | null;
    userId?: string | null;
    toolRef: string;
    inputSnapshot: unknown;
    principalSnapshot: unknown;
    idempotencyKey: string;
    overallDeadline: Date;
  }): Promise<void> {
    const now = new Date();
    const conn = await this.getPool().getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO jobs (
          id, tenant, session_id, turn_id, tool_call_id, user_id,
          kind, tool_ref, queue, status, attempts, max_attempts,
          timeout_ms, overall_deadline_time,
          input_snapshot_json, principal_snapshot_json,
          callback_event, requires_notification, idempotency_key, deleted,
          create_by, creator_id, creator_type, create_time,
          update_by, updater_id, updater_type, update_time
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          'TOOL', ?, ?, 'QUEUED', 0, 3,
          300000, ?,
          CAST(? AS JSON), CAST(? AS JSON),
          'job.completed', 1, ?, 0,
          ?, ?, ?, ?, ?, ?, ?, ?
        )`,
        [
          params.jobId,
          params.tenant,
          params.sessionId ?? null,
          params.turnId ?? null,
          params.toolCallId ?? null,
          params.userId ?? null,
          params.toolRef,
          params.queue,
          params.overallDeadline,
          JSON.stringify(params.inputSnapshot),
          JSON.stringify(params.principalSnapshot),
          params.idempotencyKey,
          'scheduler',
          null,
          'SYSTEM',
          now,
          'scheduler',
          null,
          'SYSTEM',
          now,
        ],
      );
      await conn.query(
        `INSERT INTO outbox_events (
          id, tenant, channel, event_type, payload_json, target, status, attempts,
          schedule_time, deleted,
          create_by, creator_id, creator_type, create_time,
          update_by, updater_id, updater_type, update_time
        ) VALUES (?, ?, 'bullmq_job', 'job.enqueued', CAST(? AS JSON), ?, 'PENDING', 0, ?, 0,
          ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          params.outboxEventId,
          params.tenant,
          JSON.stringify({
            jobId: params.jobId,
            toolRef: params.toolRef,
            tenant: params.tenant,
          }),
          params.queue,
          now,
          'scheduler',
          null,
          'SYSTEM',
          now,
          'scheduler',
          null,
          'SYSTEM',
          now,
        ],
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async selectGrantsExpiredBeforeNow(): Promise<GrantExpiryCandidateRow[]> {
    const [rows] = await this.getPool().query<RowDataPacket[]>(
      `SELECT id, tenant, subject_user_id AS subject_user_id
       FROM grants
       WHERE deleted = 0
         AND expire_time IS NOT NULL
         AND expire_time < UTC_TIMESTAMP(3)
         AND revoke_time IS NULL
       LIMIT 500`,
    );
    return rows.map((r) => ({
      id: String(r['id']),
      tenant: Number(r['tenant']),
      subjectUserId:
        r['subject_user_id'] != null ? String(r['subject_user_id']) : null,
    }));
  }

  async markGrantsExpired(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const [res] = await this.getPool().query(
      `UPDATE grants SET
        revoke_time = UTC_TIMESTAMP(3),
        update_time = UTC_TIMESTAMP(3),
        update_by = ?,
        updater_id = ?,
        updater_type = ?
       WHERE id IN (${placeholders}) AND deleted = 0`,
      ['grant-expire-worker', 'grant-expire-worker', 'SYSTEM', ...ids],
    );
    return (res as { affectedRows?: number }).affectedRows ?? 0;
  }
}
