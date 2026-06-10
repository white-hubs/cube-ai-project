import { describe, expect, test } from 'bun:test';
import { HttpException, UnauthorizedException } from '@dangao/bun-server';

import { mapToAgenticError } from '../exception-mapper';

describe('mapToAgenticError', () => {
  test('UnauthorizedException maps to HTTP 401', () => {
    const err = new UnauthorizedException('missing Authorization: Bearer token');
    const mapped = mapToAgenticError(err);
    expect(mapped.httpStatus).toBe(401);
    expect(mapped.message).toBe('missing Authorization: Bearer token');
    expect(mapped.code).toBe('UNAUTHENTICATED_MISSING_TOKEN');
  });

  test('HttpException preserves explicit status', () => {
    const err = new HttpException(503, 'upstream unavailable');
    const mapped = mapToAgenticError(err);
    expect(mapped.httpStatus).toBe(503);
    expect(mapped.message).toBe('upstream unavailable');
  });

  test('DI provider errors map to HTTP 503', () => {
    const err = new Error('Provider not found for token: s3');
    const mapped = mapToAgenticError(err);
    expect(mapped.httpStatus).toBe(503);
    expect(mapped.code).toBe('INTERNAL_DI_MISCONFIGURATION');
    expect(mapped.message).toContain('Provider not found for token: s3');
  });

  test('ECONNREFUSED maps to HTTP 503 UPSTREAM_UNAVAILABLE', () => {
    const err = Object.assign(new Error('ECONNREFUSED'), {
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: '127.0.0.1',
      port: 6333,
    });
    const mapped = mapToAgenticError(err);
    expect(mapped.httpStatus).toBe(503);
    expect(mapped.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(mapped.message).toContain('127.0.0.1:6333');
    expect(mapped.message).toContain('ECONNREFUSED');
  });
});
