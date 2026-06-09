/**
 * Unit tests for `versionNegotiationMiddleware` (T11).
 *
 * Verifies:
 * - compatible client → next() called + response headers populated
 * - incompatible client → throws AgenticEngineError(FAILED_PRECONDITION_*)
 * - missing header (loose accept) → next() called
 * - bypass paths (health, metrics) → next() called without consulting version
 *
 * The middleware contract uses `ctx.getHeader` / `ctx.setHeader` (the
 * canonical Context API in `@dangao/bun-server@3.x`); the fake Context here
 * mirrors that minimal surface.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { Context, NextFunction } from '@dangao/bun-server';
import {
  HEADER_SDK_VERSION,
  HEADER_ENGINE_VERSION,
  HEADER_SDK_MIN_SUPPORTED,
  HEADER_SDK_DEPRECATED,
} from '@cube-ai/contracts';
import { AgenticEngineError } from '../errors/agentic-error';
import { createVersionNegotiationMiddleware } from './version-negotiation.middleware';

interface FakeCtx {
  path: string;
  reqHeaders: Map<string, string>;
  resHeaders: Map<string, string>;
  getHeader(key: string): string | null;
  setHeader(key: string, value: string): void;
}

function makeCtx(opts: {
  path?: string;
  headers?: Record<string, string>;
} = {}): FakeCtx {
  const reqHeaders = new Map<string, string>();
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    reqHeaders.set(k, v);
    reqHeaders.set(k.toLowerCase(), v);
  }
  const resHeaders = new Map<string, string>();
  return {
    path: opts.path ?? '/sessions',
    reqHeaders,
    resHeaders,
    getHeader(key: string): string | null {
      return reqHeaders.get(key) ?? reqHeaders.get(key.toLowerCase()) ?? null;
    },
    setHeader(key: string, value: string): void {
      resHeaders.set(key, value);
    },
  };
}

const okNext: NextFunction = () => Promise.resolve(new Response(null, { status: 200 }));

describe('versionNegotiationMiddleware', () => {
  it('passes through with no SDK version header (loose accept) and echoes engine version', async () => {
    const mw = createVersionNegotiationMiddleware();
    const ctx = makeCtx({ headers: {} });
    const next = mock(okNext);

    await mw(ctx as unknown as Context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.resHeaders.get(HEADER_ENGINE_VERSION)).toBe('1.0');
    expect(ctx.resHeaders.get(HEADER_SDK_MIN_SUPPORTED)).toBe('1.0');
    expect(ctx.resHeaders.has(HEADER_SDK_DEPRECATED)).toBe(false);
  });

  it('passes through when client SDK version is exactly the engine version', async () => {
    const mw = createVersionNegotiationMiddleware();
    const ctx = makeCtx({ headers: { [HEADER_SDK_VERSION]: '1.0' } });
    const next = mock(okNext);

    await mw(ctx as unknown as Context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.resHeaders.get(HEADER_ENGINE_VERSION)).toBe('1.0');
  });

  it('passes through at the upper edge of the compat window (1.99)', async () => {
    const mw = createVersionNegotiationMiddleware();
    const ctx = makeCtx({ headers: { [HEADER_SDK_VERSION]: '1.99' } });
    const next = mock(okNext);

    await mw(ctx as unknown as Context, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reads the header case-insensitively (lowercase request)', async () => {
    const mw = createVersionNegotiationMiddleware();
    const ctx = makeCtx({ headers: { 'x-agentic-sdk-version': '1.5' } });
    const next = mock(okNext);

    await mw(ctx as unknown as Context, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws AgenticEngineError when client SDK version is out of range', async () => {
    const mw = createVersionNegotiationMiddleware();
    const ctx = makeCtx({ headers: { [HEADER_SDK_VERSION]: '2.0' } });
    const next = mock(okNext);

    let thrown: unknown;
    try {
      await mw(ctx as unknown as Context, next);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(AgenticEngineError);
    expect((thrown as AgenticEngineError).code).toBe(
      'FAILED_PRECONDITION_VERSION_INCOMPATIBLE',
    );
    expect((thrown as AgenticEngineError).httpStatus).toBe(412);
    expect(next).not.toHaveBeenCalled();
  });

  it('throws on malformed version string (not {major}.{minor})', async () => {
    const mw = createVersionNegotiationMiddleware();
    const ctx = makeCtx({ headers: { [HEADER_SDK_VERSION]: 'xxx' } });
    const next = mock(okNext);

    let thrown: unknown;
    try {
      await mw(ctx as unknown as Context, next);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(AgenticEngineError);
    expect(next).not.toHaveBeenCalled();
  });

  it('bypasses health/metrics paths without consulting version', async () => {
    const mw = createVersionNegotiationMiddleware();
    for (const path of ['/health/live', '/health/ready', '/metrics']) {
      const ctx = makeCtx({ path, headers: { [HEADER_SDK_VERSION]: '99.99' } });
      const next = mock(okNext);
      await mw(ctx as unknown as Context, next);
      expect(next).toHaveBeenCalledTimes(1);
      // bypass branch must not write engine-version header either
      expect(ctx.resHeaders.has(HEADER_ENGINE_VERSION)).toBe(false);
    }
  });

  it('does not set deprecated header when DEPRECATED_BELOW is null (current 1.0)', async () => {
    const mw = createVersionNegotiationMiddleware();
    const ctx = makeCtx({ headers: { [HEADER_SDK_VERSION]: '1.0' } });
    const next = mock(okNext);

    await mw(ctx as unknown as Context, next);

    expect(ctx.resHeaders.has(HEADER_SDK_DEPRECATED)).toBe(false);
  });
});
