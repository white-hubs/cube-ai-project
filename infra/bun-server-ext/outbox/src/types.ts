/**
 * Core types for the Outbox extension.
 *
 * OutboxEventRow is re-exported from @cube-ai/contracts for convenience.
 * Internal extension types (relay options, etc.) are defined here.
 *
 * Aligned with:
 *   docs/detailed-design/06-jobs/README.md §4 (outbox_events DDL + channel enum)
 *   docs/technical-design/phase-1/P1-03-data-outbox.md §3.3
 */

export type {
  OutboxEventRow,
  OutboxChannel,
  OutboxStatus,
  AppendOutboxInput,
} from '@cube-ai/contracts';

/** Callback invoked once per row the Relay has dispatched from the outbox table. */
export type OutboxDispatcher = (row: import('@cube-ai/contracts').OutboxEventRow) => Promise<void>;

export interface OutboxRelayOptions {
  /**
   * Redis key used for leader election.
   * Default: `agentic:engine:outbox:leader`（P3-08 / redis-keys §3.8）
   * Ref: docs/detailed-design/02-data/redis-keys.md §3.8
   */
  leaderKey?: string;
  /** Leader TTL in ms; non-leaders retry when TTL elapses. Default: 30_000 */
  leaderTtlMs?: number;
  /** How often the leader polls the outbox table (ms). Default: 2_000 */
  pollIntervalMs?: number;
  /** Max rows pulled per poll to bound DB pressure. Default: 100 */
  batchSize?: number;
}

/**
 * Contract for the concrete Relay runtime.
 * P1-07 (Jobs) implements the full relay with MySQL FOR UPDATE SKIP LOCKED + Redis leader election.
 * This skeleton ships an in-memory no-op so startup/shutdown can be exercised.
 */
export interface OutboxRelay {
  /** Begin leader election + polling loop. */
  start(dispatcher: OutboxDispatcher): Promise<void>;
  /** Cooperative stop; MUST await in-flight dispatches. */
  stop(): Promise<void>;
  /** Current leader state for /health probes. */
  isLeader(): boolean;
}
