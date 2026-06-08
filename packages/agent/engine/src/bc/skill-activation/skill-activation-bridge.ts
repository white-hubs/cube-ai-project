import type { SkillDescriptor } from '@tachu/core';
import { scoreSkillsByKeyword } from './keyword.strategy';

export const SKILL_DISCOVERY_PROMPT_SUFFIX = `## Skill Discovery

Follow any skill listed under **Active Skills** in the system prompt (full instructions).

**Available Skills** lists names only — you do not have that skill's full contract until it appears under Active Skills.

Do not output raw tool-call syntax in user-visible text: no \`<tool_call>\`, \`load_skill\`, or \`search_skills\` blocks. Those tools exist only on the agentic tool-use path; on direct-answer turns, obey Active Skills or answer without pretending to invoke tools.`;

export type SkillActivationBridgeResult = {
  /** Skills injected as SessionScope.additionalSkills (T0 pinned in current tachu). */
  additionalSkills: SkillDescriptor[];
  /** Metadata-only rows for observability / future T1 rendering. */
  metadataCandidates: Array<{ name: string; description: string; score: number; reason: string }>;
};

export type SkillActivationBridgeInput = {
  query: string;
  /** From snapshot hydration (Agent skillRefs). */
  pinnedFromSnapshot: readonly SkillDescriptor[];
  /** Full registry for discovery. */
  registrySkills: readonly SkillDescriptor[];
  topK?: number;
};

/**
 * Bridge until tachu `SkillActivator` lands: merge snapshot-pinned skills with keyword hits.
 */
export function resolveSkillsForSessionScope(
  input: SkillActivationBridgeInput,
): SkillActivationBridgeResult {
  const topK = input.topK ?? 20;
  const pinnedNames = new Set(input.pinnedFromSnapshot.map((s) => s.name));
  const byName = new Map<string, SkillDescriptor>();

  for (const skill of input.pinnedFromSnapshot) {
    byName.set(skill.name, skill);
  }

  const keywordHits = scoreSkillsByKeyword(input.query, input.registrySkills, {
    excludeNames: pinnedNames,
  });

  const metadataCandidates: SkillActivationBridgeResult['metadataCandidates'] = [];

  for (const hit of keywordHits) {
    if (hit.promote) {
      byName.set(hit.skill.name, hit.skill);
      continue;
    }
    if (metadataCandidates.length >= topK) {
      continue;
    }
    metadataCandidates.push({
      name: hit.skill.name,
      description: hit.skill.description,
      score: hit.score,
      reason: hit.reason,
    });
  }

  return {
    additionalSkills: [...byName.values()],
    metadataCandidates,
  };
}

export function appendSkillDiscoveryHint(systemInstruction: string): string {
  const trimmed = systemInstruction.trim();
  if (trimmed.length === 0) {
    return SKILL_DISCOVERY_PROMPT_SUFFIX;
  }
  if (trimmed.includes('## Skill Discovery')) {
    return trimmed;
  }
  return `${trimmed}\n\n${SKILL_DISCOVERY_PROMPT_SUFFIX}`;
}
