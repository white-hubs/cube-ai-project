/**
 * Unit tests for `idempotencyMiddleware` (T13-G10).
 *
 * Stubs the {@link IdempotencyStore} via an in-memory fake so the tests run
 * without Redis. The fake mirrors the Redis port semantics (TTL is ignored —
 * tests don't simulate expiry).
 *
 * Coverage:
 *  1. GET / DELETE pass through (idempotent verbs)
 *  2. POST without `Idempotency-Key` passes through
 *  3. Bypass paths (/health/*, /metrics) pass through even on POST + key
 *  4. Cache hit → replay returns cached body+status with `X-Idempotent-Replayed`
 *  5. Body hash mismatch → throws FAILED_PRECONDITION_IDEMPOTENCY_KEY_REUSED (412)
 *  6. Concurrent same key (lock not acquired) → throws RESOURCE_CONFLICT_IDEMPOTENCY_INFLIGHT (409)
 *  7. First-write success populates store with body hash + 2xx response
 *  8. 5xx response is NOT persisted (retries should re-attempt)
 */
import { describe, expect, it, mock } from 'bun:test';
import type { Context, NextFunction } from '@dangao/bun-server';
import { AgenticEngineError } from '../errors/agentic-error';
import { createIdempotencyMiddleware } from './idempotency.middleware';
import type { IdempotencyEntry, IdempotencyStore } from './idempotency.types';

class InMemoryStore implements IdempotencyStore {
  readonly entries = new Map<string, IdempotencyEntry>();
  readonly locks = new Set<string>();

  async get(key: string): Promise<IdempotencyEntry | null> {
    return this.entries.get(key) ?? null;
  }
  async set(key: string, entry: IdempotencyEntry): Promise<void> {
    this.entries.set(key, entry);
  }
  async acquireLock(key: string): Promise<boolean> {
    if (this.locks.has(key)) return false;
    this.locks.add(key);
    return true;
  }
  async releaseLock(key: string): Promise<void> {
    this.locks.delete(key);
  }
}

interface FakeCtx {
  request: Request;
  method: string;
  path: string;
  reqHeaders: Map<string, string>;
  resHeaders: Map<string, string>;
  state: { subject?: { user?: { userId?: string } } };
  getHeader(key: string): string | null;
  setHeader(key: string, value: string): void;
}

interface MakeCtxOpts {
  method?: string;
  path?: string;
  body?: string;
  headers?: Record<string, string>;
  userId?: string;
}

function makeCtx(opts: MakeCtxOpts = {}): FakeCtx {
  const method = opts.method ?? 'POST';
  const path = opts.path ?? '/sessions';
  const headers = opts.headers ?? {};
  const reqHeaders = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) {
    reqHeaders.set(k, v);
    reqHeaders.set(k.toLowerCase(), v);
  }
  const url = `http://localhost${path}`;
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD' && opts.body !== undefined) {
    init.body = opts.body;
  }
  const request = new Request(url, init);
  return {
    request,
    method,
    path,
    reqHeaders,
    resHeaders: new Map<string, string>(),
    state: { subject: { user: { userId: opts.userId ?? 'u-1' } } },
    getHeader(key: string): string | null {
      return reqHeaders.get(key) ?? reqHeaders.get(key.toLowerCase()) ?? null;
    },
    setHeader(key: string, value: string): void {
      this.resHeaders.set(key, value);
    },
  };
}

const okJsonNext: (body: unknown, status?: number) => NextFunction =
  (body, status = 200) =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

