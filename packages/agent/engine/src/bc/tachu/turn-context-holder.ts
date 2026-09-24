import type { AdapterCallContext } from "@tachu/core";

import type { IntentRoutingBlock } from "../tool-activation";
import type { AskBusinessDataStepGate } from "../tools/biz-ontology-address";
import type { CallIdentity } from "../tools/tool-context";

export interface ToolProgressSinkEvent {
  toolCallId: string;
  toolName: string;
  status: string;
  progress?: number;
  message?: string;
  safeDisplayMessage?: string;
}

/**
 * Mutable per-turn state shared between {@link EngineFactory} and
 * {@link TurnAwareEmbeddingRuntime} / tool strategies.
 */
export interface TurnContextHolder {
  callContext?: AdapterCallContext;
  /**
   * 本轮调用方用户身份（出站 MCP 身份透传窄 carrier）；在 turn 起点设置、finally 清空，
   * 供 {@link EngineFactory.toToolHandlerCtx} 读取，**不进** ExecutionContext.principal。
   */
  callIdentity?: CallIdentity;
  /** 本轮用户原话，供问数专用程序核对拼接。 */
  userPrompt?: string;
  askStepGate?: AskBusinessDataStepGate;
  embeddingModelCode?: string;
  intentRoutingBlock?: IntentRoutingBlock | null;
  toolProgressSink?: (event: ToolProgressSinkEvent) => void;
}

export function createTurnContextHolder(): TurnContextHolder {
  return {};
}
