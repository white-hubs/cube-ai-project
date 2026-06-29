import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { formatResultBodyForDebugLog, isToolInvokeDebugLogEnabled } from "./tool-invoke-debug-log";

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

describe("isToolInvokeDebugLogEnabled", () => {
  test("default info → false", () => {
    delete process.env.AGENTIC_ENGINE_LOG_LEVEL;
    delete process.env.LOG_LEVEL;
    expect(isToolInvokeDebugLogEnabled()).toBe(false);
  });

  test("debug / trace → true", () => {
    process.env.AGENTIC_ENGINE_LOG_LEVEL = "debug";
    expect(isToolInvokeDebugLogEnabled()).toBe(true);
    process.env.AGENTIC_ENGINE_LOG_LEVEL = "trace";
    expect(isToolInvokeDebugLogEnabled()).toBe(true);
  });
});

describe("formatResultBodyForDebugLog", () => {
  test("info level → undefined", () => {
    process.env.AGENTIC_ENGINE_LOG_LEVEL = "info";
    expect(formatResultBodyForDebugLog({ ok: true })).toBeUndefined();
  });

  test("debug level → full JSON MCP-style result", () => {
    process.env.AGENTIC_ENGINE_LOG_LEVEL = "debug";
    const result = {
      content: [{ type: "text", text: "view `ai_alarm_summary_view` doesn't exist" }],
      isError: false,
    };
    const out = formatResultBodyForDebugLog(result);
    expect(out?.resultBodyTruncated).toBe(false);
    expect(out?.resultBody).toContain("ai_alarm_summary_view");
  });

  test("oversized result → truncated marker", () => {
    process.env.AGENTIC_ENGINE_LOG_LEVEL = "debug";
    const out = formatResultBodyForDebugLog({ blob: "x".repeat(60_000) });
    expect(out?.resultBodyTruncated).toBe(true);
    expect(out?.resultBody).toContain("[truncated");
  });
});
