/**
 * Publicly-visible SSE drain modes, emitted via the `drain.mode` system
 * event (E13 in 01-api/session.md §15).
 *
 * - `running`   — normal operation.
 * - `paused`    — engine is about to roll over; new turns rejected, existing
 *                 streams continue to completion.
 * - `finalize`  — engine has entered final shutdown window; clients should
 *                 reconnect via `Last-Event-ID` to the replacement replica.
 */
export type DrainMode = "running" | "paused" | "finalize";

/**
 * Replay buffer entry produced by the SSE decorator when a stream emits an
 * event. Stored per-session, bounded by size / count in the Outbox-owned
 * snapshot store (see outbox-ext).
 *
 * `eventId` MUST be monotonic within a session so the client can resume
 * via the `Last-Event-ID` HTTP header.
 */
export interface ReplayBufferEntry {
  eventId: string;
  event: string;
  /** `lowercase-kebab-v{N}` — see regulation §5.2 example. */
  schema: string;
  /** Opaque JSON payload; envelope MUST already include `schema`. */
  payload: unknown;
  /** epoch ms — regulation §R4. */
  time: number;
}

/** Tenant + session scope for Redis key `agentic:engine:sse:replay:{tenant}:{sessionId}` (P3-06). */
export interface ReplayBufferScope {
  tenant: number;
  sessionId: string;
}

/**
 * Pluggable storage abstraction for replay buffers. The built-in
 * implementation stores in-process; engine overrides with a Redis-backed
 * provider when available.
 */
export interface ReplayBufferStore {
  append(scope: ReplayBufferScope, entry: ReplayBufferEntry): Promise<void>;
  /**
   * Return entries whose `eventId > lastEventId`, ordered ascending.
   *
   * When `turnId` is provided, additionally filter to entries whose
   * `eventId` starts with `${turnId}:` (event id format
   * `{turnId}:{seq6}` — see `concurrency-and-replay.md §3.1`). Used by
   * `GET /v1/sessions/:sessionId/events?turnId=...` so per-turn SSE
   * streams aren't flooded with cross-turn history (ADR-0022 §D5.1.v2).
   */
  since(scope: ReplayBufferScope, lastEventId: string | null, turnId?: string): Promise<ReplayBufferEntry[]>;
  clear(scope: ReplayBufferScope): Promise<void>;
  /**
   * After session close: Redis key TTL 24h then auto-delete (P3-06).
   * Optional — no-op for in-memory store.
   */
  expireAfterSessionClose?(scope: ReplayBufferScope): Promise<void>;
}
