/**
 * Unit tests: OAuth2 Introspection Middleware.
 * ref: P3-02-auth-oauth2 §5
 */
import { describe, it, expect } from 'bun:test';
import {
  createOAuth2IntrospectionMiddleware,
  type OAuth2IntrospectionMiddlewareDeps,
} from './oauth2-introspection.middleware';
import { DualSubjectService } from './dual-subject.service';
import { getSharedMockOboService } from './mock-obo.service';

function makeCtx(opts: {
  path?: string;
  headers?: Record<string, string>;
}) {
  return {
    path: opts.path ?? '/v1/sessions',
    headers: opts.headers ?? {},
    state: {} as Record<string, unknown>,
  };
}

type MockContext = {
  path: string;
  headers: Record<string, string> | Headers;
  state: Record<string, unknown>;
};

async function runMiddleware(
  mw: ReturnType<typeof createOAuth2IntrospectionMiddleware>,
  ctx: MockContext,
  authMode = 'mock',
) {
  const prev = process.env.AGENTIC_ENGINE_AUTH_MODE;
  process.env.AGENTIC_ENGINE_AUTH_MODE = authMode;
  try {
    let nextCalled = false;
    const next = async () => {
      nextCalled = true;
    };
    await (mw as unknown as (ctx: unknown, next: () => Promise<void>) => Promise<void>)(
      ctx,
      next,
    );
    return { nextCalled, state: ctx.state };
  } finally {
    if (prev === undefined) delete process.env.AGENTIC_ENGINE_AUTH_MODE;
    else process.env.AGENTIC_ENGINE_AUTH_MODE = prev;
  }
}

