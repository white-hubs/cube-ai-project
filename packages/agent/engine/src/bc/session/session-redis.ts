import Redis from 'ioredis';

/**
 * Lazy Redis client for Session BC (Turn Lock + idempotency keys).
 * R24: `new Redis(url)` does not open a socket until the first command.
 *
 * ref: docs/detailed-design/05-session/concurrency-and-replay.md §2
 */
export function createSessionRedis(): Redis | null {
  const url = resolveSessionRedisUrl();
  if (!url) {
    return null;
  }
  return new Redis(url, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
}

export function resolveSessionRedisUrl(): string | null {
  const url =
    process.env['AGENTIC_ENGINE_REDIS_URL'] ??
    process.env['REDIS_URL'] ??
    process.env['BUN_REDIS_URL'] ??
    '';
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}
