import type { AdapterCallContext } from '@tachu/core';
import type { IntentRoutingBlock } from '../tool-activation';

/**
 * Mutable per-turn state shared between {@link EngineFactory} and
 * {@link TurnAwareEmbeddingRuntime} / tool strategies.
 */
export interface TurnContextHolder {
  callContext?: AdapterCallContext;
  embeddingModelCode?: string;
  intentRoutingBlock?: IntentRoutingBlock | null;
}

export function createTurnContextHolder(): TurnContextHolder {
  return {};
}
