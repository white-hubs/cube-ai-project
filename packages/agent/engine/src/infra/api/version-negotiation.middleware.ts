/**
 * SDK ↔ engine version negotiation middleware (T11).
 *
 * - Reads the client's `X-Agentic-SDK-Version` request header.
 * - Calls `negotiateVersion()` (contracts) against the N=1 compatibility
 *   matrix and either short-circuits with a 412 envelope or echoes the
 *   engine version (and a deprecation flag, when applicable) on the response.
 *
 * Chain placement (ADR-0019 + T11):
 *   traceId → versionNegotiation → http-metrics → oauth2 → tenantCtx → errorResponse
 *
 * The middleware sits *after* `traceIdMiddleware` so an X-Trace-Id is already
 * resolved (the error envelope produced by `errorResponseMiddleware` requires
 * one), and *before* `http-metrics` so that incompatible clients don't
 * inflate request counters / histograms.
 *
 * Health / metrics paths bypass negotiation entirely: K8s liveness/readiness
 * and Prometheus scrapes do not — and must not — speak the SDK protocol; we
 * keep their failure domain isolated from versioning logic.
 *
 * ref: docs/technical-design/phase-4/T11-version-compat-matrix.md §4
 *      docs/adr/ADR-0019-middleware-chain-order.md
 */
import type { Context, Middleware, NextFunction } from '@dangao/bun-server';
import {
  negotiateVersion,
  HEADER_SDK_VERSION,
  HEADER_ENGINE_VERSION,
  HEADER_SDK_DEPRECATED,
  HEADER_SDK_MIN_SUPPORTED,
} from '@cube-ai/contracts';
import { AgenticEngineError } from '../errors/agentic-error';

/**
 * Paths that bypass version negotiation. Mirrors the bypass list of
 * `oauth2IntrospectionMiddleware` so health probes and Prometheus scrapes
 * traverse the same minimal envelope of middleware regardless of order.
 */
const VERSION_BYPASS_PATHS: ReadonlySet<string> = new Set([
  '/health/live',
  '/health/ready',
  '/metrics',
]);

function resolvePath(ctx: Context): string {
  const c = ctx as unknown as { path?: string; url?: string | URL };
  if (typeof c.path === 'string' && c.path.length > 0) return c.path;
  const u = c.url;
  if (u instanceof URL) return u.pathname;
  if (typeof u === 'string') return u.split('?')[0] ?? '';
  return '';
}

export function createVersionNegotiationMiddleware(): Middleware {
  return async (ctx: Context, next: NextFunction) => {
    if (VERSION_BYPASS_PATHS.has(resolvePath(ctx))) {
      return next();
    }

    const sdkV = ctx.getHeader(HEADER_SDK_VERSION);
    const result = negotiateVersion(sdkV);

    if (!result.compatible) {
      throw AgenticEngineError.fromCode(
        'FAILED_PRECONDITION_VERSION_INCOMPATIBLE',
        `SDK version ${sdkV ?? 'unknown'} is not supported (min ${result.minimumSupportedVersion}, engine ${result.engineVersion})`,
        {
          sdkVersion: sdkV,
          engineVersion: result.engineVersion,
          minimumSupportedVersion: result.minimumSupportedVersion,
        },
      );
    }

    ctx.setHeader(HEADER_ENGINE_VERSION, result.engineVersion);
    ctx.setHeader(HEADER_SDK_MIN_SUPPORTED, result.minimumSupportedVersion);
    if (result.deprecated) {
      ctx.setHeader(HEADER_SDK_DEPRECATED, '1');
    }

    return next();
  };
}
