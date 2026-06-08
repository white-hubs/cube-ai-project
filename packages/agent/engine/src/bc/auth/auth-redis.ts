/**
 * Lazy singleton Redis client for AuthN token cache + Auth BC DI.
 *
 * ref: oauth2-flow.md §4 Redis 键 — `agentic:engine:auth:token:{sha256}`
 * R24: no connect() at module load — ioredis lazyConnect until first command.
 */
import Redis from 'ioredis';

let shared: Redis | null | undefined;

export function getAuthRedisClient(): Redis | null {
  const url = process.env['AGENTIC_ENGINE_REDIS_URL'];
  if (!url) {
    shared = null;
    return null;
  }
  if (shared === undefined) {
    shared = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  }
  return shared;
}
