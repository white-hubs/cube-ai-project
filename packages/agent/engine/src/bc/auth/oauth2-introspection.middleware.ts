/**
 * OAuth2 Introspection Middleware (AuthN layer).
 *
 * ref: docs/detailed-design/04-auth-and-authz/oauth2-flow.md §2.2
 *      P3-02-auth-oauth2 §3.1
 */
import type { JWTPayload } from 'jose';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type Redis from 'ioredis';
import type { Middleware } from '@dangao/bun-server';
import {
  CachedTokenStateSchema,
  OAuth2IntrospectResponseSchema,
  type CachedTokenState,
  type DualSubject,
  type OAuth2IntrospectResponse,
} from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { isAgenticError } from '../../infra/errors/exception-mapper';
import { getAuthRedisClient } from './auth-redis';
import { DualSubjectService } from './dual-subject.service';
import { getSharedMockOboService, type MockOboService } from './mock-obo.service';

/** Extend Koa state to carry DualSubject */
declare module '@dangao/bun-server' {
  interface DefaultState {
    subject?: DualSubject;
  }
}

type ContextWithState = { state: Record<string, unknown> };

/** Paths that bypass AuthN (health, metrics, mock JWKS) */
const AUTH_BYPASS_PATHS = new Set([
  '/health/live',
  '/health/ready',
  '/metrics',
  '/.well-known/agentic-engine-mock-obo/jwks.json',
]);

function resolveIntrospectionUrl(): string {
  const u = process.env['AGENTIC_ENGINE_OAUTH2_INTROSPECTION_URL'];
  if (u && !u.includes('${')) return u.replace(/\/?$/, '');
  const base = (
    process.env['AGENTIC_ENGINE_OAUTH2_BASE_URL'] ?? 'https://ouaa.kaihe.local'
  ).replace(/\/$/, '');
  return `${base}/oauth2/introspect`;
}

function resolveJwksUri(): string {
  const u = process.env['AGENTIC_ENGINE_OAUTH2_JWKS_URI'];
  if (u && !u.includes('${')) return u.replace(/\/?$/, '');
  const base = (
    process.env['AGENTIC_ENGINE_OAUTH2_BASE_URL'] ?? 'https://ouaa.kaihe.local'
  ).replace(/\/$/, '');
  return `${base}/oauth2/jwks`;
}

function resolveExpectedIssuer(): string | undefined {
  return process.env['AGENTIC_ENGINE_OAUTH2_EXPECTED_ISSUER'];
}

let memoJwksUrl: string | null = null;
let memoJwksSet: ReturnType<typeof createRemoteJWKSet> | null = null;

function getRemoteJwksSet(): ReturnType<typeof createRemoteJWKSet> {
  const url = resolveJwksUri();
  if (memoJwksUrl === url && memoJwksSet) return memoJwksSet;
  memoJwksUrl = url;
  memoJwksSet = createRemoteJWKSet(new URL(url));
  return memoJwksSet;
}

export interface OAuth2IntrospectionMiddlewareDeps {
  mockOboService: MockOboService;
  dualSubjectService: DualSubjectService;
  fetchImpl: typeof fetch;
  /** Lazy Redis; may be null when AGENTIC_ENGINE_REDIS_URL unset — cache layer skipped. */
  getRedis: () => Redis | null;
  /**
   * Local JWT verify (JWKS). Replace in unit tests with a stub (no network).
   * Production: uses `jose` + `AGENTIC_ENGINE_OAUTH2_JWKS_URI` (in-memory + remote TTL per jose).
   */
  jwtVerifyStep: (rawToken: string) => Promise<JWTPayload>;
}

let sharedDual: DualSubjectService | undefined;
function getSharedDualSubjectService(): DualSubjectService {
  if (!sharedDual) sharedDual = new DualSubjectService();
  return sharedDual;
}

function buildDefaultJwtVerify(): (rawToken: string) => Promise<JWTPayload> {
  return async (rawToken: string) => {
    const JWKS = getRemoteJwksSet();
    const iss = resolveExpectedIssuer();
    const { payload } = await jwtVerify(rawToken, JWKS, {
      issuer: iss ?? undefined,
      clockTolerance: 30,
    });
    return payload;
  };
}