describe('oauth2IntrospectionMiddleware', () => {
  it('mock mode: injects fake DualSubject and calls next()', async () => {
    const mw = createOAuth2IntrospectionMiddleware(testDeps());
    const ctx = makeCtx({
      headers: { 'x-mock-user': 'test-user-01', 'x-mock-tenant': '101' },
    });
    const { nextCalled, state } = await runMiddleware(mw, ctx, 'mock');
    expect(nextCalled).toBe(true);
    expect(state.subject).toBeDefined();
    const subject = state.subject as { user: { userId: string; tenant: number } };
    expect(subject.user.userId).toBe('test-user-01');
    expect(subject.user.tenant).toBe(101);
  });

  it('mock mode: Web Headers / Bun fetch-style ctx.headers (forEach)', async () => {
    const mw = createOAuth2IntrospectionMiddleware(testDeps());
    const webHeaders = new Headers();
    webHeaders.set('Authorization', 'Bearer t');
    webHeaders.set('x-mock-tenant-id', '91103');
    webHeaders.set('x-mock-user-id', 'tenant-switch-user');
    const ctx = {
      path: '/v1/sessions',
      headers: webHeaders,
      state: {} as Record<string, unknown>,
    };
    const { nextCalled, state } = await runMiddleware(mw, ctx, 'mock');
    expect(nextCalled).toBe(true);
    const subject = state.subject as { user: { userId: string; tenant: number }; tenant: number };
    expect(subject.user.userId).toBe('tenant-switch-user');
    expect(subject.user.tenant).toBe(91103);
    expect(subject.tenant).toBe(91103);
  });

  it('mock mode: uses default userId=mock-user and tenant=1 when headers absent', async () => {
    const mw = createOAuth2IntrospectionMiddleware(testDeps());
    const ctx = makeCtx({});
    const { nextCalled, state } = await runMiddleware(mw, ctx, 'mock');
    expect(nextCalled).toBe(true);
    const subject = state.subject as { user: { userId: string; tenant: number } };
    expect(subject.user.userId).toBe('mock-user');
    expect(subject.user.tenant).toBe(1);
  });

  it('mock mode: health endpoint bypasses auth', async () => {
    const mw = createOAuth2IntrospectionMiddleware(testDeps());
    const ctx = makeCtx({ path: '/health/live' });
    const { nextCalled } = await runMiddleware(mw, ctx, 'mock');
    expect(nextCalled).toBe(true);
    expect(ctx.state.subject).toBeUndefined();
  });

  it('oauth2 mode: missing Bearer token throws UNAUTHENTICATED_TOKEN_INVALID', async () => {
    const mw = createOAuth2IntrospectionMiddleware(testDeps());
    const ctx = makeCtx({ headers: {} });
    let error: unknown;
    try {
      await runMiddleware(mw, ctx, 'oauth2');
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    const err = error as { code?: string };
    expect(err.code).toBe('UNAUTHENTICATED_TOKEN_INVALID');
  });

  it('oauth2 mode: oversize token (>4096) throws UNAUTHENTICATED_TOKEN_INVALID', async () => {
    const mw = createOAuth2IntrospectionMiddleware(testDeps());
    const bigToken = 'a'.repeat(4097);
    const ctx = makeCtx({ headers: { authorization: `Bearer ${bigToken}` } });
    let error: unknown;
    try {
      await runMiddleware(mw, ctx, 'oauth2');
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    const err = error as { code?: string };
    expect(err.code).toBe('UNAUTHENTICATED_TOKEN_INVALID');
  });

  it('oauth2 mode: JWT verify failure → UNAUTHENTICATED_TOKEN_INVALID', async () => {
    const deps = testDeps({
      jwtVerifyStep: async () => {
        throw new Error('bad sig');
      },
    });
    const mw = createOAuth2IntrospectionMiddleware(deps);
    const ctx = makeCtx({ headers: { authorization: 'Bearer abc.def.ghi' } });
    let error: unknown;
    try {
      await runMiddleware(mw, ctx, 'oauth2');
    } catch (e) {
      error = e;
    }
    expect((error as { code?: string }).code).toBe('UNAUTHENTICATED_TOKEN_INVALID');
  });

  it('oauth2 mode: cache miss → introspect → subject injected', async () => {
    const prevId = process.env.AGENTIC_ENGINE_OAUTH2_CLIENT_ID;
    const prevSec = process.env.AGENTIC_ENGINE_OAUTH2_CLIENT_SECRET;
    process.env.AGENTIC_ENGINE_OAUTH2_CLIENT_ID = 'engine';
    process.env.AGENTIC_ENGINE_OAUTH2_CLIENT_SECRET = 'secret';

    let introspectCalls = 0;
    const deps = testDeps({
      jwtVerifyStep: async () => ({
        tenant_id: '101',
        exp: Math.floor(Date.now() / 1000) + 120,
      }),
      getRedis: () => null,
      fetchImpl: (async () => {
        introspectCalls++;
        return new Response(
          JSON.stringify({
            active: true,
            user_name: 'alice',
            tenant_id: '101',
            scope: 'openid engine.use',
            exp: Math.floor(Date.now() / 1000) + 120,
            client_id: 'oauth-client',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof fetch,
    });
    const mw = createOAuth2IntrospectionMiddleware(deps);
    const ctx = makeCtx({
      headers: { authorization: 'Bearer mock-jwt-token' },
    });
    const { nextCalled, state } = await runMiddleware(mw, ctx, 'oauth2');
    expect(nextCalled).toBe(true);
    expect(introspectCalls).toBe(1);
    const subject = state.subject as { user: { userId: string }; tenant: number };
    expect(subject.user.userId).toBe('alice');
    expect(subject.tenant).toBe(101);

    process.env.AGENTIC_ENGINE_OAUTH2_CLIENT_ID = prevId;
    process.env.AGENTIC_ENGINE_OAUTH2_CLIENT_SECRET = prevSec;
  });

  it('oauth2 mode: cache hit → introspect not called', async () => {
    const prevId = process.env.AGENTIC_ENGINE_OAUTH2_CLIENT_ID;
    const prevSec = process.env.AGENTIC_ENGINE_OAUTH2_CLIENT_SECRET;
    process.env.AGENTIC_ENGINE_OAUTH2_CLIENT_ID = 'engine';
    process.env.AGENTIC_ENGINE_OAUTH2_CLIENT_SECRET = 'secret';

    const dual = new DualSubjectService();
    const token = 'same-token-value';
    const sha = dual.sha256Hex(token);
    const cachePayload = JSON.stringify({
      active: true,
      userId: 'bob',
      tenant: 202,
      scopes: ['s'],
      exp: Date.now() + 60_000,
      cachedAt: Date.now(),
    });

    let introspectCalls = 0;
    const fakeRedis = {
      get: async (key: string) =>
        key.endsWith(sha) ? cachePayload : null,
      set: async () => 'OK',
    };

    const deps = testDeps({
      jwtVerifyStep: async () => ({
        tenant_id: '202',
        exp: Math.floor(Date.now() / 1000) + 120,
      }),
      getRedis: () => fakeRedis as unknown as import('ioredis').default,
      fetchImpl: (async () => {
        introspectCalls++;
        return new Response('{}', { status: 500 });
      }) as unknown as typeof fetch,
    });
    const mw = createOAuth2IntrospectionMiddleware(deps);
    const ctx = makeCtx({
      headers: { authorization: `Bearer ${token}` },
    });
    const { nextCalled, state } = await runMiddleware(mw, ctx, 'oauth2');
    expect(nextCalled).toBe(true);
    expect(introspectCalls).toBe(0);
    expect((state.subject as { user: { userId: string } }).user.userId).toBe('bob');

    process.env.AGENTIC_ENGINE_OAUTH2_CLIENT_ID = prevId;
    process.env.AGENTIC_ENGINE_OAUTH2_CLIENT_SECRET = prevSec;
  });
});

function testDeps(
  overrides: Partial<OAuth2IntrospectionMiddlewareDeps> = {},
): OAuth2IntrospectionMiddlewareDeps {
  return {
    mockOboService: getSharedMockOboService(),
    dualSubjectService: new DualSubjectService(),
    fetchImpl: globalThis.fetch.bind(globalThis),
    getRedis: () => null,
    jwtVerifyStep: async () => ({}),
    ...overrides,
  };
}

describe('MockOboService.fakeSubject', () => {
  it('returns a DualSubject with user and tenant', () => {
    const subject = getSharedMockOboService().fakeSubject({
      headers: { 'x-mock-user': 'u1', 'x-mock-tenant': '42' },
    });
    expect(subject.user.userId).toBe('u1');
    expect(subject.user.tenant).toBe(42);
    expect(subject.tenant).toBe(42);
  });

  it('user and service are distinguishable', () => {
    const subject = getSharedMockOboService().fakeSubject({});
    expect(subject.user.userId).toBeTruthy();
    expect(subject.service?.clientId).toBe('mock-obo-client');
    expect(typeof subject.tenant).toBe('number');
  });

  it('scopes are present', () => {
    const subject = getSharedMockOboService().fakeSubject({});
    expect(Array.isArray(subject.user.scopes)).toBe(true);
    expect(subject.user.scopes.length).toBeGreaterThanOrEqual(1);
  });
});
