import { describe, test, expect } from 'bun:test';
import { AuditLogEntrySchema, AuditActorSchema } from './audit-log-entry';

const validActor = {
  userId: 'u_123',
  agentId: null,
  tenant: 1,
  principalType: 'USER' as const,
};

const validEntry = {
  id: '1845921456789012345',
  tenant: 1,
  eventType: 'grant.created',
  eventSchema: 'audit-grant-created-v1',
  severity: 2,
  occurredTime: Date.now(),
  actor: validActor,
  traceId: 'abc123def456',
  sessionId: null,
  turnId: null,
  toolCallId: null,
  jobId: null,
  grantRequestId: null,
  subject: 'grant(18459214567890123)',
  outcome: 'SUCCESS' as const,
  payloadJson: { grantId: '18459214567890123' },
  ipAddress: null,
  userAgent: null,
};

describe('AuditActorSchema', () => {
  test('valid dual-subject actor passes (userId + agentId)', () => {
    expect(() => AuditActorSchema.parse(validActor)).not.toThrow();
  });

  test('SERVICE actor without userId passes', () => {
    const serviceActor = {
      userId: null,
      agentId: 'sp_456',
      tenant: 1,
      principalType: 'SERVICE' as const,
    };
    expect(() => AuditActorSchema.parse(serviceActor)).not.toThrow();
  });

  test('negative tenant fails validation', () => {
    expect(() =>
      AuditActorSchema.parse({ ...validActor, tenant: -1 }),
    ).toThrow();
  });
});

describe('AuditLogEntrySchema', () => {
  test('valid full entry passes', () => {
    expect(() => AuditLogEntrySchema.parse(validEntry)).not.toThrow();
  });

  test('eventType must be lowercase.dotted (rejects UPPERCASE)', () => {
    expect(() =>
      AuditLogEntrySchema.parse({ ...validEntry, eventType: 'GRANT_CREATED' }),
    ).toThrow();
  });

  test('eventType allows underscores in segments (cross_tenant.violation)', () => {
    expect(() =>
      AuditLogEntrySchema.parse({ ...validEntry, eventType: 'cross_tenant.violation' }),
    ).not.toThrow();
  });

  test('eventSchema must match audit-{name}-v{N} pattern', () => {
    expect(() =>
      AuditLogEntrySchema.parse({
        ...validEntry,
        eventSchema: 'invalid-schema',
      }),
    ).toThrow();
  });

  test('severity must be 1-4', () => {
    expect(() =>
      AuditLogEntrySchema.parse({ ...validEntry, severity: 5 }),
    ).toThrow();
    expect(() =>
      AuditLogEntrySchema.parse({ ...validEntry, severity: 0 }),
    ).toThrow();
  });

  test('outcome must be SUCCESS/FAILURE/DENIED/PARTIAL', () => {
    expect(() =>
      AuditLogEntrySchema.parse({ ...validEntry, outcome: 'UNKNOWN' }),
    ).toThrow();
  });

  test('tenant=0 allowed for system events (audit_event)', () => {
    expect(() =>
      AuditLogEntrySchema.parse({ ...validEntry, tenant: 0 }),
    ).not.toThrow();
  });

  test('payloadJson accepts arbitrary camelCase metadata', () => {
    expect(() =>
      AuditLogEntrySchema.parse({
        ...validEntry,
        payloadJson: { grantId: '123', argsConstraint: { op: 'eq' } },
      }),
    ).not.toThrow();
  });
});
