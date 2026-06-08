import { describe, test, expect } from 'bun:test';
import { OpenApiHandler } from './openapi-handler';
import type { ToolHandlerCtx } from '../tool-context';

const ctx: ToolHandlerCtx = {
  traceId: 'x',
  signal:  new AbortController().signal,
  auth:    { tenant: 1, user: { userId: 'u', scopes: [] } },
  session: { id: '1234567890123456789', turnId: '1234567890123456788' },
};

describe('OpenApiHandler', () => {
  test('本地 spec + GET operationId → 200', async () => {
    let srv!: ReturnType<typeof Bun.serve>;
    srv = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        const port = srv.port;
        if (url.pathname === '/openapi.json') {
          return Response.json({
            openapi: '3.0.0',
            servers: [{ url: `http://127.0.0.1:${port}` }],
            paths:   {
              '/hello': {
                get: {
                  operationId: 'sayHello',
                  responses:   { '200': { description: 'ok' } },
                },
              },
            },
          });
        }
        if (url.pathname === '/hello') return Response.json({ hello: 'world' });
        return new Response('no', { status: 404 });
      },
    });
    try {
      const base = `http://127.0.0.1:${srv.port}`;
      const h    = new OpenApiHandler();
      const out  = await h.invoke(
        {
          specUrl:     `${base}/openapi.json`,
          operationId: 'sayHello',
        },
        ctx,
      );
      expect(out.statusCode).toBe(200);
      expect(out.body).toEqual({ hello: 'world' });
    } finally {
      srv.stop();
    }
  });

  test('operationId 不存在 → RESOURCE_NOT_FOUND_DESCRIPTOR', async () => {
    const spec = {
      openapi: '3.0.0',
      servers: [{ url: 'http://x' }],
      paths:   {},
    };
    const server = Bun.serve({
      port: 0,
      routes: {
        '/s.json': () => Response.json(spec),
      },
    });
    try {
      const h = new OpenApiHandler();
      await expect(
        h.invoke(
          {
            specUrl:     `http://127.0.0.1:${server.port}/s.json`,
            operationId: 'nope',
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND_DESCRIPTOR' });
    } finally {
      server.stop();
    }
  });
});
