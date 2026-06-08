/**
 * IdempotencyModule — DI registration for {@link RedisIdempotencyStore} (T13-G10).
 *
 * Depends transitively on `SessionModule`'s `REDIS_CLIENT_TOKEN` provider —
 * Redis client is shared across BCs (auth, session, idempotency, rate-limit)
 * to avoid duplicate connections. The token is registered globally by
 * `SessionModule` so this module can `@Inject` it directly.
 *
 * Registered AFTER `SessionModule` in `EngineAssembler` so that
 * `REDIS_CLIENT_TOKEN` is resolvable at construction time.
 */
import { Module } from '@dangao/bun-server';
import { RedisIdempotencyStore } from './redis-idempotency.store';

@Module({
  providers: [RedisIdempotencyStore],
  exports: [RedisIdempotencyStore],
})
export class IdempotencyModule {}
