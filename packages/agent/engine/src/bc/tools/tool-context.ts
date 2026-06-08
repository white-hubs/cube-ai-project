import type { AdapterCallContext } from '@tachu/core';
import type { RuntimeRefs } from '@cube-ai/contracts';

/**
 * ToolHandlerCtx — handler 执行上下文。
 *
 * 权威来源：docs/detailed-design/07-tools/builtin-catalog.md §9.1 HandlerCtx
 */
export interface ToolHandlerCtx {
  traceId: string;
  signal:  AbortSignal;
  auth: {
    tenant:   number;
    user?:    { userId: string; displayName?: string; scopes: string[] };
    service?: { clientId: string };
  };
  session: {
    id:      string;
    turnId:  string;
  };
  turn?: {
    runtimeRefs?: RuntimeRefs;
  };
}

/** 映射为 `@tachu/core` Port 所需的 AdapterCallContext（Provider / Vector / Memory）。 */
export function toAdapterCallContext(handlerCtx: ToolHandlerCtx): AdapterCallContext {
  return {
    correlation: {
      traceId:   handlerCtx.traceId,
      requestId: handlerCtx.traceId,
      sessionId: handlerCtx.session.id,
      turnId:    handlerCtx.session.turnId,
    },
    subject: {
      tenant: String(handlerCtx.auth.tenant),
      ...(handlerCtx.auth.user?.userId ? { userId: handlerCtx.auth.user.userId } : {}),
    },
    tenant: handlerCtx.auth.tenant,
  };
}
