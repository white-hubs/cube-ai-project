import type { ToolActivationContext, ToolCandidateStrategy } from '@tachu/core';
import { intentRoutingToToolContributions } from './intent-flow-scoring';
import type { IntentRoutingBlock } from './intent-routing-types';

/**
 * ADR-0020 keyword flow routing as a tachu ToolCandidateStrategy (ADR-0024 / staged 0010).
 */
export class KeywordToolStrategy implements ToolCandidateStrategy {
  readonly name = 'keyword-intent-flow';

  constructor(
    private readonly getIntentBlock: () => IntentRoutingBlock | null | undefined,
  ) {}

  async score(ctx: ToolActivationContext) {
    return intentRoutingToToolContributions({
      prompt: ctx.query,
      agentVisibleTools: ctx.agentVisibleTools,
      intentBlock: this.getIntentBlock(),
    });
  }
}
