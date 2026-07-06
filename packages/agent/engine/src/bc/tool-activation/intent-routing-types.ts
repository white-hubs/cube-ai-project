/**
 * Agent descriptor intent-routing schema.
 * Types only — algorithm lives in `intent-flow-scoring.ts`.
 */

export type IntentRoutingState = "matched" | "fallback" | "empty";

export interface IntentRoutingFlowRule {
  toolName: string;
  priority: number;
  keywords: readonly string[];
}

export interface IntentRoutingBlock {
  enabled?: boolean;
  routeConfirm?: number;
  routeFallbackFloor?: number;
  fallbackTopK?: number;
  flows?: readonly IntentRoutingFlowRule[];
}

export interface IntentRoutingOutcome {
  state: IntentRoutingState;
  /** Legacy audit / SSE field. */
  visibleToolRefs: string[];
  multiMatch?: boolean;
}

export function readGlobalIntentRoutingParams(): {
  fallbackTopK: number;
  routeConfirm: number;
  routeFallbackFloor: number;
} {
  return {
    fallbackTopK: Math.max(1, Number(process.env["AGENTIC_INTENT_ROUTING_FALLBACK_TOP_K"] ?? 5)),
    routeConfirm: Number(process.env["AGENTIC_INTENT_ROUTING_ROUTE_CONFIRM"] ?? 1),
    routeFallbackFloor: Number(process.env["AGENTIC_INTENT_ROUTING_ROUTE_FALLBACK_FLOOR"] ?? 0),
  };
}
