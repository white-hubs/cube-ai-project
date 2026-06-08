/**
 * HttpHandler 单测。
 */
import { describe, test, expect } from 'bun:test';
import { HttpHandler } from './http-handler';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import type { ToolHandlerCtx } from '../tool-context';

const MOCK_CTX: ToolHandlerCtx = {
  traceId: 'test-trace',
  signal:  new AbortController().signal,
  auth:    { tenant: 1, user: { userId: '1', scopes: [] } },
  session: { id: '1234567890123456789', turnId: '1234567890123456788' },
};

describe('HttpHandler', () => {
  test('kind === http', () => {
    expect(new HttpHandler().kind).toBe('http');
  });

  test('GET JSON echo server → 200 + body', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({ ok: true }, { headers: { 'Content-Type': 'application/json' } }),
    });
    try {
      const handler = new HttpHandler();
      const url = `http://127.0.0.1:${server.port}/`;
      const out = await handler.invoke({ url, method: 'GET' }, MOCK_CTX);
      expect(out.statusCode).toBe(200);
      expect(out.body).toEqual({ ok: true });
    } finally {
      server.stop();
    }
  });

  test('非法 URL → INVALID_ARGUMENT_SCHEMA_VIOLATION', async () => {
    const handler = new HttpHandler();
    await expect(
      handler.invoke({ url: 'not-a-url', method: 'GET' }, MOCK_CTX),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT_SCHEMA_VIOLATION' });
  });

  test('upstream 503 + 重试耗尽 → UPSTREAM_TOOL_HTTP_FAILED', async () => {
    let n = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        n++;
        return new Response('no', { status: 503 });
      },
    });
    try {
      process.env['AGENTIC_ENGINE_HTTP_RETRY_MAX'] = '2';
      const handler = new HttpHandler();
      await expect(
        handler.invoke(
          { url: `http://127.0.0.1:${server.port}/`, method: 'GET' },
          MOCK_CTX,
        ),
      ).rejects.toThrow(AgenticEngineError);
      expect(n).toBeGreaterThanOrEqual(2);
    } finally {
      delete process.env['AGENTIC_ENGINE_HTTP_RETRY_MAX'];
      server.stop();
    }
  });
});
