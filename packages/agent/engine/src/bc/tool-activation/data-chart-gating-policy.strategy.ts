import type { ToolActivationContext, ToolCandidateContribution, ToolCandidateStrategy } from "@tachu/core";

import { buildDataChartGatingPolicyPreseed, detectDataChartIntent, promptMentionsTool } from "../tachu/host-gating-policy";

const IMAGE_TOOL = "image.qwen";

/**
 * Host keyword fallback when the host preseed omits a gatingPolicy.
 * Runs after tachu's built-in `HostPolicyToolStrategy` (name "host-policy") so an
 * explicit preseed (exclude/include) wins when present.
 */
export class DataChartGatingPolicyToolStrategy implements ToolCandidateStrategy {
  readonly name = "host-data-chart-gating-policy";

  async score(ctx: ToolActivationContext): Promise<ToolCandidateContribution[]> {
    const policy = ctx.gatingPolicy;
    if (policy && (policy.excludeTools.includes(IMAGE_TOOL) || policy.pinSkills.length > 0)) {
      return [];
    }

    const query = ctx.query?.trim() ?? "";
    if (!detectDataChartIntent(query)) return [];

    const visible = new Set(ctx.agentVisibleTools.map((tool) => tool.name));
    if (!visible.has(IMAGE_TOOL)) return [];

    if (promptMentionsTool(query, IMAGE_TOOL)) return [];

    const preseed = buildDataChartGatingPolicyPreseed();
    const contributions: ToolCandidateContribution[] = [];
    for (const toolName of preseed.excludeTools) {
      if (!visible.has(toolName)) continue;
      contributions.push({
        toolName,
        score: 0,
        reason: "host-data-chart:exclude",
        exclude: { reason: "host-data-chart:exclude" },
      });
    }
    return contributions;
  }
}
