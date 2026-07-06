import type { ToolActivationContext, ToolCandidateStrategy } from "@tachu/core";

import { intentRoutingToToolContributions } from "./intent-flow-scoring";
import type { IntentRoutingBlock } from "./intent-routing-types";

/**
 * Keyword-based flow routing, implemented as a tachu ToolCandidateStrategy.
 */
export class KeywordToolStrategy implements ToolCandidateStrategy {
  readonly name = "keyword-intent-flow";

  constructor(private readonly getIntentBlock: () => IntentRoutingBlock | null | undefined) {}

  async score(ctx: ToolActivationContext) {
    return intentRoutingToToolContributions({
      prompt: ctx.query,
      agentVisibleTools: ctx.agentVisibleTools,
      intentBlock: this.getIntentBlock(),
    });
  }
}
