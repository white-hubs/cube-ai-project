import type { AdapterCallContext } from "@tachu/core";

import type { RuntimeRefs } from "@cube-ai/contracts";

import type { AskBusinessDataStepGate } from "./biz-ontology-address";

/**
 * CallIdentity — 出站 MCP 身份透传的窄 carrier：调用方用户的原始入站身份三元组。
 *
 * 仅供 **MCP 出站身份透传**（`authPassthrough: 'user'` 的 server）消费；由 turn 起点
 * 即时捕获（请求上下文尚存），经 `turnContext` 携带至 tool-loop，**不进**
 * `ExecutionContext.principal`（redaction 护栏防落日志/审计/job 快照）。
 * 权威：CONTEXT.md「MCP 出站身份透传 (MCP outbound auth passthrough)」。
 */
export interface CallIdentity {
  /** 原始入站 `Authorization` header（含 `Bearer ` 前缀，verbatim 转发）。 */
  authorization: string;
  tenant: number;
  /** 原始入站 `terminal` header（ghcloud 端标识）；缺省时不注入该头。 */
  terminal?: string;
}

/**
 * ToolHandlerCtx — handler 执行上下文。
 *
 * 权威来源：docs/detailed-design/07-tools/builtin-catalog.md §9.1 HandlerCtx
 */
export interface ToolHandlerCtx {
  traceId: string;
  signal: AbortSignal;
  auth: {
    tenant: number;
    user?: { userId: string; displayName?: string; scopes: string[] };
    service?: { clientId: string };
  };
  session: {
    id: string;
    turnId: string;
  };
  turn?: {
    runtimeRefs?: RuntimeRefs;
  };
  /**
   * 出站 MCP 身份透传窄 carrier；仅 `authPassthrough: 'user'` 的 MCP server 消费。
   * 缺省表示本轮无用户令牌可透传（fail-closed：透传 server 将拒绝调用）。
   */
  callIdentity?: CallIdentity;
  /** 本轮用户原话。只有问数专用程序读取。 */
  userPrompt?: string;
  /** 同一模型步的问数调用计数。缺省时按单次调用处理。 */
  askStepGate?: AskBusinessDataStepGate;
}

/** 映射为 `@tachu/core` Port 所需的 AdapterCallContext（Provider / Vector / Memory）。 */
export function toAdapterCallContext(handlerCtx: ToolHandlerCtx): AdapterCallContext {
  return {
    correlation: {
      traceId: handlerCtx.traceId,
      requestId: handlerCtx.traceId,
      sessionId: handlerCtx.session.id,
      turnId: handlerCtx.session.turnId,
    },
    subject: {
      tenant: String(handlerCtx.auth.tenant),
      ...(handlerCtx.auth.user?.userId ? { userId: handlerCtx.auth.user.userId } : {}),
    },
    tenant: handlerCtx.auth.tenant,
  };
}
