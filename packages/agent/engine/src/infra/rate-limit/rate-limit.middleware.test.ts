/**
 * Unit tests for `rateLimitMiddleware` (T13-G8).
 *
 * The limiter port is faked so tests don't need Redis. Coverage:
 *   1. Bypass path (/health/live) → pass-through (no limiter call)
 *   2. No tenant → pass-through (anonymous / pre-auth)
 *   3. Allow → next() called + rate-limit headers set
 *   4. Deny → throws RATELIMIT_TENANT_REQUEST_EXCEEDED (HTTP 429)
 *   5. Bucket key composition uses `tenant|path`
 *   6. Falls back to `subject.user.tenant` when root convenience copy is missing
 */
import { describe, expect, it, mock } from 'bun:test';
import type { Context, NextFunction } from '@dangao/bun-server';
import { AgenticEngineError } from '../errors/agentic-error';
import { createRateLimitMiddleware } from './rate-limit.middleware';
import type {
  RateLimitConfig,
  RateLimitDecision,
  RateLimiter,
} from './rate-limit.types';

class FakeLimiter implements RateLimiter {
  readonly calls: Array<{ key: string; cfg: RateLimitConfig }> = [];
  constructor(private readonly decision: RateLimitDecision) {}
  async check(key: string, cfg: RateLimitConfig): Promise<RateLimitDecision> {
    this.calls.push({ key, cfg });
    return this.decision;
  }
}

interface FakeCtx {
  path: string;
  resHeaders: Map<string, string>;
  state: { subject?: { tenant?: number; user?: { tenant?: number } } };
  setHeader(key: string, value: string): void;
}

interface MakeCtxOpts {
  path?: string;
  tenantRoot?: number | undefined;
  tenantUser?: number | undefined;
}

function makeCtx(opts: MakeCtxOpts = {}): FakeCtx {
  return {
    path: opts.path ?? '/sessions',
    resHeaders: new Map<string, string>(),
    state: {
      subject: {
        tenant: opts.tenantRoot,
        user: { tenant: opts.tenantUser },
      },
    },
    setHeader(key: string, value: string): void {
      this.resHeaders.set(key, value);
    },
  };
}

const okNext: NextFunction = () =>
  Promise.resolve(new Response(null, { status: 200 }));

const cfg: RateLimitConfig = { capacity: 100, refillRate: 10 };

describe('rateLimitMiddleware', () => {
  it('passes through bypass paths without consulting the limiter', async () => {
    const limiter = new FakeLimiter({
      allowed: false,
      remaining: 0,
      resetSeconds: 9,
    });
    const mw = createRateLimitMiddleware({ limiter, config: cfg });
    for (const path of ['/health/live', '/health/ready', '/metrics']) {
      const ctx = makeCtx({ path, tenantRoot: 7 });
      const next = mock(okNext);
      await mw(ctx as unknown as Context, next);
      expect(next).toHaveBeenCalledTimes(1);
    }
    expect(limiter.calls.length).toBe(0);
  });

  it('passes through when no tenant is present (unauthenticated)', async () => {
    const limiter = new FakeLimiter({
      allowed: false,
      remaining: 0,
      resetSeconds: 9,
    });
    const mw = createRateLimitMiddleware({ limiter, config: cfg });
    const ctx = makeCtx();
    const next = mock(okNext);
    await mw(ctx as unknown as Context, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(limiter.calls.length).toBe(0);
    expect(ctx.resHeaders.has('X-RateLimit-Remaining')).toBe(false);
  });

  it('allows + sets headers when limiter returns allowed=true', async () => {
    const limiter = new FakeLimiter({
      allowed: true,
      remaining: 99,
      resetSeconds: 1,
    });
    const mw = createRateLimitMiddleware({ limiter, config: cfg });
    const ctx = makeCtx({ tenantRoot: 7, path: '/sessions' });
    const next = mock(okNext);

    await mw(ctx as unknown as Context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(limiter.calls).toEqual([{ key: '7|/sessions', cfg }]);
    expect(ctx.resHeaders.get('X-RateLimit-Remaining')).toBe('99');
    expect(ctx.resHeaders.get('X-RateLimit-Reset')).toBe('1');
  });

  it('throws RATELIMIT_TENANT_REQUEST_EXCEEDED (429) on deny', async () => {
    const limiter = new FakeLimiter({
      allowed: false,
      remaining: 0,
      resetSeconds: 9,
    });
    const mw = createRateLimitMiddleware({ limiter, config: cfg });
    const ctx = makeCtx({ tenantRoot: 7 });
    const next = mock(okNext);

    let thrown: unknown;
    try {
      await mw(ctx as unknown as Context, next);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AgenticEngineError);
    expect((thrown as AgenticEngineError).code).toBe(
      'RATELIMIT_TENANT_REQUEST_EXCEEDED',
    );
    expect((thrown as AgenticEngineError).httpStatus).toBe(429);
    // Headers are still set even on deny (clients can read 429 + reset)
    expect(ctx.resHeaders.get('X-RateLimit-Remaining')).toBe('0');
    expect(ctx.resHeaders.get('X-RateLimit-Reset')).toBe('9');
    expect(next).not.toHaveBeenCalled();
  });

  it('falls back to subject.user.tenant when root convenience copy is missing', async () => {
    const limiter = new FakeLimiter({
      allowed: true,
      remaining: 50,
      resetSeconds: 5,
    });
    const mw = createRateLimitMiddleware({ limiter, config: cfg });
    const ctx = makeCtx({ tenantUser: 11, path: '/messages' });
    const next = mock(okNext);

    await mw(ctx as unknown as Context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(limiter.calls).toEqual([{ key: '11|/messages', cfg }]);
  });

  it('caps negative remaining/reset to 0 when emitting headers', async () => {
    const limiter = new FakeLimiter({
      allowed: false,
      remaining: -3,
      resetSeconds: -2,
    });
    const mw = createRateLimitMiddleware({ limiter, config: cfg });
    const ctx = makeCtx({ tenantRoot: 7 });

    let thrown: unknown;
    try {
      await mw(ctx as unknown as Context, () => Promise.resolve(new Response()));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AgenticEngineError);
    expect(ctx.resHeaders.get('X-RateLimit-Remaining')).toBe('0');
    expect(ctx.resHeaders.get('X-RateLimit-Reset')).toBe('0');
  });
});
