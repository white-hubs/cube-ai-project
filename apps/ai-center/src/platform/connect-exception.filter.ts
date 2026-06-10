import type { Context, ExceptionFilter } from '@dangao/bun-server';
import {
  formatConnectErrorMessage,
  isConnectError,
  mapConnectErrorToHttpStatus,
} from '@cube-ai/platform-adapter-ghcloud';

function traceFromCtx(ctx: Context): string {
  const st = (ctx as unknown as { state?: { traceId?: string } }).state;
  return st?.traceId ?? ctx.getHeader('X-Trace-Id') ?? crypto.randomUUID().replace(/-/g, '');
}

/** Maps Connect/gRPC downstream failures to explicit HTTP responses (avoid opaque 500). */
export const connectExceptionFilter: ExceptionFilter = {
  catch(error: unknown, context: Context): Response | undefined {
    if (!isConnectError(error)) {
      return undefined;
    }

    const status = mapConnectErrorToHttpStatus(error.code);
    const message = formatConnectErrorMessage(error);
    const traceId = traceFromCtx(context);

    context.setStatus(status);
    return context.createErrorResponse(
      {
        error: message,
        code: 'PLATFORM_RPC_ERROR',
        details: {
          connectCode: error.code,
          traceId,
        },
      },
      {
        status,
        headers: {
          'Content-Type': 'application/json',
          'X-Trace-Id': traceId,
        },
      },
    );
  },
};
