import { describe, expect, test } from "bun:test";

import { AuditActorSchema, AuditLogEntrySchema } from "./audit-log-entry";

const validActor = {
  agentId: null,
  principalType: "USER" as const,
  tenant: 1,
  userId: "u_123",
};

const validEntry = {
  actor: validActor,
  eventSchema: "audit-grant-created-v1",
  eventType: "grant.created",
  grantRequestId: null,
  id: "1845921456789012345",
  ipAddress: null,
  jobId: null,
  occurredTime: Date.now(),
  outcome: "SUCCESS" as const,
  payloadJson: { grantId: "18459214567890123" },
  sessionId: null,
  severity: 2,
  subject: "grant(18459214567890123)",
  tenant: 1,
  toolCallId: null,
  traceId: "abc123def456",
  turnId: null,
  userAgent: null,
};

describe("AuditActorSchema", () => {
  test("valid dual-subject actor passes (userId + agentId)", () => {
    expect(() => AuditActorSchema.parse(validActor)).not.toThrow();
  });

  test("SERVICE actor without userId passes", () => {
    const serviceActor = {
      agentId: "sp_456",
      principalType: "SERVICE" as const,
      tenant: 1,
      userId: null,
    };
    expect(() => AuditActorSchema.parse(serviceActor)).not.toThrow();
  });

  test("negative tenant fails validation", () => {
    expect(() => AuditActorSchema.parse({ ...validActor, tenant: -1 })).toThrow();
  });
});

describe("AuditLogEntrySchema", () => {
  test("valid full entry passes", () => {
    expect(() => AuditLogEntrySchema.parse(validEntry)).not.toThrow();
  });

  test("eventType must be lowercase.dotted (rejects UPPERCASE)", () => {
    expect(() => AuditLogEntrySchema.parse({ ...validEntry, eventType: "GRANT_CREATED" })).toThrow();
  });

  test("eventType allows underscores in segments (cross_tenant.violation)", () => {
    expect(() => AuditLogEntrySchema.parse({ ...validEntry, eventType: "cross_tenant.violation" })).not.toThrow();
  });

  test("eventSchema must match audit-{name}-v{N} pattern", () => {
    expect(() =>
      AuditLogEntrySchema.parse({
        ...validEntry,
        eventSchema: "invalid-schema",
      }),
    ).toThrow();
  });

  test("severity must be 1-4", () => {
    expect(() => AuditLogEntrySchema.parse({ ...validEntry, severity: 5 })).toThrow();
    expect(() => AuditLogEntrySchema.parse({ ...validEntry, severity: 0 })).toThrow();
  });

  test("outcome must be SUCCESS/FAILURE/DENIED/PARTIAL", () => {
    expect(() => AuditLogEntrySchema.parse({ ...validEntry, outcome: "UNKNOWN" })).toThrow();
  });

  test("tenant=0 allowed for system events (audit_event)", () => {
    expect(() => AuditLogEntrySchema.parse({ ...validEntry, tenant: 0 })).not.toThrow();
  });

  test("payloadJson accepts arbitrary camelCase metadata", () => {
    expect(() =>
      AuditLogEntrySchema.parse({
        ...validEntry,
        payloadJson: { argsConstraint: { op: "eq" }, grantId: "123" },
      }),
    ).not.toThrow();
  });
});
