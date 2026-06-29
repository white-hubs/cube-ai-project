import { describe, expect, it } from "bun:test";

import {
  FlowInvokeRequestSchema,
  FlowInvokeSyncResponseSchema,
  type FlowInvokerPort,
  LegacyFlowScheduledEnvelopeSchema,
} from "./flow-invoker";

describe("FlowInvokerPort contracts", () => {
  it("FlowInvokeRequestSchema accepts a valid request", () => {
    const ok = FlowInvokeRequestSchema.parse({
      flowId: "1234567890123456789",
      tenant: 1,
      traceId: "trace-abc",
      variables: { foo: "bar" },
    });
    expect(ok.flowId).toBe("1234567890123456789");
    expect(ok.tenant).toBe(1);
    expect(ok.variables).toEqual({ foo: "bar" });
  });

  it("FlowInvokeRequestSchema rejects missing tenant", () => {
    expect(() =>
      FlowInvokeRequestSchema.parse({
        flowId: "abc",
        traceId: "trace-abc",
      }),
    ).toThrow();
  });

  it("FlowInvokeRequestSchema rejects flowId longer than 64 chars", () => {
    expect(() =>
      FlowInvokeRequestSchema.parse({
        flowId: "x".repeat(65),
        tenant: 1,
        traceId: "trace-abc",
      }),
    ).toThrow();
  });

  it("FlowInvokeSyncResponseSchema requires result object", () => {
    expect(() => FlowInvokeSyncResponseSchema.parse({})).toThrow();
    const ok = FlowInvokeSyncResponseSchema.parse({
      executionTrace: [{ kind: "log", ts: "2026-01-01T00:00:00.000Z" }],
      result: { ok: true, phase: "done" },
    });
    expect(ok.result.ok).toBe(true);
    expect(ok.executionTrace).toHaveLength(1);
  });

  it("LegacyFlowScheduledEnvelopeSchema still validates old remote shape", () => {
    expect(() =>
      LegacyFlowScheduledEnvelopeSchema.parse({
        jobId: "1234567890123456789",
        scheduled: false,
        statusUrl: "/v1/jobs/1234567890123456789",
      }),
    ).toThrow();

    const ok = LegacyFlowScheduledEnvelopeSchema.parse({
      jobId: "1234567890123456789",
      scheduled: true,
      statusUrl: "/v1/jobs/1234567890123456789",
    });
    expect(ok.scheduled).toBe(true);
  });

  it("LegacyFlowScheduledEnvelopeSchema rejects non-19-digit jobId", () => {
    expect(() =>
      LegacyFlowScheduledEnvelopeSchema.parse({
        jobId: "123",
        scheduled: true,
        statusUrl: "/v1/jobs/123",
      }),
    ).toThrow();
  });

  it("exports the FlowInvokerPort type", () => {
    const fake: FlowInvokerPort = {
      invoke: async () => ({ result: { stub: true } }),
    };
    expect(typeof fake.invoke).toBe("function");
  });
});
