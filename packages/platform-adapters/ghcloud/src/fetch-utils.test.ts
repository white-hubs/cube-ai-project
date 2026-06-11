import { describe, expect, it } from 'bun:test';
import { doFetchJson } from './fetch-utils';
import { GhcloudPlatformError } from './errors';

function neverAbort(): AbortSignal {
  return new AbortController().signal;
}

function asFetch(impl: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return impl as unknown as typeof fetch;
}

async function expectPlatformError(
  promise: Promise<unknown>,
  code: GhcloudPlatformError['code'],
): Promise<GhcloudPlatformError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(GhcloudPlatformError);
    const err = e as GhcloudPlatformError;
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error(`expected GhcloudPlatformError(${code}) but promise resolved`);
}

describe('doFetchJson', () => {
  it('returns parsed JSON body and status on 2xx', async () => {
    const out = await doFetchJson({
      url: 'http://upstream/ok',
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: neverAbort(),
      timeoutMs: 1000,
      fetchImpl: asFetch(async () =>
        new Response(JSON.stringify({ ok: true, n: 7 }), { status: 200 })),
    });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true, n: 7 });
  });

  it('serializes bodyJson for POST and forwards method/headers', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const out = await doFetchJson({
      url: 'http://upstream/create',
      method: 'POST',
      headers: { 'x-trace': 'abc' },
      bodyJson: { name: '一只小猫' },
      signal: neverAbort(),
      timeoutMs: 1000,
      fetchImpl: asFetch(async (url, init) => {
        seenUrl = String(url);
        seenInit = init;
        return new Response('{"id":1}', { status: 201 });
      }),
    });
    expect(out.status).toBe(201);
    expect(seenUrl).toBe('http://upstream/create');
    expect(seenInit?.method).toBe('POST');
    expect((seenInit?.headers as Record<string, string>)['x-trace']).toBe('abc');
    expect(JSON.parse(String(seenInit?.body))).toEqual({ name: '一只小猫' });
  });

  it('omits body when bodyJson is undefined', async () => {
    let seenBody: unknown = 'sentinel';
    await doFetchJson({
      url: 'http://upstream/list',
      method: 'GET',
      headers: {},
      signal: neverAbort(),
      timeoutMs: 1000,
      fetchImpl: asFetch(async (_url, init) => {
        seenBody = init?.body;
        return new Response('[]', { status: 200 });
      }),
    });
    expect(seenBody).toBeUndefined();
  });

  it('empty 2xx body parses to undefined; non-JSON text body kept as raw string', async () => {
    const empty = await doFetchJson({
      url: 'http://upstream/empty',
      method: 'DELETE',
      headers: {},
      signal: neverAbort(),
      timeoutMs: 1000,
      fetchImpl: asFetch(async () => new Response('', { status: 204 })),
    });
    expect(empty.body).toBeUndefined();

    const text = await doFetchJson({
      url: 'http://upstream/text',
      method: 'GET',
      headers: {},
      signal: neverAbort(),
      timeoutMs: 1000,
      fetchImpl: asFetch(async () => new Response('plain text', { status: 200 })),
    });
    expect(text.body).toBe('plain text');
  });

  it('maps 401/403 to UPSTREAM_AUTH_FAILED with status + body details', async () => {
    for (const status of [401, 403]) {
      const err = await expectPlatformError(
        doFetchJson({
          url: 'http://upstream/secure',
          method: 'GET',
          headers: {},
          signal: neverAbort(),
          timeoutMs: 1000,
          fetchImpl: asFetch(async () =>
            new Response(JSON.stringify({ message: 'denied' }), { status })),
        }),
        'UPSTREAM_AUTH_FAILED',
      );
      expect(err.details?.status).toBe(status);
      expect(err.details?.body).toEqual({ message: 'denied' });
    }
  });

  it('maps 404 to RESOURCE_NOT_FOUND_REMOTE', async () => {
    const err = await expectPlatformError(
      doFetchJson({
        url: 'http://upstream/missing',
        method: 'GET',
        headers: {},
        signal: neverAbort(),
        timeoutMs: 1000,
        fetchImpl: asFetch(async () => new Response('not found', { status: 404 })),
      }),
      'RESOURCE_NOT_FOUND_REMOTE',
    );
    expect(err.details?.status).toBe(404);
    expect(err.message).toContain('HTTP 404');
  });

  it('maps other non-2xx (incl. non-JSON 5xx) to UPSTREAM_TOOL_HTTP_FAILED', async () => {
    const err = await expectPlatformError(
      doFetchJson({
        url: 'http://upstream/boom',
        method: 'POST',
        headers: {},
        signal: neverAbort(),
        timeoutMs: 1000,
        fetchImpl: asFetch(async () =>
          new Response('<html>Internal Server Error</html>', { status: 500 })),
      }),
      'UPSTREAM_TOOL_HTTP_FAILED',
    );
    expect(err.details?.status).toBe(500);
    expect(err.details?.body).toBe('<html>Internal Server Error</html>');
  });

  it('maps per-call timeout to UPSTREAM_NETWORK_TIMEOUT', async () => {
    const hangUntilAbort = asFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );

    const err = await expectPlatformError(
      doFetchJson({
        url: 'http://upstream/slow',
        method: 'GET',
        headers: {},
        signal: neverAbort(),
        timeoutMs: 10,
        fetchImpl: hangUntilAbort,
      }),
      'UPSTREAM_NETWORK_TIMEOUT',
    );
    expect(err.message).toContain('timed out after 10ms');
  });

  it('caller abort signal also aborts the composed fetch', async () => {
    const caller = new AbortController();
    const hangUntilAbort = asFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );

    const pending = doFetchJson({
      url: 'http://upstream/cancelled',
      method: 'GET',
      headers: {},
      signal: caller.signal,
      timeoutMs: 60_000,
      fetchImpl: hangUntilAbort,
    });
    caller.abort();
    await expectPlatformError(pending, 'UPSTREAM_NETWORK_TIMEOUT');
  });

  it('maps generic network failure to UPSTREAM_TOOL_HTTP_FAILED with cause message', async () => {
    const err = await expectPlatformError(
      doFetchJson({
        url: 'http://upstream/down',
        method: 'GET',
        headers: {},
        signal: neverAbort(),
        timeoutMs: 1000,
        fetchImpl: asFetch(async () => {
          throw new TypeError('Unable to connect');
        }),
      }),
      'UPSTREAM_TOOL_HTTP_FAILED',
    );
    expect(err.message).toContain('Unable to connect');
  });
});
