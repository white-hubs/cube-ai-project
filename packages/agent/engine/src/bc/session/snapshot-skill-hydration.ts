import type { SkillDescriptor } from "@tachu/core";

import { AgenticEngineError } from "../../infra/errors/agentic-error";

/** Inline skill row frozen into `agentSnapshotJson.skills[]` (ADR-0012). */
export type SnapshotSkillEntry = {
  name: string;
  versionNo: number;
  content: SkillDescriptor;
};

export type SkillRegistryResolveLike = {
  resolve(name: string, version?: string): SkillDescriptor | undefined;
};

export function semverMajorAsVersionNo(version: string | undefined): number {
  const raw = (version ?? "0.0.0").split(".")[0];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
}

function cloneSkillDescriptor(skill: SkillDescriptor): SkillDescriptor {
  return JSON.parse(JSON.stringify(skill)) as SkillDescriptor;
}

/**
 * Resolve `skillRefs` into frozen snapshot rows. Missing refs fail session creation.
 */
export function hydrateSnapshotSkills(skillRefs: readonly string[], registry: SkillRegistryResolveLike | undefined): SnapshotSkillEntry[] {
  if (skillRefs.length === 0) {
    return [];
  }
  if (!registry) {
    throw AgenticEngineError.fromCode("INTERNAL_UNKNOWN", "SkillRegistry is required to hydrate skillRefs into session snapshot", {
      skillRefs: [...skillRefs],
    });
  }

  const out: SnapshotSkillEntry[] = [];
  for (const ref of skillRefs) {
    const skill = registry.resolve(ref);
    if (!skill) {
      throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_DESCRIPTOR", `Skill descriptor not found for skillRef: ${ref}`, {
        skillName: ref,
      });
    }
    out.push({
      name: skill.name,
      versionNo: semverMajorAsVersionNo(skill.version),
      content: cloneSkillDescriptor(skill),
    });
  }
  return out;
}

/**
 * Extract tachu `SkillDescriptor[]` from a parsed agent snapshot for `SessionScope.additionalSkills`.
 */
export function snapshotSkillsToDescriptors(skills: ReadonlyArray<unknown> | undefined): SkillDescriptor[] {
  if (!skills || skills.length === 0) {
    return [];
  }
  const out: SkillDescriptor[] = [];
  for (const row of skills) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const content = rec["content"];
    if (content && typeof content === "object" && (content as SkillDescriptor).kind === "skill") {
      out.push(content as SkillDescriptor);
      continue;
    }
    if (rec["kind"] === "skill" && typeof rec["name"] === "string") {
      out.push(rec as unknown as SkillDescriptor);
    }
  }
  return out;
}
