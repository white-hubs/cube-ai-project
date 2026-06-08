/**
 * RateLimitModule — DI registration for {@link RedisRateLimiter} (T13-G8).
 *
 * Depends transitively on `SessionModule`'s `REDIS_CLIENT_TOKEN` provider —
 * shared Redis client across BCs (auth, session, idempotency, rate-limit)
 * to avoid duplicate connections. Registered AFTER `SessionModule` in
 * `EngineAssembler` so the token resolves at construction time.
 */
import { Module } from '@dangao/bun-server';
import { RedisRateLimiter } from './redis-rate-limiter';

@Module({
  providers: [RedisRateLimiter],
  exports: [RedisRateLimiter],
})
export class RateLimitModule {}