export function createDefaultOAuth2MwDeps(): OAuth2IntrospectionMiddlewareDeps {
  return {
    mockOboService: getSharedMockOboService(),
    dualSubjectService: getSharedDualSubjectService(),
    fetchImpl: globalThis.fetch.bind(globalThis),
    getRedis: getAuthRedisClient,
    jwtVerifyStep: buildDefaultJwtVerify(),
  };
}

function extractBearer(ctx: {
  headers: Record<string, string | undefined>;
}): string | null {
  const auth =
    ctx.headers['authorization'] ?? ctx.headers['Authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (token.length > 4096) {
    throw AgenticEngineError.fromCode(
      'UNAUTHENTICATED_TOKEN_INVALID',
      'Bearer token exceeds maximum allowed length (oversize_token)',
    );
  }
  return token || null;
}

function normalizeHeaders(ctx: unknown): Record<string, string | undefined> {
  const raw = (ctx as { headers?: unknown }).headers;
  const norm: Record<string, string | undefined> = {};

  if (!raw || typeof raw !== 'object') return norm;

  // Bun/Web `Headers`：Object.entries 为空，必须用 forEach / entries 迭代
  const maybe = raw as Headers;
  if (typeof maybe.forEach === 'function') {
    maybe.forEach((value, key) => {
      norm[String(key).toLowerCase()] = value;
    });
    return norm;
  }

  for (const [k, v] of Object.entries(raw as Record<string, string | undefined>)) {
    norm[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }
  return norm;
}

function traceFromCtx(ctx: unknown): string {
  const c = ctx as {
    getHeader?: (k: string) => string | null;
    headers?: Record<string, string | undefined>;
  };
  if (c.getHeader) {
    const t = c.getHeader('X-Trace-Id');
    if (t) return t;
  }
  const h = normalizeHeaders(ctx);
  return h['x-trace-id'] ?? `trace-${Date.now()}`;
}

function tenantClaimFromJwt(payload: JWTPayload): string | undefined {
  const raw =
    payload['tenant_id'] ??
    payload['tenantId'] ??
    payload['tenant'];
  if (raw === undefined || raw === null) return undefined;
  return String(raw);
}

function assertTenantHeaderMatchesClaim(
  xTenantId: string | undefined,
  tenantFromToken: string | undefined,
): void {
  if (!xTenantId || !tenantFromToken) return;
  if (xTenantId !== tenantFromToken) {
    throw AgenticEngineError.fromCode(
      'INVALID_ARGUMENT_TENANT_MISMATCH',
      `X-Tenant-Id ${xTenantId} does not match JWT tenant claim`,
    );
  }
}

async function postIntrospect(
  rawToken: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const url = resolveIntrospectionUrl();
  const clientId = process.env['AGENTIC_ENGINE_OAUTH2_CLIENT_ID'] ?? '';
  const clientSecret = process.env['AGENTIC_ENGINE_OAUTH2_CLIENT_SECRET'] ?? '';
  if (!clientId || !clientSecret) {
    throw AgenticEngineError.fromCode(
      'INTERNAL_SECRET_MISSING',
      'OAuth2 introspection requires AGENTIC_ENGINE_OAUTH2_CLIENT_ID and AGENTIC_ENGINE_OAUTH2_CLIENT_SECRET',
    );
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    token: rawToken,
    token_type_hint: 'access_token',
  }).toString();

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body,
    });
  } catch {
    throw AgenticEngineError.fromCode(
      'UPSTREAM_OAUTH_INTROSPECT_FAIL',
      'OAuth2 introspection request failed (network)',
    );
  }

  if (!res.ok) {
    throw AgenticEngineError.fromCode(
      'UPSTREAM_OAUTH_INTROSPECT_FAIL',
      `OAuth2 introspection HTTP ${res.status}`,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw AgenticEngineError.fromCode(
      'UPSTREAM_OAUTH_INTROSPECT_FAIL',
      'OAuth2 introspection returned non-JSON body',
    );
  }
  return json;
}

function cacheKey(shaHex: string): string {
  return `agentic:engine:auth:token:${shaHex}`;
}

async function writeTokenCache(
  redis: Redis,
  shaHex: string,
  intro: OAuth2IntrospectResponse,
  subject: DualSubject,
): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = intro.exp ?? nowSec + 60;
  const ttlSec = intro.active
    ? Math.max(1, Math.min(60, expSec - nowSec))
    : 30;

  const cached: CachedTokenState = {
    active: intro.active,
    userId: subject.user.userId,
    tenant: subject.user.tenant,
    scopes: [...subject.user.scopes],
    terminal: subject.terminal,
    exp: subject.user.expiresAt,
    cachedAt: Date.now(),
  };

  const parsed = CachedTokenStateSchema.parse(cached);
  await redis.set(
    cacheKey(shaHex),
    JSON.stringify(parsed),
    'EX',
    ttlSec,
  );
}

