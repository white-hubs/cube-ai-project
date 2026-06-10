import { describe, expect, it } from 'bun:test';
import type { FlowCatalogListRequest } from '@cube-ai/contracts';
import { GhcloudFlowCatalogAdapter } from './flow-catalog.adapter';
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

const baseListReq: FlowCatalogListRequest = {
  tenant: 9,
  traceId: 'trace-list-1',
};

describe('GhcloudFlowCatalogAdapter', () => {
  it('GETs /ai/flows with tenant + trace headers', async () => {
    const m = mockFetch(() =>
      new Response(JSON.stringify([{ id: '7', name: 'Seven', description: null, enabled: true }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = new GhcloudFlowCatalogAdapter({
      baseUrl: 'http://aias.test',
      tokenProvider: async () => 'svc',
      fetchImpl: m.fn,
    });
    const out = await adapter.list(baseListReq, new AbortController().signal);
    expect(m.calls).toHaveLength(1);
    const req = m.calls[0]!;
    expect(req.method).toBe('GET');
    expect(req.url.startsWith('http://aias.test/ai/flows')).toBe(true);
    expect(req.headers.get('authorization')).toBe('Bearer svc');
    expect(req.headers.get('tenant')).toBe('9');
    expect(req.headers.get('x-trace-id')).toBe('trace-list-1');
    expect(out.flows).toEqual([
      { flowId: '7', name: 'Seven', description: null, enabled: true },
    ]);
    expect(out.pagination).toBeUndefined();
  });

  it('maps paged { records } and forwards keyword query', async () => {
    const m = mockFetch(() =>
      new Response(
        JSON.stringify({
          total: 2,
          pages: 1,
          currentPage: 1,
          pageSize: 10,
          records: [{ id: 'a', name: 'A', compileStatus: 'OK' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = new GhcloudFlowCatalogAdapter({
      baseUrl: 'http://aias.test/',
      tokenProvider: async () => 't',
      fetchImpl: m.fn,
    });
    const out = await adapter.list(
      { ...baseListReq, keyword: '  x  ', pageNumber: 1, pageSize: 10 },
      new AbortController().signal,
    );
    expect(out.flows[0]!.flowId).toBe('a');
    expect(out.pagination?.total).toBe(2);
    const u = new URL(m.calls[0]!.url);
    expect(u.searchParams.get('keyword')).toBe('x');
    expect(u.searchParams.get('pageNumber')).toBe('1');
    expect(u.searchParams.get('pageSize')).toBe('10');
  });

  it('uses userToken when provided', async () => {
    const m = mockFetch(() =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    let n = 0;
    const adapter = new GhcloudFlowCatalogAdapter({
      baseUrl: 'http://aias.test',
      tokenProvider: async () => {
        n += 1;
        return 'svc';
      },
      fetchImpl: m.fn,
    });
    await adapter.list({ ...baseListReq, userToken: 'obo' }, new AbortController().signal);
    expect(m.calls[0]!.headers.get('authorization')).toBe('Bearer obo');
    expect(n).toBe(0);
  });

  it('maps 401 to UPSTREAM_AUTH_FAILED', async () => {
    const m = mockFetch(() => new Response('nope', { status: 401 }));
    const adapter = new GhcloudFlowCatalogAdapter({
      baseUrl: 'http://aias.test',
      tokenProvider: async () => 't',
      fetchImpl: m.fn,
    });
    let caught: unknown;
    try {
      await adapter.list(baseListReq, new AbortController().signal);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GhcloudPlatformError);
    expect((caught as GhcloudPlatformError).code).toBe('UPSTREAM_AUTH_FAILED');
  });
});
