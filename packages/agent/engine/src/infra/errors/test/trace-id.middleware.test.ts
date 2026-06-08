import { describe, expect, test } from 'bun:test';
import {
  resolveTraceId,
  extractTraceIdFromTraceparent,
  generateTraceId,
} from '../trace-id.middleware';

const TRACE_ID_RE = /^[0-9a-f]{32}$/;

function makeCtx(headers: Record<string, string | null>) {
  return {
    getHeader: (key: string) => headers[key] ?? null,
  };
}

describe('generateTraceId', () => {
  test('returns 32-hex string', () => {
    const id = generateTraceId();
    expect(id).toMatch(TRACE_ID_RE);
  });

  test('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });
});

describe('extractTraceIdFromTraceparent', () => {
  const sampleTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';

  test('extracts trace-id from valid traceparent header', () => {
    const traceparent = `00-${sampleTraceId}-00f067aa0ba902b7-01`;
    expect(extractTraceIdFromTraceparent(traceparent)).toBe(sampleTraceId);
  });

  test('returns null for malformed traceparent', () => {
    expect(extractTraceIdFromTraceparent('invalid')).toBeNull();
    expect(extractTraceIdFromTraceparent('00-bad-id-01')).toBeNull();
  });

  test('returns null for uppercase traceId (not W3C compliant)', () => {
    const upperTraceId = '4BF92F3577B34DA6A3CE929D0E0E4736';
    const traceparent = `00-${upperTraceId}-00f067aa0ba902b7-01`;
    expect(extractTraceIdFromTraceparent(traceparent)).toBeNull();
  });
});

describe('resolveTraceId', () => {
  test('uses X-Trace-Id header when present', () => {
    const customId = 'aabbccddeeff00112233445566778899';
    const ctx = makeCtx({ 'X-Trace-Id': customId });
    expect(resolveTraceId(ctx)).toBe(customId);
  });

  test('falls back to traceparent when X-Trace-Id is absent', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const ctx = makeCtx({
      'X-Trace-Id': null,
      traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
    });
    expect(resolveTraceId(ctx)).toBe(traceId);
  });

  test('generates a 32-hex id when no headers are present', () => {
    const ctx = makeCtx({ 'X-Trace-Id': null, traceparent: null });
    const id = resolveTraceId(ctx);
    expect(id).toMatch(TRACE_ID_RE);
  });

  test('generated id is unique per call', () => {
    const ctx = makeCtx({});
    const ids = new Set(Array.from({ length: 50 }, () => resolveTraceId(ctx)));
    expect(ids.size).toBe(50);
  });

  test('X-Trace-Id takes precedence over traceparent', () => {
    const explicitId = 'ffffffffffffffffffffffffffffffff';
    const ctx = makeCtx({
      'X-Trace-Id': explicitId,
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
    expect(resolveTraceId(ctx)).toBe(explicitId);
  });
});
