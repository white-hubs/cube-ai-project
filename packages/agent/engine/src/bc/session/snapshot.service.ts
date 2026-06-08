import { Inject, Injectable } from '@dangao/bun-server';
import type { RowDataPacket } from 'mysql2/promise';
import { SnapshotDecision } from './snapshot-decision';
import { TurnRepository } from './turn.repository';
import { MYSQL_POOL_TOKEN, TURN_REPO_TOKEN } from './session.tokens';
import type { Pool } from 'mysql2/promise';

/**
 * In-memory session snapshot (loaded for a single Turn start).
 * ref: docs/detailed-design/05-session/snapshot-binding.md §2.3 / §2.5
 */
export interface SessionSnapshot {
  /** SFID of the session (string, regulation §4.1) */
  sessionId: string;
  agentSnapshotJson: unknown;
  userPrincipalSnapshotJson: unknown;
  /** epoch ms snapshot loaded at */
  loadedAtMs: number;
}

/**
 * Snapshot storage mode result.
 * ref: P1-06 design doc §3.3 / §4.2 · ADR-0012 §D2
 */
export type SnapshotStorageMode = 'inline' | 'external';

/**
 * SnapshotService — loads session snapshots + binds per-turn binding payload.
 * Turn-level binding lives in `turns.pipeline_trace_json.snapshotBinding` (§13 取舍).
 * ref: snapshot-binding.md §5 · P3-05 §3.3
 */
@Injectable()
export class SnapshotService {
  constructor(
    private readonly decision: SnapshotDecision,
    @Inject(MYSQL_POOL_TOKEN) private readonly pool: Pool | null,
    @Inject(TURN_REPO_TOKEN) private readonly turns: TurnRepository,
  ) {}

  /**
   * Load latest session snapshots from `sessions`.
   */
  async getLatestSnapshot(
    sessionId: string,
    tenant: number,
  ): Promise<SessionSnapshot | null> {
    if (!this.pool) return null;

    const sid = BigInt(sessionId);
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT agent_snapshot_json, user_principal_snapshot_json
       FROM sessions
       WHERE id = ? AND tenant = ? AND deleted = 0`,
      [sid, tenant],
    );
    if (rows.length === 0) return null;

    const row = rows[0] as {
      agent_snapshot_json: unknown;
      user_principal_snapshot_json: unknown;
    };

    return {
      sessionId,
      agentSnapshotJson: parseMaybeJson(row.agent_snapshot_json),
      userPrincipalSnapshotJson: parseMaybeJson(row.user_principal_snapshot_json),
      loadedAtMs: Date.now(),
    };
  }

  decideStorage(payload: object): SnapshotStorageMode {
    return this.decision.decide(payload);
  }

  /**
   * Persist ToolDescriptor / Provider / Memory refs for replay — stored under
   * `pipeline_trace_json.snapshotBinding` until `turns.snapshot_json` lands in DDL.
   */
  async bindSnapshot(
    turnId: string,
    tenant: number,
    snapshotJson: unknown,
  ): Promise<void> {
    this.turns.requirePool();
    await this.turns.updatePipelineSnapshotBinding(turnId, tenant, snapshotJson);
  }

  /** Read bound snapshot for a Turn (replay / audit). */
  async getSnapshot(turnId: string, tenant: number): Promise<unknown | null> {
    const row = await this.turns.getTurnRow(turnId, tenant);
    if (!row?.pipelineTrace || typeof row.pipelineTrace !== 'object') {
      return null;
    }
    const pt = row.pipelineTrace as Record<string, unknown>;
    const binding = pt['snapshotBinding'];
    return binding ?? null;
  }
}

function parseMaybeJson(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return v;
    }
  }
  return v;
}
