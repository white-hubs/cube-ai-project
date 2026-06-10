import { describe, expect, it } from 'bun:test';
import type { FlowInvokeRequest } from '@cube-ai/contracts';
import { GhcloudFlowInvokerAdapter } from './flow.adapter';
import { GhcloudPlatformError } from '../errors';

function mockFetch(handler: (req: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    calls.push(req);
    return handler(req);
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

const baseReq: FlowInvokeRequest = {
  tenant: 1,
  flowId: 'flow-1',
  variables: { topic: 'sales', prompt: '一只小猫' },
  traceId: 'trace-1',
};

describe('GhcloudFlowInvokerAdapter', () => {
  it('POSTs to /ai/flows/:id/run-stream with engine-caller header and run-stream body', async () => {
    const m = mockFetch(() =>
      new Response(
        JSON.stringify({
          ok: true,
          outputs: { imageUrl: 'https://cdn.example/cat.png' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = new GhcloudFlowInvokerAdapter({
      baseUrl: 'http://aias.test',
      tokenProvider: async () => 'svc-token',
      fetchImpl: m.fn,
    });

    const resp = await adapter.invoke(baseReq, new AbortController().signal);

    expect(m.calls).toHaveLength(1);
    const req = m.calls[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('http://aias.test/ai/flows/flow-1/run-stream');
    expect(req.headers.get('authorization')).toBe('Bearer svc-token');
    expect(req.headers.get('tenant')).toBe('1');
    expect(req.headers.get('terminal')).toBe('bimops-manage-web');
    expect(req.headers.get('x-trace-id')).toBe('trace-1');
    expect(req.headers.get('x-engine-caller')).toBe('cube-agentic-engine');
    const body = await req.json();
    expect(body).toEqual({
      inputType: 'chat',
      outputType: 'chat',
      input: '一只小猫',
      tweaks: { topic: 'sales', prompt: '一只小猫' },
    });

    expect(resp.result.outputs).toEqual({ imageUrl: 'https://cdn.example/cat.png' });
  });

  it('rejects legacy scheduled envelope instead of treating it as success', async () => {
    const m = mockFetch(() =>
      new Response(
        JSON.stringify({
          scheduled: true,
          jobId: '1234567890123456789',
          remoteFlowRunId: 'remote-1',
          estimatedDurationMs: 30000,
          statusUrl: '/v1/jobs/1234567890123456789',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = new GhcloudFlowInvokerAdapter({
      baseUrl: 'http://aias.test',
      tokenProvider: async () => 'svc-token',
      fetchImpl: m.fn,
    });

    let caught: unknown;
    try {
      await adapter.invoke(baseReq, new AbortController().signal);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GhcloudPlatformError);
    expect((caught as GhcloudPlatformError).code).toBe('FAILED_PRECONDITION_UPSTREAM');
  });

  it('aggregates SSE run-stream until terminal outputs', async () => {
    const m = mockFetch(() =>
      new Response(
        [
          'data: {"event":"progress","message":"warming up"}',
          '',
          'data: {"event":"done","outputs":{"imageUrl":"https://cdn.example/cat.png"}}',
          '',
        ].join('\n'),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    );

    const adapter = new GhcloudFlowInvokerAdapter({
      baseUrl: 'http://aias.test',
      tokenProvider: async () => 'svc-token',
      fetchImpl: m.fn,
    });

    const resp = await adapter.invoke(baseReq, new AbortController().signal);
    expect(resp.result).toEqual({ imageUrl: 'https://cdn.example/cat.png' });
    expect(resp.executionTrace?.length).toBe(2);
  });

  it('falls back to /run when run-stream is unavailable', async () => {
    const m = mockFetch((req) => {
      if (req.url.endsWith('/run-stream')) {
        return new Response('missing', { status: 404 });
      }
      return new Response(JSON.stringify({ ok: true, phase: 'done' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const adapter = new GhcloudFlowInvokerAdapter({
      baseUrl: 'http://aias.test',
      tokenProvider: async () => 'svc-token',
      fetchImpl: m.fn,
    });

    const resp = await adapter.invoke(baseReq, new AbortController().signal);
    expect(m.calls).toHaveLength(2);
    expect(m.calls[0]!.url).toContain('/run-stream');
    expect(m.calls[1]!.url).toContain('/run');
    expect(resp.result.ok).toBe(true);
  });

  it('uses userToken when provided, falling back to tokenProvider when absent', async () => {
    const m = mockFetch(() =>
      new Response(
        JSON.stringify({ ok: true, phase: 'done' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    let providerCalls = 0;
    const adapter = new GhcloudFlowInvokerAdapter({
      baseUrl: 'http://aias.test',
      tokenProvider: async () => {
        providerCalls += 1;
        return 'svc';
      },
      fetchImpl: m.fn,
    });

    await adapter.invoke({ ...baseReq, userToken: 'user-tok' }, new AbortController().signal);
    expect(m.calls[0]!.headers.get('authorization')).toBe('Bearer user-tok');
    expect(providerCalls).toBe(0);

    await adapter.invoke(baseReq, new AbortController().signal);
    expect(m.calls[1]!.headers.get('authorization')).toBe('Bearer svc');
    expect(providerCalls).toBe(1);
  });

  it('maps 5xx to UPSTREAM_TOOL_HTTP_FAILED', async () => {
    const m = mockFetch(() => new Response('boom', { status: 502 }));
    const adapter = new GhcloudFlowInvokerAdapter({
      baseUrl: 'http://aias.test',
      tokenProvider: async () => 't',
      fetchImpl: m.fn,
    });
    let caught: unknown;
    try {
      await adapter.invoke(baseReq, new AbortController().signal);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GhcloudPlatformError);
    expect((caught as GhcloudPlatformError).code).toBe('UPSTREAM_TOOL_HTTP_FAILED');
  });

  it('rejects non-object remote response', async () => {
    const m = mockFetch(() =>
      new Response(JSON.stringify(['not-an-object']), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = new GhcloudFlowInvokerAdapter({
      baseUrl: 'http://aias.test',
      tokenProvider: async () => 't',
      fetchImpl: m.fn,
    });
    let caught: unknown;
    try {
      await adapter.invoke(baseReq, new AbortController().signal);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GhcloudPlatformError);
    expect((caught as GhcloudPlatformError).code).toBe('INVALID_ARGUMENT_SCHEMA_VIOLATION');
  });

  it('honors caller AbortSignal', async () => {
    const m = mockFetch(
      async () => new Promise<Response>(() => undefined),
    );
    const adapter = new GhcloudFlowInvokerAdapter({
      baseUrl: 'http://aias.test',
      tokenProvider: async () => 't',
      fetchImpl: m.fn,
      timeoutMs: 60_000,
    });
    const ctrl = new AbortController();
    const p = adapter.invoke(baseReq, ctrl.signal);
    queueMicrotask(() => ctrl.abort());
    let caught: unknown;
    try {
      await p;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GhcloudPlatformError);
    expect((caught as GhcloudPlatformError).code).toBe('UPSTREAM_NETWORK_TIMEOUT');
  });
});