export function createOAuth2IntrospectionMiddleware(
  deps: OAuth2IntrospectionMiddlewareDeps,
): Middleware {
  return async (ctx, next) => {
    const path =
      (ctx as unknown as { path?: string }).path ??
      (ctx as unknown as { url?: string }).url?.split('?')[0] ??
      '';

    if (AUTH_BYPASS_PATHS.has(path)) {
      return next();
    }

    const ctxSt = ctx as unknown as ContextWithState;
    ctxSt.state ??= {};

    const authMode = process.env.AGENTIC_ENGINE_AUTH_MODE ?? 'mock';

    const normHeaders = normalizeHeaders(ctx);

    if (authMode === 'mock') {
      ctxSt.state.subject = deps.mockOboService.fakeSubject({
        headers: normHeaders,
      });
      return next();
    }

    const token = extractBearer({ headers: normHeaders });
    if (!token) {
      throw AgenticEngineError.fromCode(
        'UNAUTHENTICATED_TOKEN_INVALID',
        'Missing or malformed Bearer token (UNAUTHENTICATED_MALFORMED_BEARER)',
      );
    }

    let jwtPayload: JWTPayload;
    try {
      jwtPayload = await deps.jwtVerifyStep(token);
    } catch {
      throw AgenticEngineError.fromCode(
        'UNAUTHENTICATED_TOKEN_INVALID',
        'JWT signature verification failed or token invalid',
      );
    }

    const traceId = traceFromCtx(ctx);
    const headerInputs = {
      xTenantId: normHeaders['x-tenant-id'],
      xTerminal: normHeaders['x-terminal'],
      xTraceId: traceId,
    };

    const claimTenant = tenantClaimFromJwt(jwtPayload);
    assertTenantHeaderMatchesClaim(headerInputs.xTenantId, claimTenant);

    const shaHex = deps.dualSubjectService.sha256Hex(token);
    const redis = deps.getRedis();

    if (redis) {
      let cachedRaw: string | null = null;
      try {
        cachedRaw = await redis.get(cacheKey(shaHex));
      } catch {
        cachedRaw = null;
      }

      if (cachedRaw) {
        try {
          const snap = CachedTokenStateSchema.parse(JSON.parse(cachedRaw));
          if (snap.active) {
            ctxSt.state.subject = deps.dualSubjectService.fromCachedTokenState(
              snap,
              token,
              headerInputs,
            );
            return next();
          }
          throw AgenticEngineError.fromCode(
            'UNAUTHENTICATED_TOKEN_REVOKED',
            'Token revoked (negative cache)',
          );
        } catch (e) {
          if (isAgenticError(e)) throw e;
          /* malformed cache → introspect */
        }
      }
    }

    const introspectJson = await postIntrospect(token, deps.fetchImpl);
    const introParsed = OAuth2IntrospectResponseSchema.parse(introspectJson);

    if (!introParsed.active) {
      if (redis) {
        try {
          await redis.set(
            cacheKey(shaHex),
            JSON.stringify(
              CachedTokenStateSchema.parse({
                active: false,
                scopes: [],
                cachedAt: Date.now(),
              }),
            ),
            'EX',
            30,
          );
        } catch {
          /* ignore cache write failure */
        }
      }
      throw AgenticEngineError.fromCode(
        'UNAUTHENTICATED_TOKEN_REVOKED',
        'Token introspection returned active=false',
      );
    }

    const subject = deps.dualSubjectService.fromIntrospectResponse(
      introParsed,
      token,
      headerInputs,
    );

    ctxSt.state.subject = subject;

    if (redis) {
      try {
        await writeTokenCache(redis, shaHex, introParsed, subject);
      } catch {
        /* ignore */
      }
    }

    return next();
  };
}

export const oauth2IntrospectionMiddleware =
  createOAuth2IntrospectionMiddleware(createDefaultOAuth2MwDeps());

export const mockOboService = getSharedMockOboService();
export const dualSubjectService = getSharedDualSubjectService();
