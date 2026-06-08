import { afterEach, describe, expect, test } from 'bun:test';
import { createSessionRedis, resolveSessionRedisUrl } from './session-redis';

const ORIGINAL_ENV = {
  AGENTIC_ENGINE_REDIS_URL: process.env.AGENTIC_ENGINE_REDIS_URL,
  REDIS_URL: process.env.REDIS_URL,
  BUN_REDIS_URL: process.env.BUN_REDIS_URL,
};

function restoreRedisEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearRedisEnv(): void {
  delete process.env.AGENTIC_ENGINE_REDIS_URL;
  delete process.env.REDIS_URL;
  delete process.env.BUN_REDIS_URL;
}

afterEach(() => {
  restoreRedisEnv();
});

describe('resolveSessionRedisUrl', () => {
  test('prefers AGENTIC_ENGINE_REDIS_URL', () => {
    clearRedisEnv();
    process.env.AGENTIC_ENGINE_REDIS_URL = 'redis://127.0.0.1:6380/1';
    process.env.REDIS_URL = 'redis://127.0.0.1:6381/2';

    expect(resolveSessionRedisUrl()).toBe('redis://127.0.0.1:6380/1');
  });

  test('falls back to REDIS_URL for compose-style local env files', () => {
    clearRedisEnv();
    process.env.REDIS_URL = 'redis://127.0.0.1:6381/2';

    expect(resolveSessionRedisUrl()).toBe('redis://127.0.0.1:6381/2');
  });

  test('falls back to BUN_REDIS_URL', () => {
    clearRedisEnv();
    process.env.BUN_REDIS_URL = 'redis://127.0.0.1:6382/3';

    expect(resolveSessionRedisUrl()).toBe('redis://127.0.0.1:6382/3');
  });

  test('returns null when no Redis URL is configured', () => {
    clearRedisEnv();

    expect(resolveSessionRedisUrl()).toBeNull();
  });
});

describe('createSessionRedis', () => {
  test('creates a lazy client from REDIS_URL fallback', () => {
    clearRedisEnv();
    process.env.REDIS_URL = 'redis://127.0.0.1:6381/2';

    const redis = createSessionRedis();
    try {
      expect(redis).not.toBeNull();
      expect(redis?.status).toBe('wait');
      expect(redis?.options.port).toBe(6381);
      expect(redis?.options.db).toBe(2);
    } finally {
      redis?.disconnect();
    }
  });
});
