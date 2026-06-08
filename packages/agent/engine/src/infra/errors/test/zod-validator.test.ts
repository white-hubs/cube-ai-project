import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { validateBody, validateQuery } from '../zod-validator';
import { AgenticEngineError } from '../agentic-error';

describe('validateBody', () => {
  const schema = z.object({
    id: z.string(),
    count: z.number().int(),
  });

  test('valid input returns parsed value', () => {
    const result = validateBody(schema, { id: 'abc', count: 42 });
    expect(result.id).toBe('abc');
    expect(result.count).toBe(42);
  });

  test('validation failure throws AgenticEngineError', () => {
    expect(() => validateBody(schema, { id: 123, count: 'not-a-number' })).toThrow(
      AgenticEngineError,
    );
  });

  test('validation failure → code=INVALID_ARGUMENT_SCHEMA_VIOLATION', () => {
    try {
      validateBody(schema, { id: 123 });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AgenticEngineError);
      const err = e as AgenticEngineError;
      expect(err.code).toBe('INVALID_ARGUMENT_SCHEMA_VIOLATION');
    }
  });

  test('validation failure → HTTP 412 (not 422)', () => {
    // Regulation: 01-api/README.md §5.3 — 422 is explicitly prohibited;
    // design doc §13 prompt歧义 A-1
    try {
      validateBody(schema, { id: 123 });
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as AgenticEngineError;
      expect(err.status).toBe(412);
    }
  });

  test('validation failure → details.fieldErrors is present', () => {
    try {
      validateBody(schema, { id: 123 });
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as AgenticEngineError;
      expect(err.details).not.toBeNull();
      expect((err.details as Record<string, unknown>).fieldErrors).toBeDefined();
    }
  });

  test('null body fails validation', () => {
    expect(() => validateBody(schema, null)).toThrow(AgenticEngineError);
  });
});

describe('validateQuery', () => {
  const qs = z.object({ page: z.coerce.number().int().optional() });

  test('valid query returns parsed value', () => {
    expect(validateQuery(qs, { page: '3' }).page).toBe(3);
  });

  test('invalid query → INVALID_ARGUMENT_SCHEMA_VIOLATION', () => {
    try {
      validateQuery(z.object({ id: z.string().min(1) }), { id: '' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AgenticEngineError);
      const err = e as AgenticEngineError;
      expect(err.code).toBe('INVALID_ARGUMENT_SCHEMA_VIOLATION');
    }
  });
});
