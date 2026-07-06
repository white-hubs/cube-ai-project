import type { ActivationContext, CandidateContribution, CandidateStrategy } from "@tachu/core";

import { scoreSkillsByKeyword } from "./keyword.strategy";

/**
 * Engine-hosted keyword candidate strategy.
 * Registered on tachu `Engine` via `EngineFactory`.
 */
export class KeywordCandidateStrategy implements CandidateStrategy {
  readonly name = "keyword";

  async score(ctx: ActivationContext): Promise<CandidateContribution[]> {
    const pinned = new Set(ctx.snapshotSkillRefs);
    const sticky = new Set((await ctx.stickyManager.list(ctx.sessionId, ctx.currentTurn)).active.map((e) => e.skillName));
    const exclude = new Set([...pinned, ...sticky]);

    const skills = ctx.registry.list("skill");
    const hits = scoreSkillsByKeyword(ctx.query, skills, { excludeNames: exclude });

    return hits.map((hit) => ({
      skillName: hit.skill.name,
      score: hit.score,
      reason: hit.reason,
      ...(hit.promote ? { promote: { reason: hit.reason } } : {}),
    }));
  }
}
