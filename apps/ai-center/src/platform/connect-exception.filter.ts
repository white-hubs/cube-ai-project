import type { Context, ExceptionFilter } from "@dangao/bun-server";

import { formatConnectErrorMessage, isConnectError, mapConnectErrorToHttpStatus } from "@cube-ai/platform-adapter-ghcloud";

function traceFromCtx(ctx: Context): string {
  const st = (ctx as unknown as { state?: { traceId?: string } }).state;
  return st?.traceId ?? ctx.getHeader("X-Trace-Id") ?? crypto.randomUUID().replaceAll(/-/gu, "");
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
        code: "PLATFORM_RPC_ERROR",
        details: {
          connectCode: error.code,
          traceId,
        },
        error: message,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Trace-Id": traceId,
        },
        status,
      },
    );
  },
};