describe('idempotencyMiddleware', () => {
  it('passes through GET requests (non-idempotent-method gate)', async () => {
    const store = new InMemoryStore();
    const mw = createIdempotencyMiddleware({ store });
    const ctx = makeCtx({
      method: 'GET',
      headers: { 'Idempotency-Key': 'k1' },
    });
    const next = mock(okJsonNext({ ok: true }));

    const res = await mw(ctx as unknown as Context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(store.entries.size).toBe(0);
  });

  it('passes through DELETE requests (idempotent-by-convention)', async () => {
    const store = new InMemoryStore();
    const mw = createIdempotencyMiddleware({ store });
    const ctx = makeCtx({
      method: 'DELETE',
      headers: { 'Idempotency-Key': 'k1' },
    });
    const next = mock(okJsonNext({ ok: true }));

    await mw(ctx as unknown as Context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(store.entries.size).toBe(0);
  });

  it('passes through POST without Idempotency-Key header', async () => {
    const store = new InMemoryStore();
    const mw = createIdempotencyMiddleware({ store });
    const ctx = makeCtx({ method: 'POST', body: '{"a":1}' });
    const next = mock(okJsonNext({ id: 1 }, 201));

    await mw(ctx as unknown as Context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(store.entries.size).toBe(0);
  });

  it('passes through bypass paths even with key + POST', async () => {
    const store = new InMemoryStore();
    const mw = createIdempotencyMiddleware({ store });
    for (const path of ['/health/live', '/health/ready', '/metrics']) {
      const ctx = makeCtx({
        method: 'POST',
        path,
        headers: { 'Idempotency-Key': 'k1' },
        body: '{}',
      });
      const next = mock(okJsonNext({ ok: true }));
      await mw(ctx as unknown as Context, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(store.entries.size).toBe(0);
    }
  });

  it('first POST persists response and lock is released', async () => {
    const store = new InMemoryStore();
    const mw = createIdempotencyMiddleware({ store });
    const ctx = makeCtx({
      method: 'POST',
      headers: { 'Idempotency-Key': 'k1' },
      body: '{"prompt":"hi"}',
    });
    const next = mock(okJsonNext({ id: 'sess-1' }, 201));

    const res = await mw(ctx as unknown as Context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(201);
    expect(store.entries.size).toBe(1);
    expect(store.locks.size).toBe(0);
    const entry = [...store.entries.values()][0]!;
    expect(entry.status).toBe(201);
    expect(JSON.parse(entry.bodyJson)).toEqual({ id: 'sess-1' });
    expect(entry.bodyHash.length).toBe(64); // sha256 hex
  });

  it('replays cached response (same key + same body) and sets X-Idempotent-Replayed', async () => {
    const store = new InMemoryStore();
    const mw = createIdempotencyMiddleware({ store });
    const body = '{"prompt":"hi"}';

    // First call populates the store.
    const ctx1 = makeCtx({
      method: 'POST',
      headers: { 'Idempotency-Key': 'k1' },
      body,
    });
    await mw(ctx1 as unknown as Context, okJsonNext({ id: 'sess-1' }, 201));

    // Second call replays — `next` must NOT be invoked.
    const ctx2 = makeCtx({
      method: 'POST',
      headers: { 'Idempotency-Key': 'k1' },
      body,
    });
    const next2 = mock(okJsonNext({ id: 'should-not-run' }, 500));
    const res2 = await mw(ctx2 as unknown as Context, next2);

    expect(next2).not.toHaveBeenCalled();
    expect(res2.status).toBe(201);
    expect(res2.headers.get('X-Idempotent-Replayed')).toBe('1');
    const json = await res2.json();
    expect(json).toEqual({ id: 'sess-1' });
  });

  it('throws FAILED_PRECONDITION_IDEMPOTENCY_KEY_REUSED on body hash mismatch', async () => {
    const store = new InMemoryStore();
    const mw = createIdempotencyMiddleware({ store });

    const ctx1 = makeCtx({
      method: 'POST',
      headers: { 'Idempotency-Key': 'k1' },
      body: '{"a":1}',
    });
    await mw(ctx1 as unknown as Context, okJsonNext({ ok: true }, 201));

    const ctx2 = makeCtx({
      method: 'POST',
      headers: { 'Idempotency-Key': 'k1' },
      body: '{"a":2}', // different body, same key
    });
    const next2 = mock(okJsonNext({ ok: true }));

    let thrown: unknown;
    try {
      await mw(ctx2 as unknown as Context, next2);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AgenticEngineError);
    expect((thrown as AgenticEngineError).code).toBe(
      'FAILED_PRECONDITION_IDEMPOTENCY_KEY_REUSED',
    );
    expect((thrown as AgenticEngineError).httpStatus).toBe(412);
    expect(next2).not.toHaveBeenCalled();
  });

  it('throws RESOURCE_CONFLICT_IDEMPOTENCY_INFLIGHT when lock is not acquired', async () => {
    const store = new InMemoryStore();
    const mw = createIdempotencyMiddleware({ store });

    // Pre-occupy the lock by mutating the in-memory store directly to simulate
    // a concurrent in-flight call.
    const composedKey = 'u-1|POST|/sessions|k1';
    store.locks.add(composedKey);

    const ctx = makeCtx({
      method: 'POST',
      headers: { 'Idempotency-Key': 'k1' },
      body: '{"x":1}',
    });
    const next = mock(okJsonNext({ ok: true }));

    let thrown: unknown;
    try {
      await mw(ctx as unknown as Context, next);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AgenticEngineError);
    expect((thrown as AgenticEngineError).code).toBe(
      'RESOURCE_CONFLICT_IDEMPOTENCY_INFLIGHT',
    );
    expect((thrown as AgenticEngineError).httpStatus).toBe(409);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not persist non-2xx responses', async () => {
    const store = new InMemoryStore();
    const mw = createIdempotencyMiddleware({ store });
    const ctx = makeCtx({
      method: 'POST',
      headers: { 'Idempotency-Key': 'k1' },
      body: '{"x":1}',
    });
    const next: NextFunction = () =>
      Promise.resolve(
        new Response('{"err":true}', {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const res = await mw(ctx as unknown as Context, next);
    expect(res.status).toBe(500);
    expect(store.entries.size).toBe(0);
    expect(store.locks.size).toBe(0); // released in finally
  });

  it('isolates keys per subject (different userId → different cache slot)', async () => {
    const store = new InMemoryStore();
    const mw = createIdempotencyMiddleware({ store });

    const ctx1 = makeCtx({
      method: 'POST',
      headers: { 'Idempotency-Key': 'k1' },
      body: '{}',
      userId: 'u-1',
    });
    await mw(ctx1 as unknown as Context, okJsonNext({ from: 'u-1' }, 201));

    const ctx2 = makeCtx({
      method: 'POST',
      headers: { 'Idempotency-Key': 'k1' },
      body: '{}',
      userId: 'u-2',
    });
    const next2 = mock(okJsonNext({ from: 'u-2' }, 201));
    const res2 = await mw(ctx2 as unknown as Context, next2);

    expect(next2).toHaveBeenCalledTimes(1);
    expect(res2.headers.get('X-Idempotent-Replayed')).toBeNull();
    expect(store.entries.size).toBe(2);
  });
});
