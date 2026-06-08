/**
 * Rate-limit types (ARCH §5 G-8 / T13-G8).
 *
 * Token bucket on Redis: capacity-bound burst tolerance with sustained
 * `refillRate` tokens/second. Decisions are surfaced as
 * `{allowed, remaining, resetSeconds}` so the middleware can:
 *   - short-circuit on `allowed = false` with HTTP 429
 *   - emit `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers
 *
 * The interface is storage-agnostic (single `check(key, cfg)` method) so the
 * middleware can be unit-tested against a fake limiter.
 *
 * ref: ARCH.md §5 G-8
 */

export interface RateLimitConfig {
  /** Token-bucket capacity (max burst). */
  capacity: number;
  /** Tokens refilled per second (sustained rate). */
  refillRate: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Tokens left in the bucket after this request (floor). */
  remaining: number;
  /**
   * Seconds until the bucket is full again (ceiling). Used for
   * `Retry-After` / `X-RateLimit-Reset`.
   */
  resetSeconds: number;
}

export interface RateLimiter {
  check(key: string, cfg: RateLimitConfig): Promise<RateLimitDecision>;
}
