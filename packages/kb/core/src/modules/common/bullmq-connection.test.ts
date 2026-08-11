import { describe, expect, test } from "bun:test";

import { buildKbBullMqConnectionFromEnv, resolveKbRedisUrl } from "./bullmq-connection";

describe("KB BullMQ Redis configuration", () => {
  test("uses the repository-standard REDIS_URL when the engine-specific URL is absent", () => {
    expect(resolveKbRedisUrl({ REDIS_URL: "redis://cache.internal:6380/5" })).toBe("redis://cache.internal:6380/5");
    expect(buildKbBullMqConnectionFromEnv({ REDIS_URL: "redis://cache.internal:6380/5" })).toEqual({
      db: 5,
      host: "cache.internal",
      maxRetriesPerRequest: null,
      port: 6380,
    });
  });

  test("keeps AGENTIC_ENGINE_REDIS_URL as the highest-priority override", () => {
    expect(
      resolveKbRedisUrl({
        AGENTIC_ENGINE_REDIS_URL: "redis://engine.internal:6379/2",
        BUN_REDIS_URL: "redis://bun.internal:6379/4",
        REDIS_URL: "redis://shared.internal:6379/3",
      }),
    ).toBe("redis://engine.internal:6379/2");
  });

  test("supports credentials, TLS, BUN_REDIS_URL compatibility and local fallback", () => {
    expect(buildKbBullMqConnectionFromEnv({ BUN_REDIS_URL: "rediss://user:p%40ss@cache.internal:6380/7" })).toEqual({
      db: 7,
      host: "cache.internal",
      maxRetriesPerRequest: null,
      password: "p@ss",
      port: 6380,
      tls: {},
      username: "user",
    });
    expect(resolveKbRedisUrl({})).toBe("redis://127.0.0.1:6379/0");
  });
});
