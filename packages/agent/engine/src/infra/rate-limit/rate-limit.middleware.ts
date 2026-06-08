/**
 * Tenant-scoped rate limit middleware (ARCH §5 G-8 / T13-G8).
 *
 * Semantics
 * =========
 *  - Bucket is keyed by `${tenant}|${path}` so a noisy tenant on one route
 *    cannot starve quotas on another route or other tenants.
 *  - Tenant id is read from `ctx.state.subject.tenant` (root convenience copy
 *    populated by `oauth2IntrospectionMiddleware` upstream) with fallback to
 *    `ctx.state.subject.user.tenant`.
 *  - When no tenant is present (anonymous / health bypass / paths skipped by
 *    auth) the middleware passes through. Auth + tenant propagation upstream
 *    are the canonical gates; rate-limit is a defence-in-depth derivative.
 *  - Bypass paths: `/health/*`, `/metrics`, `/v1/health`, `/v1/ready` —
 *    same set as auth and idempotency for protocol-layer consistency.
 *
 * Headers
 * =======
 *  - Always emits `X-RateLimit-Remaining` + `X-RateLimit-Reset` so clients
 *    can self-throttle.
 *  - On reject, throws `RATELIMIT_TENANT_REQUEST_EXCEEDED` (HTTP 429 via
 *    `categoryOf()` prefix matching). Note: we use the `RATELIMIT_*`
 *    prefix rather than the spec-suggested `RESOURCE_EXHAUSTED_*` — the
 *    closed error-category set in `ERROR_CATEGORIES` (ADR-0015) does not
 *    include `RESOURCE_EXHAUSTED`, and `RATELIMIT_*` already carries the
 *    correct 429 mapping plus aligns with the existing
 *    `RATELIMIT_TENANT_EXCEEDED` skeleton code.
 *
 * Chain placement (ADR-0019 derivative)
 * =====================================
 *   tenantContext (T10) → rateLimit (T13-G8) → errorResponse
 * After tenant context so the bucket key dimension is reliably available;
 * before errorResponse so a thrown 429 is enveloped by the canonical
 * P1-02 mapper.
 *
 * ref: ARCH.md §5 G-8
 *      docs/adr/ADR-0019-middleware-chain-order.md
 */
import type { Middleware } from '@dangao/bun-server';
import { AgenticEngineError } from '../errors/agentic-error';
import type { RateLimitConfig, RateLimiter } from './rate-limit.types';

const BYPASS_PATHS: ReadonlySet<string> = new Set([
  '/health/live',
  '/health/ready',
  '/v1/health',
  '/v1/ready',
  '/metrics',
  '/v1/metrics',
]);

const HEADER_REMAINING = 'X-RateLimit-Remaining';
const HEADER_RESET = 'X-RateLimit-Reset';

export interface RateLimitMiddlewareOptions {
  limiter: RateLimiter;
  /** Default per-(tenant, path) bucket config. */
  config: RateLimitConfig;
}

interface CtxShape {
  path: string;
  setHeader: (key: string, value: string) => void;
  state?: {
    subject?: {
      tenant?: number;
      user?: { tenant?: number };
    };
  };
}

export function createRateLimitMiddleware(
  opts: RateLimitMiddlewareOptions,
): Middleware {
  return async (rawCtx, next) => {
    const ctx = rawCtx as unknown as CtxShape;
    const path = ctx.path ?? '';
    if (BYPASS_PATHS.has(path)) return next();

    const tenant =
      ctx.state?.subject?.tenant ?? ctx.state?.subject?.user?.tenant;
    if (typeof tenant !== 'number') {
      // Unauthenticated paths (already filtered by oauth2). Without a tenant
      // we have no key dimension — pass through.
      return next();
    }

    const key = `${tenant}|${path}`;
    const decision = await opts.limiter.check(key, opts.config);

    ctx.setHeader(HEADER_REMAINING, String(Math.max(0, decision.remaining)));
    ctx.setHeader(HEADER_RESET, String(Math.max(0, decision.resetSeconds)));

    if (!decision.allowed) {
      throw AgenticEngineError.fromCode(
        'RATELIMIT_TENANT_REQUEST_EXCEEDED',
        `Rate limit exceeded for tenant ${tenant} on ${path}`,
        {
          tenant,
          path,
          resetSeconds: decision.resetSeconds,
        },
      );
    }
    return next();
  };
}
