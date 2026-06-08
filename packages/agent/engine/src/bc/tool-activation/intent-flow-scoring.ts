import type { ToolDescriptor } from '@tachu/core';
import type { ToolCandidateContribution } from '@tachu/core';
import {
  readGlobalIntentRoutingParams,
  type IntentRoutingBlock,
  type IntentRoutingOutcome,
} from './intent-routing-types';

type FlowScore = {
  toolName: string;
  priority: number;
  score: number;
};

function flowKeywordScore(prompt: string, keywords: readonly string[]): number {
  const lower = prompt.toLowerCase();
  return keywords.some((k) => lower.includes(String(k).toLowerCase())) ? 1 : 0;
}

function resolveIntentParams(block: IntentRoutingBlock) {
  const g = readGlobalIntentRoutingParams();
  return {
    confirm: block.routeConfirm ?? g.routeConfirm,
    floor: block.routeFallbackFloor ?? g.routeFallbackFloor,
    topK: block.fallbackTopK ?? g.fallbackTopK,
  };
}

/**
 * ADR-0020 keyword routing — shared by ToolCandidateStrategy and TurnService SSE audit.
 */
export function computeIntentToolRouting(input: {
  prompt: string;
  toolRefs: readonly string[];
  intentBlock?: IntentRoutingBlock | null;
}): IntentRoutingOutcome {
  const toolRefs = [...input.toolRefs];
  const block = input.intentBlock;
  if (!block || block.enabled === false || !Array.isArray(block.flows) || block.flows.length === 0) {
    return { state: 'matched', visibleToolRefs: toolRefs };
  }

  const { confirm, floor, topK } = resolveIntentParams(block);
  const flowNames = new Set(block.flows.map((f) => f.toolName));
  const nonFlow = toolRefs.filter((t) => !flowNames.has(t));

  const scored: FlowScore[] = block.flows.map((f) => ({
    toolName: f.toolName,
    priority: f.priority,
    score: flowKeywordScore(input.prompt, f.keywords),
  }));

  const maxScore = scored.length === 0 ? 0 : Math.max(...scored.map((s) => s.score));

  if (maxScore === 0) {
    return { state: 'empty', visibleToolRefs: nonFlow };
  }

  if (maxScore >= confirm) {
    const winners = scored.filter((s) => s.score >= confirm);
    winners.sort((a, b) => b.priority - a.priority || a.toolName.localeCompare(b.toolName));
    const topP = winners[0]!.priority;
    const bucket = winners.filter((w) => w.priority === topP);
    if (bucket.length === 1) {
      return { state: 'matched', visibleToolRefs: [...nonFlow, bucket[0]!.toolName] };
    }
    return {
      state: 'fallback',
      visibleToolRefs: [...nonFlow, ...bucket.map((b) => b.toolName)],
      multiMatch: true,
    };
  }

  const ranked = scored
    .filter((s) => s.score >= floor && s.score < confirm)
    .sort((a, b) => b.score - a.score || b.priority - a.priority || a.toolName.localeCompare(b.toolName));
  const picked = ranked.slice(0, topK).map((r) => r.toolName);
  if (picked.length === 0) {
    return { state: 'empty', visibleToolRefs: nonFlow };
  }
  return { state: 'fallback', visibleToolRefs: [...nonFlow, ...picked] };
}

/**
 * Map ADR-0020 routing outcome to tachu ToolCandidateContribution[] for ToolActivator.
 */
export function intentRoutingToToolContributions(input: {
  prompt: string;
  agentVisibleTools: readonly ToolDescriptor[];
  intentBlock?: IntentRoutingBlock | null;
}): ToolCandidateContribution[] {
  const toolRefs = input.agentVisibleTools.map((t) => t.name);
  const outcome = computeIntentToolRouting({
    prompt: input.prompt,
    toolRefs,
    intentBlock: input.intentBlock,
  });
  const visible = new Set(outcome.visibleToolRefs);
  const contributions: ToolCandidateContribution[] = [];

  for (const tool of input.agentVisibleTools) {
    if (!visible.has(tool.name)) continue;
    const isFlow = input.intentBlock?.flows?.some((f) => f.toolName === tool.name) ?? false;
    contributions.push({
      toolName: tool.name,
      score: 1,
      reason: isFlow ? `keyword:intent-flow:${outcome.state}` : 'keyword:non-flow-always',
      promote: { reason: isFlow ? `intent-flow:${outcome.state}` : 'non-flow-always' },
    });
  }

  return contributions;
}
