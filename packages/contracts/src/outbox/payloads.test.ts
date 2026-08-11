import { describe, expect, test } from "bun:test";

import {
  OutboxPayloadSchema,
  UsageJobDurationPayloadStrictSchema,
  UsageLlmCallPayloadSchema,
  UsageToolCallPayloadStrictSchema,
} from "./payloads";

/**
 * Unit tests for OutboxPayload discriminated union.
 * Ref: docs/technical-design/phase-1/P1-03-data-outbox.md §7
 *      docs/detailed-design/09-usage-events/outbox-contract.md §3-§5
 */

describe("OutboxPayloadSchema — discriminated union", () => {
  test("parses usage.llm_call.v1 by schema discriminant", () => {
    const payload = {
      durationMs: 1200,
      inputTokens: 100,
      model: "gpt-4o-mini",
      occurredTime: Date.now(),
      outcome: "COMPLETED",
      outputTokens: 50,
      provider: "OPENAI",
      schema: "usage.llm_call.v1",
      tenant: 1001,
    };
    const result = OutboxPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema).toBe("usage.llm_call.v1");
    }
  });

  test("parses usage.tool_call.v1 by schema discriminant", () => {
    const payload = {
      durationMs: 45,
      execution: "SYNC",
      occurredTime: Date.now(),
      outcome: "COMPLETED",
      schema: "usage.tool_call.v1",
      tenant: 1001,
      toolName: "platform.api.invoke",
      toolRef: "builtin:platform.api.invoke",
    };
    const result = OutboxPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  test("parses usage.job_duration.v1 by schema discriminant", () => {
    const payload = {
      attempts: 1,
      execDurationMs: 185500,
      finalStatus: "COMPLETED",
      jobId: "1820345678900000077",
      occurredTime: Date.now(),
      schema: "usage.job_duration.v1",
      tenant: 1001,
      toolName: "platform.flow.invoke",
      toolRef: "builtin:platform.flow.invoke",
      totalDurationMs: 186700,
      waitDurationMs: 1200,
    };
    const result = OutboxPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  test("parses grant.approve.v1 by schema discriminant", () => {
    const payload = {
      decision: "APPROVED",
      grantId: "1111111111111111111",
      grantRequestId: "2222222222222222222",
      occurredTime: Date.now(),
      schema: "grant.approve.v1",
      tenant: 1001,
      toolRef: "builtin:platform.api.invoke",
      userId: "u_abc123",
    };
    const result = OutboxPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  test("parses session.end.v1 by schema discriminant", () => {
    const payload = {
      occurredTime: Date.now(),
      reason: "USER_CLOSED",
      schema: "session.end.v1",
      sessionId: "3333333333333333333",
      tenant: 1001,
      userId: "u_abc123",
    };
    const result = OutboxPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  test("parses kb.vector.reconcile.v1 by schema discriminant", () => {
    const payload = {
      documentId: "101",
      occurredTime: Date.now(),
      reason: "FULL_INDEX",
      schema: "kb.vector.reconcile.v1",
    };
    const result = OutboxPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema).toBe("kb.vector.reconcile.v1");
    }
  });

  test("parses kb.ingest.v1 with optional forceFull hook", () => {
    const payload = {
      attempt: 1,
      documentId: "101",
      forceFull: true,
      importJobId: "202",
      occurredTime: Date.now(),
      schema: "kb.ingest.v1",
      tenantId: "tenant-a",
    };
    const result = OutboxPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema).toBe("kb.ingest.v1");
      if (result.data.schema === "kb.ingest.v1") {
        expect(result.data.forceFull).toBe(true);
        expect(result.data.importJobId).toBe("202");
      }
    }
  });

  test("rejects unknown schema discriminant", () => {
    const payload = {
      occurredTime: Date.now(),
      schema: "unknown.event.v1",
      tenant: 1001,
    };
    expect(OutboxPayloadSchema.safeParse(payload).success).toBe(false);
  });
});

describe("usage.llm_call outcome enum", () => {
  test("outcome must be COMPLETED or FAILED (SNAKE_CASE uppercase)", () => {
    const base = {
      durationMs: 100,
      inputTokens: 10,
      model: "gpt-4o",
      occurredTime: Date.now(),
      outputTokens: 5,
      provider: "OPENAI",
      schema: "usage.llm_call.v1",
      tenant: 1001,
    };
    expect(UsageLlmCallPayloadSchema.safeParse({ ...base, outcome: "COMPLETED" }).success).toBe(true);
    expect(UsageLlmCallPayloadSchema.safeParse({ ...base, outcome: "FAILED" }).success).toBe(true);
    expect(UsageLlmCallPayloadSchema.safeParse({ ...base, outcome: "completed" }).success).toBe(false);
    expect(UsageLlmCallPayloadSchema.safeParse({ ...base, outcome: "CANCELLED" }).success).toBe(false);
  });
});

describe("usage.tool_call cross-field rules", () => {
  test("LONG_RUNNING + COMPLETED requires jobId", () => {
    const payload = {
      schema: "usage.tool_call.v1",
      tenant: 1001,
      toolRef: "builtin:platform.flow.invoke",
      toolName: "platform.flow.invoke",
      execution: "LONG_RUNNING",
      durationMs: 12,
      outcome: "COMPLETED",
      occurredTime: Date.now(),
      // jobId missing
    };
    expect(UsageToolCallPayloadStrictSchema.safeParse(payload).success).toBe(false);

    const withJobId = { ...payload, jobId: "1820345678900000077", scheduled: true };
    expect(UsageToolCallPayloadStrictSchema.safeParse(withJobId).success).toBe(true);
  });

  test("FAILED outcome requires errorCode", () => {
    const payload = {
      schema: "usage.tool_call.v1",
      tenant: 1001,
      toolRef: "builtin:platform.api.invoke",
      toolName: "platform.api.invoke",
      execution: "SYNC",
      durationMs: 500,
      outcome: "FAILED",
      occurredTime: Date.now(),
      // errorCode missing
    };
    expect(UsageToolCallPayloadStrictSchema.safeParse(payload).success).toBe(false);

    const withError = { ...payload, errorCode: "TOOL_HTTP_BAD_GATEWAY" };
    expect(UsageToolCallPayloadStrictSchema.safeParse(withError).success).toBe(true);
  });

  test("errorCode must match SNAKE_CASE UPPERCASE pattern", () => {
    const base = {
      durationMs: 10,
      execution: "SYNC",
      occurredTime: Date.now(),
      outcome: "FAILED",
      schema: "usage.tool_call.v1",
      tenant: 1001,
      toolName: "test",
      toolRef: "builtin:test",
    };
    expect(UsageToolCallPayloadStrictSchema.safeParse({ ...base, errorCode: "TOOL_HTTP_BAD_GATEWAY" }).success).toBe(true);
    // lowercase errorCode rejected
    expect(UsageToolCallPayloadStrictSchema.safeParse({ ...base, errorCode: "timeout_error" }).success).toBe(false);
  });
});

describe("usage.job_duration cross-field rules", () => {
  const baseJob = {
    attempts: 1,
    execDurationMs: 4800,
    jobId: "1820345678900000077",
    occurredTime: Date.now(),
    schema: "usage.job_duration.v1",
    tenant: 1001,
    toolName: "platform.flow.invoke",
    toolRef: "builtin:platform.flow.invoke",
    totalDurationMs: 5000,
    waitDurationMs: 200,
  };

  test("attempts must be >= 1", () => {
    expect(UsageJobDurationPayloadStrictSchema.safeParse({ ...baseJob, attempts: 0, finalStatus: "COMPLETED" }).success).toBe(false);
    expect(UsageJobDurationPayloadStrictSchema.safeParse({ ...baseJob, attempts: 1, finalStatus: "COMPLETED" }).success).toBe(true);
  });

  test("FAILED finalStatus requires errorCode", () => {
    expect(UsageJobDurationPayloadStrictSchema.safeParse({ ...baseJob, finalStatus: "FAILED" }).success).toBe(false);
    expect(UsageJobDurationPayloadStrictSchema.safeParse({ ...baseJob, errorCode: "JOB_TIMEOUT", finalStatus: "FAILED" }).success).toBe(
      true,
    );
  });

  test("toolRef must start with builtin|ext|mcp prefix", () => {
    const invalid = { ...baseJob, finalStatus: "COMPLETED", toolRef: "unknown:tool" };
    expect(UsageJobDurationPayloadStrictSchema.safeParse(invalid).success).toBe(false);
  });
});
