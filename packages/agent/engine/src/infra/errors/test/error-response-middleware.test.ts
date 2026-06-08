import { describe, expect, test } from 'bun:test';
import { AgenticEngineError } from '../agentic-error';
import { createErrorResponseMiddleware } from '../error-response-middleware';
import type { Context } from '@dangao/bun-server';

import { MetricsRegistry } from '../../observability/metrics-registry';

function makeCtx(traceId?: string): Context {
  const responseHeaders = new Headers();
  if (traceId) responseHeaders.set('X-Trace-Id', traceId);

  return {
    responseHeaders,
    state: {},
    getHeader: (_key: string) => null,
    setHeader: (key: string, val: string) => responseHeaders.set(key, val),
    setStatus: (_code: number) => {},
    createErrorResponse: (body: unknown, init?: ResponseInit) => {
      const initTyped = init as
        | (ResponseInit & {
            status?: number;
            headers?: Record<string, string>;
          })
        | undefined;
      return new Response(JSON.stringify(body), {
        status: initTyped?.status ?? 500,
        headers: {
          'Content-Type': 'application/json',
          ...(initTyped?.headers ?? {}),
        },
      });
    },
  } as unknown as Context;
}

function mw() {
  return createErrorResponseMiddleware(new MetricsRegistry());
}

describe('createErrorResponseMiddleware', () => {
  test('passes through successful response unchanged', async () => {
    const ctx = makeCtx('aabbcc00112233445566778899aabbcc');
    const okResponse = new Response('{"ok":true}', { status: 200 });
    const result = await mw()(ctx, async () => okResponse);
    expect(result.status).toBe(200);
  });

  test('AgenticEngineError → correct HTTP status + 5-field envelope', async () => {
    const ctx = makeCtx('aabbcc00112233445566778899aabbcc');
    const err = AgenticEngineError.fromCode(
      'RESOURCE_NOT_FOUND_SESSION',
      'session not found',
    );

    const result = await mw()(ctx, async () => {
      throw err;
    });

    expect(result.status).toBe(404);
    const body = (await result.json()) as Record<string, unknown>;
    expect(body.status).toBe(404);
    expect(body.code).toBe('RESOURCE_NOT_FOUND_SESSION');
    expect(body.message).toBe('session not found');
    expect(body.timestamp).toBeTypeOf('number');
    expect(body.details).toBeDefined();
    expect((body.details as Record<string, unknown>).traceId).toBe(
      'aabbcc00112233445566778899aabbcc',
    );
  });

  test('unknown Error → 500 INTERNAL_UNKNOWN', async () => {
    const ctx = makeCtx('00000000000000000000000000000000');
    const result = await mw()(ctx, async () => {
      throw new Error('database crashed');
    });

    expect(result.status).toBe(500);
    const body = (await result.json()) as Record<string, unknown>;
    expect(body.code).toBe('INTERNAL_UNKNOWN');
  });

  test('stack trace NOT in response body (§10.6 PII禁入)', async () => {
    const ctx = makeCtx('00000000000000000000000000000000');
    const result = await mw()(ctx, async () => {
      throw new Error('sensitive internal message');
    });
    const text = await result.text();
    expect(text).not.toContain('sensitive internal message');
    expect(text).not.toContain('Error:');
    expect(text).not.toContain('at Object');
  });

  test('X-Trace-Id is present in response headers (§10.2)', async () => {
    const ctx = makeCtx('aabbcc00112233445566778899aabbcc');
    const err = AgenticEngineError.fromCode('INTERNAL_UNKNOWN', 'err');
    const result = await mw()(ctx, async () => {
      throw err;
    });
    expect(result.headers.get('X-Trace-Id')).toBe('aabbcc00112233445566778899aabbcc');
  });

  test('5-field envelope has all required fields', async () => {
    const ctx = makeCtx('ffffffffffffffffffffffffffffffff');
    const err = AgenticEngineError.fromCode(
      'RATELIMIT_SESSION_EXCEEDED',
      'rate limited',
    );
    const result = await mw()(ctx, async () => {
      throw err;
    });
    const body = (await result.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining([
        'status',
        'code',
        'message',
        'details',
        'timestamp',
      ]),
    );
  });
});
