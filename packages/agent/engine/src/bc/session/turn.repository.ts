import { Inject, Injectable } from '@dangao/bun-server';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL_TOKEN } from './session.tokens';

const ENGINE_ACTOR = 'engine';

/**
 * Turn row persistence — `turns` table (mysql-tables.md §7).
 */
@Injectable()
export class TurnRepository {
  constructor(@Inject(MYSQL_POOL_TOKEN) private readonly pool: Pool | null) {}

  requirePool(): Pool {
    if (!this.pool) {
      throw new Error(
        'MYSQL_POOL_TOKEN: AGENTIC_ENGINE_MYSQL_URL not configured — ref P1-06 §8',
      );
    }
    return this.pool;
  }

  /**
   * Insert RUNNING turn with turn_no allocated under transaction (session-local serial).
   */
  async insertRunningTurn(input: {
    turnId: string;
    tenant: number;
    sessionId: string;
    idempotencyKey: string | null;
    inputEnvelope: unknown;
    /** SFID — 与 SSE turn-started-v1.userMessageId 一致 */
    userMessageId: string;
    /** 本轮用户可见文本（写入 messages.seq=0） */
    userPromptText: string;
    /** 原始用户消息内容（支持 text + image_ref） */
    userContentJson?: unknown;
    /** 用户消息附件数组 */
    attachmentsJson?: unknown;
  }): Promise<number> {
    const p = this.requirePool();
    const now = new Date();
    const sid = BigInt(input.sessionId);
    const tid = BigInt(input.turnId);
    const uid = BigInt(input.userMessageId);
    const userContentJson = JSON.stringify(
      input.userContentJson ?? [{ type: 'text', text: input.userPromptText }],
    );
    const attachmentsJson = JSON.stringify(input.attachmentsJson ?? []);

    const conn = await p.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT COALESCE(MAX(turn_no), 0) AS m FROM turns
         WHERE session_id = ? AND deleted = 0 FOR UPDATE`,
        [sid],
      );
      const turnNo = Number((rows[0] as { m: number }).m ?? 0) + 1;

      await conn.execute(
      `INSERT INTO turns (
        id, tenant, session_id, turn_no, status,
        input_envelope_json, pipeline_trace_json, token_usage_json, error_json,
        idempotency_key, start_time, close_time, deleted,
        create_by, creator_id, creator_type, create_time,
        update_by, updater_id, updater_type, update_time
      ) VALUES (
        ?, ?, ?, ?, 'RUNNING',
        CAST(? AS JSON), NULL, NULL, NULL,
        ?, ?, NULL, 0,
        ?, NULL, 'SYSTEM', ?,
        ?, NULL, 'SYSTEM', ?
      )`,
        [
          tid,
          input.tenant,
          sid,
          turnNo,
          JSON.stringify(input.inputEnvelope),
          input.idempotencyKey,
          now,
          ENGINE_ACTOR,
          now,
          ENGINE_ACTOR,
          now,
        ],
      );

      await conn.execute(
        `INSERT INTO messages (
        id, tenant, session_id, turn_id, seq, role, content_json, attachments_json, tool_call_id,
          deleted,
          create_by, creator_id, creator_type, create_time,
          update_by, updater_id, updater_type, update_time
        ) VALUES (
        ?, ?, ?, ?, 0, 'user', CAST(? AS JSON), CAST(? AS JSON), NULL,
          0,
          ?, NULL, 'SYSTEM', ?,
          ?, NULL, 'SYSTEM', ?
        )`,
        [
          uid,
          input.tenant,
          sid,
          tid,
          userContentJson,
          attachmentsJson,
          ENGINE_ACTOR,
          now,
          ENGINE_ACTOR,
          now,
          ENGINE_ACTOR,
          now,
        ],
      );

      await conn.commit();
      return turnNo;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async updatePipelineSnapshotBinding(
    turnId: string,
    tenant: number,
    snapshotBinding: unknown,
  ): Promise<void> {
    const p = this.requirePool();
    const tid = BigInt(turnId);
    const trace = JSON.stringify({
      schema: 'pipeline-trace-v1',
      snapshotBinding,
      phases: [],
    });
    await p.execute(
      `UPDATE turns SET pipeline_trace_json = CAST(? AS JSON), update_time = ?, update_by = ?
       WHERE id = ? AND tenant = ? AND deleted = 0`,
      [trace, new Date(), ENGINE_ACTOR, tid, tenant],
    );
  }

  async getTurnRow(
    turnId: string,
    tenant: number,
  ): Promise<{
    sessionId: string;
    status: string;
    pipelineTrace: unknown | null;
  } | null> {
    const p = this.requirePool();
    const tid = BigInt(turnId);
    const [rows] = await p.execute<RowDataPacket[]>(
      `SELECT session_id, status,
              pipeline_trace_json AS pipeline_trace
       FROM turns WHERE id = ? AND tenant = ? AND deleted = 0`,
      [tid, tenant],
    );
    if (rows.length === 0) return null;
    const row = rows[0] as {
      session_id: bigint;
      status: string;
      pipeline_trace: string | null;
    };
    let pipelineTrace: unknown | null = null;
    if (row.pipeline_trace) {
      try {
        pipelineTrace =
          typeof row.pipeline_trace === 'string'
            ? JSON.parse(row.pipeline_trace)
            : row.pipeline_trace;
      } catch {
        pipelineTrace = null;
      }
    }
    return {
      sessionId: String(row.session_id),
      status: row.status,
      pipelineTrace,
    };
  }

  async completeTurn(input: {
    turnId: string;
    tenant: number;
    tokenUsage: { input: number; output: number; total: number };
    finalMessageId: string;
  }): Promise<void> {
    const p = this.requirePool();
    const tid = BigInt(input.turnId);
    const now = new Date();
    const usage = JSON.stringify({
      schema: 'token-usage-v1',
      input: input.tokenUsage.input,
      output: input.tokenUsage.output,
      total: input.tokenUsage.total,
      finalMessageId: input.finalMessageId,
    });
    await p.execute(
      `UPDATE turns SET
        status = 'CLOSED',
        close_time = ?,
        token_usage_json = CAST(? AS JSON),
        update_time = ?, update_by = ?
       WHERE id = ? AND tenant = ? AND deleted = 0 AND status = 'RUNNING'`,
      [now, usage, now, ENGINE_ACTOR, tid, input.tenant],
    );
  }

  async cancelTurn(input: {
    turnId: string;
    tenant: number;
    _reason?: string;
  }): Promise<void> {
    const p = this.requirePool();
    const tid = BigInt(input.turnId);
    const now = new Date();
    await p.execute(
      `UPDATE turns SET
        status = 'CANCELLED',
        close_time = ?,
        update_time = ?, update_by = ?
       WHERE id = ? AND tenant = ? AND deleted = 0 AND status = 'RUNNING'`,
      [now, now, ENGINE_ACTOR, tid, input.tenant],
    );
  }

  async markTurnError(input: {
    turnId: string;
    tenant: number;
    errorCode: string;
    message: string;
  }): Promise<void> {
    const p = this.requirePool();
    const tid = BigInt(input.turnId);
    const now = new Date();
    const errJson = JSON.stringify({
      code: input.errorCode,
      message: input.message,
    });
    await p.execute(
      `UPDATE turns SET
        status = 'ERROR',
        close_time = ?,
        error_json = CAST(? AS JSON),
        update_time = ?, update_by = ?
       WHERE id = ? AND tenant = ? AND deleted = 0 AND status = 'RUNNING'`,
      [now, errJson, now, ENGINE_ACTOR, tid, input.tenant],
    );
  }
}
