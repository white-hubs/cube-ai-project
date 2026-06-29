import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { debugBodyField, isTurnDebugLogEnabled, serializeDebugBody } from "./turn-debug-log";

const ENV_KEYS = ["AGENTIC_ENGINE_LOG_LEVEL", "LOG_LEVEL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe("isTurnDebugLogEnabled", () => {
  test("default info → false", () => {
    delete process.env.AGENTIC_ENGINE_LOG_LEVEL;
    delete process.env.LOG_LEVEL;
    expect(isTurnDebugLogEnabled()).toBe(false);
  });

  test("debug / trace → true", () => {
    process.env.AGENTIC_ENGINE_LOG_LEVEL = "debug";
    expect(isTurnDebugLogEnabled()).toBe(true);
  });
});

describe("debugBodyField", () => {
  test("info level → undefined", () => {
    process.env.AGENTIC_ENGINE_LOG_LEVEL = "info";
    expect(debugBodyField("promptBody", "hello")).toBeUndefined();
  });

  test("debug level → serialized body", () => {
    process.env.AGENTIC_ENGINE_LOG_LEVEL = "debug";
    const out = debugBodyField("responseBody", { content: "ok", toolCalls: [] });
    expect(out?.responseBody).toContain('"content":"ok"');
    expect(out?.responseBodyTruncated).toBe(false);
  });
});

describe("serializeDebugBody", () => {
  test("truncates oversized payload", () => {
    const out = serializeDebugBody({ blob: "x".repeat(60_000) }, 50_000);
    expect(out.bodyTruncated).toBe(true);
    expect(out.body).toContain("[truncated");
  });
});
