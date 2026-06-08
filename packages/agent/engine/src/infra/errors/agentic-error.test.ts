import { describe, expect, test } from 'bun:test';
import {
  AgenticValidationError,
  AgenticAuthError,
  AgenticAuthZError,
  AgenticNotFoundError,
  AgenticConflictError,
  AgenticRateLimitError,
  AgenticBusinessError,
  AgenticInternalError,
  AgenticUpstreamError,
  AgenticTimeoutError,
  TenantIsolationViolation,
  NotImplementedError,
  AgenticError,
  AgenticEngineError,
} from './agentic-error';
import { ERROR_CATEGORIES } from './error-categories';
import { KNOWN_ERROR_CODES } from '@cube-ai/contracts';

// ref: docs/technical-design/phase-1/P1-01-foundations.md §7

describe('ERROR_CATEGORIES', () => {
  test('has exactly 17 entries (ADR-0015 closed set)', () => {
    expect(ERROR_CATEGORIES).toHaveLength(17);
  });

  test('contains legacy + extended categories', () => {
    expect(ERROR_CATEGORIES).toContain('UNAUTHENTICATED');
    expect(ERROR_CATEGORIES).toContain('UNAVAILABLE');
    expect(ERROR_CATEGORIES).toContain('FAILED_PRECONDITION');
    expect(ERROR_CATEGORIES).toContain('DEADLINE_EXCEEDED');
    expect(ERROR_CATEGORIES).toContain('CANCELLED');
    expect(ERROR_CATEGORIES).toContain('CLIENT_NETWORK');
  });
});

describe('AgenticEngineError.fromCode', () => {
  test('every KNOWN_ERROR_CODES maps to HTTP 4xx/5xx', () => {
    for (const code of KNOWN_ERROR_CODES) {
      const e = AgenticEngineError.fromCode(code, 'msg');
      expect(e.code).toBe(code);
      expect(e.status).toBeGreaterThanOrEqual(400);
      expect(e.status).toBeLessThanOrEqual(599);
    }
  });

  test('UNAVAILABLE_SECRET_NOT_FOUND → 503', () => {
    const e = AgenticEngineError.fromCode(
      'UNAVAILABLE_SECRET_NOT_FOUND',
      'missing',
    );
    expect(e.status).toBe(503);
  });
});

describe('AgenticError subclasses', () => {
  const ALL_SUBCLASSES: [string, AgenticError][] = [
    ['AgenticValidationError',   new AgenticValidationError('INVALID_ARGUMENT_TEST', 'test')],
    ['AgenticAuthError',         new AgenticAuthError('UNAUTHENTICATED_TOKEN_INVALID', 'test')],
    ['AgenticAuthZError',        new AgenticAuthZError('PERMISSION_DENIED_GRANT_MISSING', 'test')],
    ['AgenticNotFoundError',     new AgenticNotFoundError('RESOURCE_NOT_FOUND_SESSION', 'test')],
    ['AgenticConflictError',     new AgenticConflictError('RESOURCE_CONFLICT_TURN_RUNNING', 'test')],
    ['AgenticRateLimitError',    new AgenticRateLimitError('RATELIMIT_SESSION_EXCEEDED', 'test')],
    ['AgenticBusinessError',     new AgenticBusinessError('INVALID_ARGUMENT_SESSION_ID', 'test')],
    ['AgenticInternalError',     new AgenticInternalError()],
    ['AgenticUpstreamError',     new AgenticUpstreamError('UPSTREAM_LLM_UNAVAILABLE', 'test')],
    ['AgenticTimeoutError',      new AgenticTimeoutError('UPSTREAM_LLM_TIMEOUT', 'test')],
    ['TenantIsolationViolation', new TenantIsolationViolation()],
    ['NotImplementedError',      new NotImplementedError('test.method: ref §4.1')],
  ];

  test('all 12 subclasses are AgenticError instances', () => {
    expect(ALL_SUBCLASSES).toHaveLength(12);
    for (const [name, err] of ALL_SUBCLASSES) {
      expect(err, `${name} should be instanceof AgenticError`).toBeInstanceOf(AgenticError);
    }
  });

  test('all subclasses have non-empty code', () => {
    for (const [name, err] of ALL_SUBCLASSES) {
      expect(err.code, `${name}.code should not be empty`).toBeTruthy();
      expect(err.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });

  test('all subclasses have httpStatus in 4xx or 5xx range', () => {
    for (const [name, err] of ALL_SUBCLASSES) {
      expect(err.httpStatus, `${name}.httpStatus`).toBeGreaterThanOrEqual(400);
      expect(err.httpStatus, `${name}.httpStatus`).toBeLessThanOrEqual(599);
    }
  });

  test('toResponse() returns all 5 required fields', () => {
    const err = new AgenticNotFoundError('RESOURCE_NOT_FOUND_SESSION', 'Session not found');
    const resp = err.toResponse('trace-abc-123');
    expect(resp).toHaveProperty('status');
    expect(resp).toHaveProperty('code');
    expect(resp).toHaveProperty('message');
    expect(resp).toHaveProperty('details');
    expect(resp).toHaveProperty('timestamp');
    expect(Object.keys(resp).sort()).toEqual(['code', 'details', 'message', 'status', 'timestamp'].sort());
  });

  test('toResponse() places traceId inside details (not top-level)', () => {
    const err = new AgenticNotFoundError('RESOURCE_NOT_FOUND_SESSION', 'Not found');
    const resp = err.toResponse('trace-xyz');
    expect((resp.details as Record<string, unknown>).traceId).toBe('trace-xyz');
    expect(resp).not.toHaveProperty('traceId');
  });

  test('toResponse() HTTP status matches the error class', () => {
    expect(new AgenticAuthError('UNAUTHENTICATED_TOKEN_INVALID', '').toResponse('t').status).toBe(401);
    expect(new AgenticAuthZError('PERMISSION_DENIED_GRANT_MISSING', '').toResponse('t').status).toBe(403);
    expect(new AgenticNotFoundError('RESOURCE_NOT_FOUND_SESSION', '').toResponse('t').status).toBe(404);
    expect(new AgenticConflictError('RESOURCE_CONFLICT_TURN_RUNNING', '').toResponse('t').status).toBe(409);
    expect(new AgenticValidationError('INVALID_ARGUMENT_TEST', '').toResponse('t').status).toBe(412);
    expect(new AgenticRateLimitError('RATELIMIT_SESSION_EXCEEDED', '').toResponse('t').status).toBe(429);
    expect(new AgenticInternalError().toResponse('t').status).toBe(500);
    expect(new NotImplementedError('test').toResponse('t').status).toBe(501);
    expect(new AgenticUpstreamError('UPSTREAM_LLM_UNAVAILABLE', '').toResponse('t').status).toBe(502);
    expect(new AgenticTimeoutError('UPSTREAM_LLM_TIMEOUT', '').toResponse('t').status).toBe(504);
    expect(new TenantIsolationViolation().toResponse('t').status).toBe(403);
  });

  test('additional details are merged with traceId', () => {
    const err = new AgenticRateLimitError(
      'RATELIMIT_SESSION_EXCEEDED',
      'Too many requests',
      { limit: 10, window: '60s' },
    );
    const resp = err.toResponse('my-trace');
    const details = resp.details as Record<string, unknown>;
    expect(details.limit).toBe(10);
    expect(details.window).toBe('60s');
    expect(details.traceId).toBe('my-trace');
  });
});
