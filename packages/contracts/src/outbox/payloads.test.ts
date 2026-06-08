import { describe, test, expect } from 'bun:test';
import {
  OutboxPayloadSchema,
  UsageLlmCallPayloadSchema,
  UsageToolCallPayloadStrictSchema,
  UsageJobDurationPayloadStrictSchema,
  GrantApprovePayloadSchema,
  SessionEndPayloadSchema,
} from './payloads';

/**
 * Unit tests for OutboxPayload discriminated union.
 * Ref: docs/technical-design/phase-1/P1-03-data-outbox.md §7
 *      docs/detailed-design/09-usage-events/outbox-contract.md §3-§5
 */

describe('OutboxPayloadSchema — discriminated union', () => {
  test('parses usage.llm_call.v1 by schema discriminant', () => {
    const payload = {
      schema:       'usage.llm_call.v1',
      tenant:       1001,
      provider:     'OPENAI',
      model:        'gpt-4o-mini',
      inputTokens:  100,
      outputTokens: 50,
      durationMs:   1200,
      outcome:      'COMPLETED',
      occurredTime: Date.now(),
    };
    const result = OutboxPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema).toBe('usage.llm_call.v1');
    }
  });

  test('parses usage.tool_call.v1 by schema discriminant', () => {
    const payload = {
      schema:       'usage.tool_call.v1',
      tenant:       1001,
      toolRef:      'builtin:platform.api.invoke',
      toolName:     'platform.api.invoke',
      execution:    'SYNC',
      durationMs:   45,
      outcome:      'COMPLETED',
      occurredTime: Date.now(),
    };
    const result = OutboxPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  test('parses usage.job_duration.v1 by schema discriminant', () => {
    const payload = {
      schema:          'usage.job_duration.v1',
      tenant:          1001,
      jobId:           '1820345678900000077',
      toolRef:         'builtin:platform.flow.invoke',
      toolName:        'platform.flow.invoke',
      totalDurationMs: 186700,
      waitDurationMs:  1200,
      execDurationMs:  185500,
      attempts:        1,
      finalStatus:     'COMPLETED',
      occurredTime:    Date.now(),
    };
    const result = OutboxPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  test('parses grant.approve.v1 by schema discriminant', () => {
    const payload = {
      schema:         'grant.approve.v1',
      grantId:        '1111111111111111111',
      grantRequestId: '2222222222222222222',
      tenant:         1001,
      userId:         'u_abc123',
      toolRef:        'builtin:platform.api.invoke',
      decision:       'APPROVED',
      occurredTime:   Date.now(),
    };
    const result = OutboxPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  test('parses session.end.v1 by schema discriminant', () => {
    const payload = {
      schema:       'session.end.v1',
      sessionId:    '3333333333333333333',
      tenant:       1001,
      userId:       'u_abc123',
      reason:       'USER_CLOSED',
      occurredTime: Date.now(),
    };
    const result = OutboxPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  test('rejects unknown schema discriminant', () => {
    const payload = {
      schema:       'unknown.event.v1',
      tenant:       1001,
      occurredTime: Date.now(),
    };
    expect(OutboxPayloadSchema.safeParse(payload).success).toBe(false);
  });
});

describe('usage.llm_call outcome enum', () => {
  test('outcome must be COMPLETED or FAILED (SNAKE_CASE uppercase)', () => {
    const base = {
      schema: 'usage.llm_call.v1',
      tenant: 1001,
      provider: 'OPENAI',
      model: 'gpt-4o',
      inputTokens: 10,
      outputTokens: 5,
      durationMs: 100,
      occurredTime: Date.now(),
    };
    expect(UsageLlmCallPayloadSchema.safeParse({ ...base, outcome: 'COMPLETED' }).success).toBe(true);
    expect(UsageLlmCallPayloadSchema.safeParse({ ...base, outcome: 'FAILED' }).success).toBe(true);
    expect(UsageLlmCallPayloadSchema.safeParse({ ...base, outcome: 'completed' }).success).toBe(false);
    expect(UsageLlmCallPayloadSchema.safeParse({ ...base, outcome: 'CANCELLED' }).success).toBe(false);
  });
});

describe('usage.tool_call cross-field rules', () => {
  test('LONG_RUNNING + COMPLETED requires jobId', () => {
    const payload = {
      schema:       'usage.tool_call.v1',
      tenant:       1001,
      toolRef:      'builtin:platform.flow.invoke',
      toolName:     'platform.flow.invoke',
      execution:    'LONG_RUNNING',
      durationMs:   12,
      outcome:      'COMPLETED',
      occurredTime: Date.now(),
      // jobId missing
    };
    expect(UsageToolCallPayloadStrictSchema.safeParse(payload).success).toBe(false);

    const withJobId = { ...payload, jobId: '1820345678900000077', scheduled: true };
    expect(UsageToolCallPayloadStrictSchema.safeParse(withJobId).success).toBe(true);
  });

  test('FAILED outcome requires errorCode', () => {
    const payload = {
      schema:       'usage.tool_call.v1',
      tenant:       1001,
      toolRef:      'builtin:platform.api.invoke',
      toolName:     'platform.api.invoke',
      execution:    'SYNC',
      durationMs:   500,
      outcome:      'FAILED',
      occurredTime: Date.now(),
      // errorCode missing
    };
    expect(UsageToolCallPayloadStrictSchema.safeParse(payload).success).toBe(false);

    const withError = { ...payload, errorCode: 'TOOL_HTTP_BAD_GATEWAY' };
    expect(UsageToolCallPayloadStrictSchema.safeParse(withError).success).toBe(true);
  });

  test('errorCode must match SNAKE_CASE UPPERCASE pattern', () => {
    const base = {
      schema: 'usage.tool_call.v1',
      tenant: 1001,
      toolRef: 'builtin:test',
      toolName: 'test',
      execution: 'SYNC',
      durationMs: 10,
      outcome: 'FAILED',
      occurredTime: Date.now(),
    };
    expect(UsageToolCallPayloadStrictSchema.safeParse({ ...base, errorCode: 'TOOL_HTTP_BAD_GATEWAY' }).success).toBe(true);
    // lowercase errorCode rejected
    expect(UsageToolCallPayloadStrictSchema.safeParse({ ...base, errorCode: 'timeout_error' }).success).toBe(false);
  });
});

describe('usage.job_duration cross-field rules', () => {
  const baseJob = {
    schema:          'usage.job_duration.v1',
    tenant:          1001,
    jobId:           '1820345678900000077',
    toolRef:         'builtin:platform.flow.invoke',
    toolName:        'platform.flow.invoke',
    totalDurationMs: 5000,
    waitDurationMs:  200,
    execDurationMs:  4800,
    attempts:        1,
    occurredTime:    Date.now(),
  };

  test('attempts must be >= 1', () => {
    expect(UsageJobDurationPayloadStrictSchema.safeParse({ ...baseJob, finalStatus: 'COMPLETED', attempts: 0 }).success).toBe(false);
    expect(UsageJobDurationPayloadStrictSchema.safeParse({ ...baseJob, finalStatus: 'COMPLETED', attempts: 1 }).success).toBe(true);
  });

  test('FAILED finalStatus requires errorCode', () => {
    expect(UsageJobDurationPayloadStrictSchema.safeParse({ ...baseJob, finalStatus: 'FAILED' }).success).toBe(false);
    expect(UsageJobDurationPayloadStrictSchema.safeParse({ ...baseJob, finalStatus: 'FAILED', errorCode: 'JOB_TIMEOUT' }).success).toBe(true);
  });

  test('toolRef must start with builtin|ext|mcp prefix', () => {
    const invalid = { ...baseJob, finalStatus: 'COMPLETED', toolRef: 'unknown:tool' };
    expect(UsageJobDurationPayloadStrictSchema.safeParse(invalid).success).toBe(false);
  });
});
