import type { Middleware } from '@dangao/bun-server';
import type { ErrorResponse } from '@cube-ai/contracts';
import { buildErrorDetails } from '@cube-ai/contracts';
import type { Logger } from 'pino';

import { MetricsCatalog } from '../observability/metrics-catalog';
import type { MetricsRegistry } from '../observability/metrics-registry';
import { mapToAgenticError } from './exception-mapper';

type TraceCtx = {
  responseHeaders: Headers;
  createErrorResponse: (
    envelope: ErrorResponse,
    opts: { status: number; headers: Record<string, string> },
  ) => Response;
  state?: { traceId?: string };
};

/**
 * 工厂：绑定 `MetricsRegistry` + 可选 pino logger（原始异常栈仅写日志）。
 */
export function createErrorResponseMiddleware(
  registry: MetricsRegistry,
  log?: Logger,
): Middleware {
  const errorCounter = registry.registerCounter(
    MetricsCatalog.ERROR_TOTAL,
    'Total classified engine errors',
    ['error_code'],
  );

  return async function errorResponseMiddleware(ctx: TraceCtx, next) {
    try {
      return await next();
    } catch (err) {
      const traceId =
        ctx.state?.traceId ??
        ctx.responseHeaders.get('X-Trace-Id') ??
        generateFallbackTraceId();
      const agenticErr = mapToAgenticError(err);

      errorCounter.inc({
        error_code: agenticErr.code ?? 'INTERNAL_UNKNOWN',
      });

      if (log) {
        if (err instanceof Error) {
          log.error(
            {
              err: { name: err.name, message: err.message, stack: err.stack },
              traceId,
              httpStatus: agenticErr.status,
              code: agenticErr.code,
            },
            'request failed',
          );
        } else {
          log.error({ thrown: String(err), traceId }, 'request failed (non-Error)');
        }
      }

      const envelope: ErrorResponse = {
        status: agenticErr.status,
        code: agenticErr.code,
        message: agenticErr.message,
        details: buildErrorDetails(traceId, agenticErr.details),
        timestamp: Date.now(),
      };

      return ctx.createErrorResponse(envelope, {
        status: agenticErr.status,
        headers: {
          'X-Trace-Id': traceId,
          'Content-Type': 'application/json',
        },
      });
    }
  };
}

function generateFallbackTraceId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
