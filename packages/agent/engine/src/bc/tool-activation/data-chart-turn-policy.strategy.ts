import type { ToolActivationContext, ToolCandidateContribution, ToolCandidateStrategy } from '@tachu/core';
import {
  buildDataChartTurnPolicyPreseed,
  detectDataChartIntent,
  promptMentionsTool,
} from '../tachu/host-turn-policy';

const IMAGE_TOOL = 'image.qwen';

/**
 * Host keyword fallback when intent LLM omits turnPolicy (ADR-0023 §B).
 * Runs after {@link IntentTurnPolicyToolStrategy} so intent/preseed wins when present.
 */
export class DataChartTurnPolicyToolStrategy implements ToolCandidateStrategy {
  readonly name = 'host-data-chart-turn-policy';

  async score(ctx: ToolActivationContext): Promise<ToolCandidateContribution[]> {
    const policy = ctx.turnPolicy;
    if (policy && (policy.excludeTools.includes(IMAGE_TOOL) || policy.pinSkills.length > 0)) {
      return [];
    }

    const query = ctx.query?.trim() ?? '';
    if (!detectDataChartIntent(query)) return [];

    const visible = new Set(ctx.agentVisibleTools.map((tool) => tool.name));
    if (!visible.has(IMAGE_TOOL)) return [];

    if (promptMentionsTool(query, IMAGE_TOOL)) return [];

    const preseed = buildDataChartTurnPolicyPreseed();
    const contributions: ToolCandidateContribution[] = [];
    for (const toolName of preseed.excludeTools) {
      if (!visible.has(toolName)) continue;
      contributions.push({
        toolName,
        score: 0,
        reason: 'host-data-chart:exclude',
        exclude: { reason: 'host-data-chart:exclude' },
      });
    }
    return contributions;
  }
}
