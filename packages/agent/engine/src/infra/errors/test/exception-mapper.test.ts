import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { mapToAgenticError, isAgenticError } from '../exception-mapper';
import { AgenticEngineError } from '../agentic-error';

describe('mapToAgenticError', () => {
  test('AgenticEngineError passes through unchanged', () => {
    const original = AgenticEngineError.fromCode(
      'RESOURCE_NOT_FOUND_SESSION',
      'session not found',
    );
    const mapped = mapToAgenticError(original);
    expect(mapped).toBe(original);
    expect(mapped.code).toBe('RESOURCE_NOT_FOUND_SESSION');
  });

  test('plain Error → INTERNAL_UNKNOWN + status 500', () => {
    const mapped = mapToAgenticError(new Error('something went wrong'));
    expect(mapped).toBeInstanceOf(AgenticEngineError);
    expect(mapped.code).toBe('INTERNAL_UNKNOWN');
    expect(mapped.status).toBe(500);
  });

  test('non-Error thrown value → INTERNAL_UNKNOWN', () => {
    const mapped = mapToAgenticError('a plain string');
    expect(mapped.code).toBe('INTERNAL_UNKNOWN');
  });

  test('thrown null → INTERNAL_UNKNOWN', () => {
    const mapped = mapToAgenticError(null);
    expect(mapped.code).toBe('INTERNAL_UNKNOWN');
  });

  test('stack trace is NOT exposed in error details (§10.6)', () => {
    const originalErr = new Error('internal failure');
    const mapped = mapToAgenticError(originalErr);
    // details must not contain the original stack / message
    const detailsStr = JSON.stringify(mapped.details ?? {});
    expect(detailsStr).not.toContain('internal failure');
    expect(detailsStr).not.toContain('Error:');
  });

  test('existing AgenticEngineError status is preserved', () => {
    const authErr = AgenticEngineError.fromCode('UNAUTHENTICATED_TOKEN_EXPIRED', 'expired');
    const mapped = mapToAgenticError(authErr);
    expect(mapped.status).toBe(401);
  });

  test('ZodError → INVALID_ARGUMENT_SCHEMA_VIOLATION', () => {
    const schema = z.object({ a: z.string() });
    const parsed = schema.safeParse({});
    expect(parsed.success).toBe(false);
    const mapped = mapToAgenticError(parsed.error);
    expect(mapped.code).toBe('INVALID_ARGUMENT_SCHEMA_VIOLATION');
    expect(mapped.status).toBe(412);
  });
});

describe('isAgenticError', () => {
  test('returns true for AgenticEngineError', () => {
    const err = AgenticEngineError.fromCode('INTERNAL_UNKNOWN', 'err');
    expect(isAgenticError(err)).toBe(true);
  });

  test('returns false for plain Error', () => {
    expect(isAgenticError(new Error('plain'))).toBe(false);
  });

  test('returns false for non-error value', () => {
    expect(isAgenticError('string')).toBe(false);
    expect(isAgenticError(null)).toBe(false);
  });
});
