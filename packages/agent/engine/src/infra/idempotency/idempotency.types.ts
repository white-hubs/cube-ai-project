/**
 * Idempotency types (ARCH §5 G-10 / T13-G10).
 *
 * Cache contract used by `idempotencyMiddleware`:
 *  - `get/set` persist the rendered response of a successful first-write so
 *    a subsequent retry with the same `Idempotency-Key` can replay it
 *    bit-for-bit.
 *  - `acquireLock/releaseLock` guard against concurrent in-flight duplicates
 *    (a second request arriving while the first is still computing).
 *
 * The contract is intentionally Redis-shaped (TTL semantics, SET NX) but the
 * interface stays storage-agnostic so unit tests can plug an in-memory fake.
 *
 * ref: docs/detailed-design/00-foundations/naming-and-db-conventions.md §10
 *      ARCH.md §5 G-10
 */

/** Cached request fingerprint + rendered response. */
export interface IdempotencyEntry {
  /** Captured HTTP status of the first successful response. */
  status: number;
  /** Captured response body, already serialized as text. */
  bodyJson: string;
  /** Selected response headers preserved for replay (currently `Content-Type`). */
  headersJson: string;
  /** Epoch ms of when the entry was written. */
  createdAt: number;
  /** sha256(rawRequestBody) — defends against `Idempotency-Key` reuse with a different payload. */
  bodyHash: string;
}

/** Storage port for idempotency state. */
export interface IdempotencyStore {
  /** Returns the cached entry or `null` when missing / malformed. */
  get(key: string): Promise<IdempotencyEntry | null>;
  /** Set with TTL (default 24h = 86_400 s). */
  set(key: string, entry: IdempotencyEntry, ttlSeconds: number): Promise<void>;
  /**
   * Acquire an in-flight lock (SET NX with short TTL, e.g. 30 s).
   * Returns `true` when this caller is the leader — others must back off.
   */
  acquireLock(key: string, ttlSeconds: number): Promise<boolean>;
  /** Release the lock — best-effort; safe to call even if not the leader. */
  releaseLock(key: string): Promise<void>;
}
