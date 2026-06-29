import { describe, expect, test } from "bun:test";

import { GRANT_REQUESTED, TOOL_APPROVAL, TURN_STREAMING } from "@cube-ai/agent-sdk-client-mock";
import { SseEventSchema } from "@cube-ai/contracts";

/**
 * Verify all 3 scenarios conform to SseEventSchema.
 * Ref: P1-09 design doc §7 / sdk-mock.md §12.2 (contract consistency tests)
 */
describe("sdk-mock scenarios: schema compliance", () => {
  test("TURN_STREAMING: all events pass SseEventSchema.parse", () => {
    expect(TURN_STREAMING.stream).toBeDefined();
    for (const event of TURN_STREAMING.stream!) {
      const result = SseEventSchema.safeParse(event);
      expect(result.success, `Event ${event.schema} failed schema validation`).toBe(true);
    }
  });

  test("TURN_STREAMING: ends with turn-completed-v1", () => {
    const last = TURN_STREAMING.stream?.at(-1);
    expect(last?.schema).toBe("turn-completed-v1");
  });

  test("GRANT_REQUESTED: all events pass SseEventSchema.parse", () => {
    expect(GRANT_REQUESTED.stream).toBeDefined();
    for (const event of GRANT_REQUESTED.stream!) {
      const result = SseEventSchema.safeParse(event);
      expect(result.success, `Event ${event.schema} failed schema validation`).toBe(true);
    }
  });

  test("GRANT_REQUESTED: contains grant-request-v1 event", () => {
    const hasGrant = GRANT_REQUESTED.stream?.some((e) => e.schema === "grant-request-v1");
    expect(hasGrant).toBe(true);
  });

  test("GRANT_REQUESTED: grant-request-v1 has SFID grantRequestId", () => {
    const grantEvent = GRANT_REQUESTED.stream?.find((e) => e.schema === "grant-request-v1");
    expect(grantEvent).toBeDefined();
    if (grantEvent?.schema === "grant-request-v1") {
      expect(grantEvent.grantRequestId).toMatch(/^\d{1,20}$/u);
      expect(["PERSISTENT", "ONCE"]).toContain(grantEvent.scopeHint);
    }
  });

  test("TOOL_APPROVAL: all events pass SseEventSchema.parse", () => {
    expect(TOOL_APPROVAL.stream).toBeDefined();
    for (const event of TOOL_APPROVAL.stream!) {
      const result = SseEventSchema.safeParse(event);
      expect(result.success, `Event ${event.schema} failed schema validation`).toBe(true);
    }
  });

  test("TOOL_APPROVAL: contains both tool-call-started-v1 and grant-request-v1", () => {
    const schemas = TOOL_APPROVAL.stream?.map((e) => e.schema);
    expect(schemas).toContain("tool-call-started-v1");
    expect(schemas).toContain("grant-request-v1");
  });

  test("TOOL_APPROVAL: tool-call-started-v1 meta has UPPERCASE enums", () => {
    const toolEvent = TOOL_APPROVAL.stream?.find((e) => e.schema === "tool-call-started-v1");
    if (toolEvent?.schema === "tool-call-started-v1") {
      expect(["LOCAL", "REMOTE", "LONG_RUNNING"]).toContain(toolEvent.meta.execution);
      expect(["NEVER", "ON_FIRST_USE", "EACH_CALL", "ADMIN_ONLY"]).toContain(toolEvent.meta.consent);
    }
  });
});
