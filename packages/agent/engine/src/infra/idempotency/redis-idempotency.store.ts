/**
 * Redis-backed implementation of {@link IdempotencyStore} (T13-G10).
 *
 * Key naming follows the Phase 1 convention (`agentic:engine:<bc>:<purpose>:…`)
 * defined in `naming-and-db-conventions.md` §6.4 — a fully qualified prefix
 * keeps idempotency state isolated from auth-token / turn-lock state on a
 * shared Redis instance.
 *
 * Graceful degradation:
 *  - When `AGENTIC_ENGINE_REDIS_URL` is unset the injected client is `null`
 *    (Wave 2 T09 contract). All operations become best-effort no-ops:
 *      * `get` → null (cache miss)
 *      * `set` → no-op (entry not persisted)
 *      * `acquireLock` → `true` (assume leader; degraded mode loses
 *        cross-process exclusion, but the engine still serves traffic)
 *      * `releaseLock` → no-op
 *  - This mirrors `oauth2-introspection.middleware.ts` and `turn-lock.service.ts`
 *    which both treat `Redis | null` as a first-class state.
 */
import { Injectable, Inject } from '@dangao/bun-server';
import type Redis from 'ioredis';
import { REDIS_CLIENT_TOKEN } from '../../bc/session/session.tokens';
import type { IdempotencyEntry, IdempotencyStore } from './idempotency.types';

const KEY_PREFIX = 'agentic:engine:idem:';
const LOCK_PREFIX = 'agentic:engine:idem:lock:';

@Injectable()
export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis | null,
  ) {}

  async get(key: string): Promise<IdempotencyEntry | null> {
    if (!this.redis) return null;
    let raw: string | null;
    try {
      raw = await this.redis.get(KEY_PREFIX + key);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as IdempotencyEntry;
      if (
        typeof parsed.status === 'number' &&
        typeof parsed.bodyJson === 'string' &&
        typeof parsed.headersJson === 'string' &&
        typeof parsed.createdAt === 'number' &&
        typeof parsed.bodyHash === 'string'
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  async set(
    key: string,
    entry: IdempotencyEntry,
    ttlSeconds: number,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        KEY_PREFIX + key,
        JSON.stringify(entry),
        'EX',
        Math.max(1, Math.floor(ttlSeconds)),
      );
    } catch {
      // Best-effort cache write — never fail the request because the
      // idempotency entry could not be persisted.
    }
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this.redis) return true;
    try {
      const r = await this.redis.set(
        LOCK_PREFIX + key,
        '1',
        'EX',
        Math.max(1, Math.floor(ttlSeconds)),
        'NX',
      );
      return r === 'OK';
    } catch {
      // Treat Redis errors as "open lock" — slightly more permissive than
      // strictly correct, but degrades to the same behaviour as Redis-missing.
      return true;
    }
  }

  async releaseLock(key: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(LOCK_PREFIX + key);
    } catch {
      // Best-effort — lock will expire via TTL anyway.
    }
  }
}
