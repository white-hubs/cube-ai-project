import type { AdapterCallContext } from "@tachu/core";

import type { IntentRoutingBlock } from "../tool-activation";
import type { CallIdentity } from "../tools/tool-context";

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
  embeddingModelCode?: string;
  intentRoutingBlock?: IntentRoutingBlock | null;
}

export function createTurnContextHolder(): TurnContextHolder {
  return {};
}
