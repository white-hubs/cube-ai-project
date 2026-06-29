import { describe, expect, test } from "bun:test";

import { UsageEventRowSchema, UsageEventTypeSchema, UsageOutcomeSchema } from "./event-row";

/**
 * Unit tests for UsageEventRow schema.
 * Ref: docs/technical-design/phase-1/P1-03-data-outbox.md §7
 *      docs/detailed-design/09-usage-events/README.md §5.1
 */

const BASE_AUDIT = {
  createBy: "usage_consumer",
  createTime: Date.now(),
  creatorId: "usage_consumer",
  creatorType: "SYSTEM" as const,
  deleted: 0,
  tenant: 1001,
  updateBy: "usage_consumer",
  updateTime: Date.now(),
  updaterId: "usage_consumer",
  updaterType: "SYSTEM" as const,
};

const VALID_LLM_ROW = {
  ...BASE_AUDIT,
  durationMs: 3400,
  errorCode: null,
  eventType: "usage.llm_call" as const,
  id: "1820345678901234500",
  inputTokens: 1840,
  jobId: null,
  model: "gpt-4o-mini",
  occurredTime: Date.now(),
  outcome: "COMPLETED" as const,
  outputTokens: 210,
  payloadJson: { schema: "usage.llm_call.v1" },
  provider: "OPENAI",
  sessionId: "1820345678900000000",
  toolCallId: null,
  toolRef: null,
  turnId: "1820345678900000000",
  userId: "u_abc123",
};

describe("UsageEventRowSchema", () => {
  test("parses a valid usage.llm_call row", () => {
    expect(UsageEventRowSchema.safeParse(VALID_LLM_ROW).success).toBe(true);
  });

  test("eventType is a closed set of 3 values", () => {
    expect(UsageEventTypeSchema.options).toHaveLength(3);
    expect(UsageEventTypeSchema.options).toEqual(expect.arrayContaining(["usage.llm_call", "usage.tool_call", "usage.job_duration"]));
  });

  test("eventType uses lowercase dot-notation (regulation §5.2 exception)", () => {
    // Must NOT be SNAKE_CASE
    expect(UsageEventRowSchema.safeParse({ ...VALID_LLM_ROW, eventType: "USAGE_LLM_CALL" }).success).toBe(false);
    expect(UsageEventRowSchema.safeParse({ ...VALID_LLM_ROW, eventType: "usage.llm_call" }).success).toBe(true);
  });

  test("inputTokens and outputTokens must be >= 0", () => {
    expect(UsageEventRowSchema.safeParse({ ...VALID_LLM_ROW, inputTokens: -1 }).success).toBe(false);
    expect(UsageEventRowSchema.safeParse({ ...VALID_LLM_ROW, outputTokens: -1 }).success).toBe(false);
    expect(UsageEventRowSchema.safeParse({ ...VALID_LLM_ROW, inputTokens: 0, outputTokens: 0 }).success).toBe(true);
  });

  test("model is a string field", () => {
    expect(UsageEventRowSchema.safeParse({ ...VALID_LLM_ROW, model: "gpt-4o-2024-08-06" }).success).toBe(true);
    expect(UsageEventRowSchema.safeParse({ ...VALID_LLM_ROW, model: null }).success).toBe(true);
  });

  test("outcome enum values are SNAKE_CASE UPPERCASE", () => {
    const outcomes = UsageOutcomeSchema.options;
    expect(outcomes).toEqual(expect.arrayContaining(["COMPLETED", "FAILED", "CANCELLED"]));
    for (const o of outcomes) {
      expect(o).toMatch(/^[A-Z_]+$/u);
    }
  });

  test("occurredTime is epoch ms (non-negative integer)", () => {
    expect(UsageEventRowSchema.safeParse({ ...VALID_LLM_ROW, occurredTime: -1 }).success).toBe(false);
    expect(UsageEventRowSchema.safeParse({ ...VALID_LLM_ROW, occurredTime: 0 }).success).toBe(true);
  });
});
