import { describe, expect, it, test } from 'bun:test';
import {
  ErrorResponseSchema,
  ErrorDetailsSchema,
  buildErrorDetails,
} from '@cube-ai/contracts';

describe('ErrorResponseSchema (5-field envelope)', () => {
  const valid = {
    status: 404,
    code: 'RESOURCE_NOT_FOUND_SESSION',
    message: 'Session not found',
    details: { traceId: 'aabbccdd' },
    timestamp: 1745300000000,
  };

  test('accepts canonical 5-field envelope', () => {
    expect(ErrorResponseSchema.safeParse(valid).success).toBe(true);
  });

  test('accepts null code (unclassified 500)', () => {
    expect(ErrorResponseSchema.safeParse({ ...valid, code: null }).success).toBe(true);
  });

  test('accepts null details', () => {
    expect(ErrorResponseSchema.safeParse({ ...valid, details: null }).success).toBe(true);
  });

  test('rejects missing status', () => {
    const { status: _omit, ...rest } = valid;
    expect(ErrorResponseSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects missing message', () => {
    const { message: _omit, ...rest } = valid;
    expect(ErrorResponseSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects missing timestamp', () => {
    const { timestamp: _omit, ...rest } = valid;
    expect(ErrorResponseSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects extra top-level traceId field (must be in details per §10.2)', () => {
    // The schema does NOT have a top-level traceId — extra fields are stripped
    // by Zod's default (strip mode), not rejected. But it's not in the type.
    const parsed = ErrorResponseSchema.safeParse({ ...valid, traceId: 'xxx' });
    expect(parsed.success).toBe(true);
    // traceId must NOT be at top level in the parsed output
    expect((parsed.data as Record<string, unknown>).traceId).toBeUndefined();
  });
});

describe('ErrorDetailsSchema', () => {
  test('accepts object with traceId', () => {
    expect(
      ErrorDetailsSchema.safeParse({ traceId: 'abc', extra: 'data' }).success,
    ).toBe(true);
  });

  test('rejects missing traceId', () => {
    expect(ErrorDetailsSchema.safeParse({ extra: 'data' }).success).toBe(false);
  });

  test('rejects empty traceId', () => {
    expect(ErrorDetailsSchema.safeParse({ traceId: '' }).success).toBe(false);
  });

  test('allows extra fields (camelCase per §10.6)', () => {
    const result = ErrorDetailsSchema.safeParse({
      traceId: 'abc',
      limit: 10,
      window: '60s',
      retryAfterMs: 1500,
    });
    expect(result.success).toBe(true);
  });
});

describe('buildErrorDetails', () => {
  test('includes traceId in output', () => {
    const details = buildErrorDetails('trace123');
    expect(details.traceId).toBe('trace123');
  });

  test('merges extra fields', () => {
    const details = buildErrorDetails('trace123', { limit: 10, window: '60s' });
    expect(details.traceId).toBe('trace123');
    expect(details.limit).toBe(10);
    expect(details.window).toBe('60s');
  });

  it('traceId cannot be overridden by extra fields', () => {
    const details = buildErrorDetails('real-trace', { traceId: 'fake-trace' });
    expect(details.traceId).toBe('real-trace');
  });

  it('details body exceeding 4 KB is truncated', () => {
    const big = 'x'.repeat(5000);
    const details = buildErrorDetails('t1', { payload: big });
    expect(details).toEqual({ traceId: 't1', truncated: true, reason: 'details exceeded 4 KB' });
  });

  test('handles null extra gracefully', () => {
    const details = buildErrorDetails('tid', null);
    expect(details.traceId).toBe('tid');
  });

  test('handles undefined extra gracefully', () => {
    const details = buildErrorDetails('tid');
    expect(details.traceId).toBe('tid');
  });
});
