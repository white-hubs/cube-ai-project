import type { Middleware } from '@dangao/bun-server';

/** Request-scoped trace id（错误中间件 / 日志共用） */
declare module '@dangao/bun-server' {
  interface DefaultState {
    traceId?: string;
  }
}

/**
 * TraceId Middleware — P1-02 API envelope。
 *
 * 读取或生成 W3C trace-id，写入响应头 `X-Trace-Id` 与 `ctx.state.traceId`。
 */
export const traceIdMiddleware: Middleware = async (ctx, next) => {
  const traceId = resolveTraceId(ctx);
  ctx.setHeader('X-Trace-Id', traceId);
  const c = ctx as unknown as { state?: { traceId?: string } };
  if (!c.state) c.state = {};
  c.state.traceId = traceId;
  return next();
};

/**
 * Determine the trace-id for this request.
 * Exported for unit testing.
 */
export function resolveTraceId(ctx: {
  getHeader: (key: string) => string | null;
}): string {
  const explicit = ctx.getHeader('X-Trace-Id');
  if (explicit) return explicit;

  const traceparent = ctx.getHeader('traceparent');
  if (traceparent) {
    const extracted = extractTraceIdFromTraceparent(traceparent);
    if (extracted) return extracted;
  }

  return generateTraceId();
}

/**
 * Extract trace-id from a W3C `traceparent` header.
 * Format: `{version}-{trace-id}-{parent-id}-{flags}` (W3C TraceContext §3.2).
 */
export function extractTraceIdFromTraceparent(
  traceparent: string,
): string | null {
  const parts = traceparent.split('-');
  if (parts.length < 4) return null;
  const traceId = parts[1];
  if (!traceId || !/^[0-9a-f]{32}$/.test(traceId)) return null;
  return traceId;
}

/**
 * Generate a 32-hex trace-id (W3C TraceContext compatible)。
 */
export function generateTraceId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
