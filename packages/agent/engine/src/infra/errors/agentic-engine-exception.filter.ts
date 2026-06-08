import type { Context, ExceptionFilter } from '@dangao/bun-server';
import { AgenticEngineError } from './agentic-error';

function traceFromCtx(ctx: Context): string {
  const st = (ctx as unknown as { state?: { traceId?: string } }).state;
  return (
    st?.traceId ??
    ctx.getHeader('X-Trace-Id') ??
    crypto.randomUUID().replace(/-/g, '')
  );
}

/**
 * 控制器路由内抛出的异常由 bun-server `handleError` 捕获；`AgenticEngineError`
 * 需在此映射为规范 envelope + 正确 HTTP 状态码（否则会落入 500）。
 */
export const agenticEngineExceptionFilter: ExceptionFilter = {
  catch(error: unknown, context: Context): Response | undefined {
    if (!(error instanceof AgenticEngineError)) return undefined;

    const traceId = traceFromCtx(context);
    const envelope = error.toResponse(traceId);

    context.setStatus(error.httpStatus);
    return context.createResponse(envelope, {
      status: error.httpStatus,
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
      },
    });
  },
};
