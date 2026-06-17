import { describe, expect, test } from 'bun:test';
import {
  AGENTIC_CONTRACTS_VERSION,
  ERROR_CATEGORIES,
  ErrorResponseSchema,
  HEADER_AGENTIC_VERSION,
  SfidSchema,
} from '@cube-ai/contracts';

describe('@cube-ai/contracts smoke', () => {
  test('version string is set', () => {
    expect(AGENTIC_CONTRACTS_VERSION).toBe('0.0.1-alpha.4');
  });

  test('SFID schema accepts 19-digit decimal string', () => {
    expect(SfidSchema.safeParse('1234567890123456789').success).toBe(true);
  });

  test('SFID schema rejects non-numeric', () => {
    expect(SfidSchema.safeParse('abc').success).toBe(false);
  });

  test('ErrorResponseSchema accepts canonical 5-field envelope', () => {
    const parsed = ErrorResponseSchema.safeParse({
      status: 404,
      code: 'PLATFORM_ROUTE_NOT_FOUND',
      message: 'Not Found',
      details: null,
      timestamp: Date.now(),
    });
    expect(parsed.success).toBe(true);
  });

  test('error categories are the closed set (§16)', () => {
    expect(ERROR_CATEGORIES).toContain('UNAUTHENTICATED');
    expect(ERROR_CATEGORIES).toContain('PERMISSION_DENIED');
    expect(ERROR_CATEGORIES).toContain('INTERNAL');
    expect(ERROR_CATEGORIES).toContain('UPSTREAM');
    expect(ERROR_CATEGORIES.length).toBe(17);
  });

  test('agentic-version header has canonical casing', () => {
    expect(HEADER_AGENTIC_VERSION).toBe('X-Agentic-Version');
  });
});
