import type { LibraryItemView } from "./library";
import type { TenantAgentContent } from "./tenant-descriptor";

/**
 * 引擎运行时内置 agent（文件/registry），供 cube-default 编排、子智能体委托等内部链路使用。
 * 与用户租户资产、产品默认智能体（193400000000000000*）隔离：不可安装、不可会话、不可写入用户 descriptor。
 */
export const ENGINE_INTERNAL_AGENT_REFS = [
  "cube-default",
  "cube-descriptor-manager",
  "cube-researcher",
] as const;

/**
 * 引擎运行时内置 skill，由 semantic recall / turn policy 等内部激活。
 * 与用户技能资产隔离：不可安装、不可写入用户 agent.skillRefs。
 */
export const ENGINE_INTERNAL_SKILL_REFS = ["default-reasoning", "chart-output"] as const;

export type EngineInternalAgentRef = (typeof ENGINE_INTERNAL_AGENT_REFS)[number];
export type EngineInternalSkillRef = (typeof ENGINE_INTERNAL_SKILL_REFS)[number];

export const ENGINE_INTERNAL_DESCRIPTOR_ERROR_CODE = "FAILED_PRECONDITION_ENGINE_INTERNAL_DESCRIPTOR" as const;

const INTERNAL_AGENT_SET = new Set<string>(ENGINE_INTERNAL_AGENT_REFS);
const INTERNAL_SKILL_SET = new Set<string>(ENGINE_INTERNAL_SKILL_REFS);

export function isEngineInternalAgentRef(ref: string): boolean {
  return INTERNAL_AGENT_SET.has(ref);
}

export function isEngineInternalSkillRef(ref: string): boolean {
  return INTERNAL_SKILL_SET.has(ref);
}

export function isEngineInternalLibraryRef(kind: LibraryItemView["kind"], ref: string): boolean {
  return kind === "agent" ? isEngineInternalAgentRef(ref) : isEngineInternalSkillRef(ref);
}

export function filterUserVisibleLibraryItems<T extends Pick<LibraryItemView, "kind" | "ref">>(items: T[]): T[] {
  return items.filter((item) => !isEngineInternalLibraryRef(item.kind, item.ref));
}

export interface EngineInternalRefViolation {
  field: "agentId" | "skillRefs" | "subAgentRefs" | "shelf";
  ref: string;
}

/** 扫描用户 agent content 是否引用了引擎内置资产。 */
export function findEngineInternalRefsInAgentContent(content: Pick<TenantAgentContent, "skillRefs" | "subAgentRefs">): EngineInternalRefViolation[] {
  const violations: EngineInternalRefViolation[] = [];
  for (const ref of content.skillRefs ?? []) {
    if (isEngineInternalSkillRef(ref)) {
      violations.push({ field: "skillRefs", ref });
    }
  }
  for (const ref of content.subAgentRefs ?? []) {
    if (isEngineInternalAgentRef(ref)) {
      violations.push({ field: "subAgentRefs", ref });
    }
  }
  return violations;
}

export function formatEngineInternalRefViolations(violations: EngineInternalRefViolation[]): string {
  return violations.map((item) => `${item.field}:${item.ref}`).join(", ");
}

/** 用户面 agent content：剔除引擎内置 skill/subAgent 引用（用于快照兜底清洗）。 */
export function stripEngineInternalRefsFromAgentContent<T extends Pick<TenantAgentContent, "skillRefs" | "subAgentRefs">>(content: T): T {
  return {
    ...content,
    skillRefs: (content.skillRefs ?? []).filter((ref) => !isEngineInternalSkillRef(ref)),
    subAgentRefs: (content.subAgentRefs ?? []).filter((ref) => !isEngineInternalAgentRef(ref)),
  };
}

export interface UserShelfLike {
  targetKind: "agent" | "skill";
  targetId: string;
}

/** 用户货架：剔除指向引擎内置资产的条目。 */
export function filterUserVisibleShelfEntries<T extends UserShelfLike>(entries: T[]): T[] {
  return entries.filter((entry) => !isEngineInternalLibraryRef(entry.targetKind, entry.targetId));
}

export function filterUserVisibleSkillRefs(refs: readonly string[]): string[] {
  return refs.filter((ref) => !isEngineInternalSkillRef(ref));
}

export function filterUserVisibleSubAgentRefs(refs: readonly string[]): string[] {
  return refs.filter((ref) => !isEngineInternalAgentRef(ref));
}
