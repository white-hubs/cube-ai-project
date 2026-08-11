import { describe, expect, test } from "bun:test";

import { resolveOutboxRedisUrl } from "./bullmq-enqueue.adapter";

describe("resolveOutboxRedisUrl", () => {
  test("uses the explicit argument before environment values", () => {
    expect(
      resolveOutboxRedisUrl(" redis://explicit:6379/4 ", {
        AGENTIC_ENGINE_REDIS_URL: "redis://engine:6379/3",
        REDIS_URL: "redis://standard:6379/2",
      }),
    ).toBe("redis://explicit:6379/4");
  });

  test("uses engine override, then repository-standard and Bun-compatible URLs", () => {
    expect(
      resolveOutboxRedisUrl(undefined, {
        AGENTIC_ENGINE_REDIS_URL: "redis://engine:6379/3",
        BUN_REDIS_URL: "redis://bun:6379/1",
        REDIS_URL: "redis://standard:6379/2",
      }),
    ).toBe("redis://engine:6379/3");
    expect(resolveOutboxRedisUrl(undefined, { BUN_REDIS_URL: "redis://bun:6379/1", REDIS_URL: "redis://standard:6379/2" })).toBe(
      "redis://standard:6379/2",
    );
    expect(resolveOutboxRedisUrl(undefined, { BUN_REDIS_URL: "redis://bun:6379/1" })).toBe("redis://bun:6379/1");
  });

  test("falls back to local Redis only when no configured URL exists", () => {
    expect(resolveOutboxRedisUrl(undefined, {})).toBe("redis://127.0.0.1:6379/0");
  });
});
