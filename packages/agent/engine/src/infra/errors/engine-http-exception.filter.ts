import type { Context, ExceptionFilter } from '@dangao/bun-server';
import type { Logger } from 'pino';

import { mapToAgenticError } from './exception-mapper';

function traceFromCtx(ctx: Context): string {
  const st = (ctx as unknown as { state?: { traceId?: string } }).state;
  return (
    st?.traceId ??
    ctx.getHeader('X-Trace-Id') ??
    crypto.randomUUID().replace(/-/g, '')
  );
}

function logRequestError(
  log: Logger | undefined,
  err: unknown,
  traceId: string,
  ctx: Context,
): void {
  if (!log) return;
  const agenticErr = mapToAgenticError(err);
  if (err instanceof Error) {
    log.error(
      {
        err: { name: err.name, message: err.message, stack: err.stack },
        traceId,
        httpStatus: agenticErr.httpStatus,
        code: agenticErr.code,
        method: ctx.method,
        path: ctx.path,
      },
      'request failed',
    );
    return;
  }
  log.error(
    { thrown: String(err), traceId, method: ctx.method, path: ctx.path },
    'request failed (non-Error)',
  );
}

/**
 * Fallback controller exception filter: engine 5-field envelope + pino error log.
 * Register after AgenticEngineError / ConnectError filters.
 */
export function createEngineHttpExceptionFilter(log?: Logger): ExceptionFilter {
  return {
    catch(error: unknown, context: Context): Response | undefined {
      const agenticErr = mapToAgenticError(error);
      const traceId = traceFromCtx(context);
      logRequestError(log, error, traceId, context);

      const envelope = agenticErr.toResponse(traceId);
      context.setStatus(agenticErr.httpStatus);
      return context.createResponse(envelope, {
        status: agenticErr.httpStatus,
        headers: {
          'Content-Type': 'application/json',
          'X-Trace-Id': traceId,
        },
      });
    },
  };
}
