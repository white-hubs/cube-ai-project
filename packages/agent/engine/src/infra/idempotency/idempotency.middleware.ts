/**
 * Idempotency-Key middleware (ARCH §5 G-10 / T13-G10).
 *
 * Semantics
 * =========
 *  - Active only on POST/PUT/PATCH (GET/HEAD/DELETE/OPTIONS are by definition
 *    or convention idempotent on the protocol layer).
 *  - Bypass paths: `/health/*`, `/metrics`, `/v1/health`, `/v1/ready` — these
 *    are infra surfaces and must not consult Redis.
 *  - Header is opt-in: requests WITHOUT `Idempotency-Key` pass through. This
 *    matches Stripe / GitHub semantics — the client signals intent.
 *  - Composed key dimension: `${subject.user.userId}|${method}|${path}|${idemKey}`.
 *    `subject.userId` is sourced from `ctx.state.subject.user.userId` (set by
 *    `oauth2IntrospectionMiddleware` upstream). Anonymous requests (no
 *    subject) fall back to `'anon'` — those should already be rejected by
 *    auth, but the fall-back keeps the middleware total.
 *
 * Body / response capture
 * =======================
 *  - Raw body is read via `ctx.request.clone().text()`. `Request.clone()` is
 *    safe (Web standard) and leaves the original body stream untouched, so
 *    downstream `ctx.getBody()` parsing in the controller still works.
 *  - The full `Response` returned by `next()` is cloned before its body is
 *    drained for the cache write. The original response is passed through
 *    so the framework / SSE keepalive logic can stream it normally.
 *  - Only 2xx responses are persisted. Errors are not cached — the error
 *    middleware will produce a fresh envelope on retry.
 *
 * Failure modes
 * =============
 *  - `bodyHash` mismatch (same key, different request body): throw
 *    `FAILED_PRECONDITION_IDEMPOTENCY_KEY_REUSED` → HTTP 412 via
 *    `categoryOf()` prefix matching.
 *  - Concurrent in-flight on the same key: throw
 *    `RESOURCE_CONFLICT_IDEMPOTENCY_INFLIGHT` → HTTP 409. We pick
 *    `RESOURCE_CONFLICT` rather than `RESOURCE_EXHAUSTED` because the closed
 *    error-category set in `ERROR_CATEGORIES` does not include the latter
 *    (ADR-0015) — concurrent same-key writes are semantically a conflict,
 *    and 409 is the canonical RFC mapping.
 *  - Redis unavailable: store / lock degrade to no-ops — first-write-wins
 *    semantics still hold within a single replica because Node-local locks
 *    are acquired in JS (single-threaded event loop), but cross-replica
 *    coordination is lost. Documented as a follow-up under T09.
 *
 * ref: ARCH.md §5 G-10
 *      docs/detailed-design/00-foundations/naming-and-db-conventions.md §6.4
 *      docs/adr/ADR-0019-middleware-chain-order.md
 */
import { createHash } from 'node:crypto';
import type { Middleware } from '@dangao/bun-server';
import { AgenticEngineError } from '../errors/agentic-error';
import type { IdempotencyEntry, IdempotencyStore } from './idempotency.types';

const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH']);
const HEADER_IDEMPOTENCY_KEY = 'Idempotency-Key';
const HEADER_REPLAYED = 'X-Idempotent-Replayed';

const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24h
const DEFAULT_LOCK_TTL_SECONDS = 30;

const BYPASS_PATHS: ReadonlySet<string> = new Set([
  '/health/live',
  '/health/ready',
  '/v1/health',
  '/v1/ready',
  '/metrics',
  '/v1/metrics',
]);

const PRESERVED_HEADER_NAMES = ['content-type'] as const;

export interface IdempotencyMiddlewareOptions {
  store: IdempotencyStore;
  /** Override the entry TTL (seconds). Defaults to 24 hours. */
  ttlSeconds?: number;
  /** Override the in-flight lock TTL (seconds). Defaults to 30 seconds. */
  lockTtlSeconds?: number;
}

interface CtxShape {
  request: Request;
  method: string;
  path: string;
  getHeader: (key: string) => string | null;
  setHeader: (key: string, value: string) => void;
  state?: { subject?: { user?: { userId?: string } } };
}

export function createIdempotencyMiddleware(
  opts: IdempotencyMiddlewareOptions,
): Middleware {
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const lockTtl = opts.lockTtlSeconds ?? DEFAULT_LOCK_TTL_SECONDS;

  return async (rawCtx, next) => {
    const ctx = rawCtx as unknown as CtxShape;

    const method = (ctx.method ?? '').toUpperCase();
    if (!IDEMPOTENT_METHODS.has(method)) return next();

    const path = ctx.path ?? '';
    if (BYPASS_PATHS.has(path)) return next();

    const idemKey = ctx.getHeader(HEADER_IDEMPOTENCY_KEY);
    if (!idemKey) return next();

    // Read raw body via Request.clone() — does not consume the original stream.
    const rawBody = await readRawBody(ctx.request);
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');

    const subjectUserId = ctx.state?.subject?.user?.userId ?? 'anon';
    const composedKey = `${subjectUserId}|${method}|${path}|${idemKey}`;

    // 1) Cache hit → replay
    const cached = await opts.store.get(composedKey);
    if (cached) {
      if (cached.bodyHash !== bodyHash) {
        throw AgenticEngineError.fromCode(
          'FAILED_PRECONDITION_IDEMPOTENCY_KEY_REUSED',
          `Idempotency-Key '${idemKey}' already used with a different request body`,
          { key: idemKey, path, method },
        );
      }
      return buildReplayResponse(cached);
    }

    // 2) Acquire lock to guard concurrent writes on same key
    const acquired = await opts.store.acquireLock(composedKey, lockTtl);
    if (!acquired) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_CONFLICT_IDEMPOTENCY_INFLIGHT',
        `Idempotency-Key '${idemKey}' is currently in flight`,
        { key: idemKey, path, method },
      );
    }

    try {
      const response = await next();

      // Only persist successful (2xx) responses — errors should re-evaluate
      // on retry.
      if (response.status >= 200 && response.status < 300) {
        const captured = await captureResponse(response, bodyHash);
        await opts.store.set(composedKey, captured, ttl);
      }

      return response;
    } finally {
      await opts.store.releaseLock(composedKey);
    }
  };
}

async function readRawBody(req: Request): Promise<string> {
  // Web Request.clone() is safe and copies the body for independent reading.
  // GET-style or empty bodies → ''.
  try {
    return await req.clone().text();
  } catch {
    return '';
  }
}

async function captureResponse(
  response: Response,
  bodyHash: string,
): Promise<IdempotencyEntry> {
  const clone = response.clone();
  const bodyText = await clone.text();
  const preservedHeaders: Record<string, string> = {};
  for (const name of PRESERVED_HEADER_NAMES) {
    const v = response.headers.get(name);
    if (v) preservedHeaders[name] = v;
  }
  return {
    status: response.status,
    bodyJson: bodyText,
    headersJson: JSON.stringify(preservedHeaders),
    createdAt: Date.now(),
    bodyHash,
  };
}

function buildReplayResponse(entry: IdempotencyEntry): Response {
  const headers = new Headers();
  let preserved: Record<string, string> = {};
  try {
    preserved = JSON.parse(entry.headersJson) as Record<string, string>;
  } catch {
    preserved = {};
  }
  for (const [k, v] of Object.entries(preserved)) {
    headers.set(k, v);
  }
  if (!headers.has('content-type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set(HEADER_REPLAYED, '1');
  return new Response(entry.bodyJson, { status: entry.status, headers });
}
