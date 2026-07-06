import {
  descriptorMetadataText,
  type ToolActivationContext,
  type ToolCandidateContribution,
  type ToolCandidateStrategy,
} from "@tachu/core";

import { computeIntentToolRouting } from "./intent-flow-scoring";
import type { IntentRoutingBlock } from "./intent-routing-types";

/**
 * Semantic pre-filter for flow-class tools.
 * Skips tools already selected by {@link KeywordToolStrategy} (γ shortcut).
 */
export class SemanticToolStrategy implements ToolCandidateStrategy {
  readonly name = "embedding-intent-flow";

  constructor(private readonly getIntentBlock: () => IntentRoutingBlock | null | undefined) {}

  async score(ctx: ToolActivationContext): Promise<ToolCandidateContribution[]> {
    const facade = ctx.semanticRetrieval;
    if (facade === undefined) {
      return [];
    }

    const block = this.getIntentBlock();
    if (!block || block.enabled === false || !Array.isArray(block.flows) || block.flows.length === 0) {
      return [];
    }

    const flowNames = new Set(block.flows.map((f) => f.toolName));
    const toolRefs = ctx.agentVisibleTools.map((t) => t.name);
    const keywordOutcome = computeIntentToolRouting({
      prompt: ctx.query,
      toolRefs,
      intentBlock: block,
    });
    const keywordVisible = new Set(keywordOutcome.visibleToolRefs);

    const flowTools = ctx.agentVisibleTools.filter((t) => flowNames.has(t.name));
    const corpus = flowTools
      .filter((t) => !keywordVisible.has(t.name))
      .map((t) => ({
        id: t.name,
        text: descriptorMetadataText({
          name: t.name,
          ...(t.displayName !== undefined ? { displayName: t.displayName } : {}),
          description: t.description,
          ...(t.tags !== undefined ? { tags: [...t.tags] } : {}),
        }),
      }));

    if (corpus.length === 0) {
      return [];
    }

    const result = await facade.retrieve(
      {
        caller: "tool",
        namespace: "intent-flow",
        query: ctx.query,
        corpus,
      },
      {
        correlation: ctx.correlation,
        ...(ctx.subject !== undefined ? { subject: ctx.subject } : {}),
      },
      ctx.signal,
    );
    return result.hits.map((h) => ({
      toolName: h.id,
      score: h.score,
      reason: `embedding:${h.score.toFixed(3)}`,
    }));
  }
}
