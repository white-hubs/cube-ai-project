import Redis, { type RedisOptions } from 'ioredis';

/**
 * Short-lived Redis client for integration tests — suppresses ioredis
 * `Unhandled error event` noise when Testcontainers stop.
 */
export function createTestRedisClient(
  url: string,
  options?: RedisOptions,
): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    ...options,
  });
  client.on('error', () => {
    /* container teardown / reconnect noise */
  });
  return client;
}
