import type { SkillDescriptor, SkillDiscoveryEntry, SkillDiscoveryProvider, SkillDiscoverySearchHit } from "@tachu/core";

import type { ShelfEntryView } from "@cube-ai/contracts";

/** 只读 shelf 的最小接口（避免耦合整个 UserShelfRepository / ShelfService）。 */
export interface ShelfSkillLister {
  listByUser(tenant: number, userId: string, kind: "agent" | "skill"): Promise<ShelfEntryView[]>;
}

/** owner-aware 技能解析最小接口（= {@link TenantDescriptorResolver.getSkill}）。 */
export interface OwnerAwareSkillResolver {
  getSkill(tenant: number, ref: string, actorUserId?: string): Promise<SkillDescriptor | undefined>;
}

function skillTags(skill: SkillDescriptor): string[] | undefined {
  const tags = (skill as { tags?: unknown }).tags;
  if (!Array.isArray(tags)) return undefined;
  const kept = tags.filter((t): t is string => typeof t === "string");
  return kept.length > 0 ? kept : undefined;
}

/**
 * 从「我的技能」(user shelf) 构造 tachu `SkillDiscoveryProvider`（渐进式披露 L2/L3）。
 *
 * - 数据源 = 当前 user 的 shelf 中 `enabled` 且 `runnableStatus === "runnable"` 的技能条目，
 *   经 owner-aware `resolver.getSkill` 解析（owner 见 draft、他人见已发布）。租户/用户作用域
 *   由传入的 `tenant`+`userId` 决定——provider 只读该用户 shelf、**不碰 tachu 全局 registry**，
 *   因而天然满足租户隔离（AGENTS.md #3）。
 * - 目录在单个 provider 实例（= 单回合）内**记忆化一次**：`list`/`search`/`load` 复用同一份
 *   解析结果；跨回合每轮新建 provider → 始终反映最新 owner-aware 正文（不长缓存）。
 * - 裸系统 ref（无 `skl_` 前缀）由 `getSkill` 返回 undefined 自然跳过——它们已在进程 registry，
 *   由 tachu 按 name 去重（registry 权威）。
 *
 * 备注（perf）：当前实现于 `list` 时解析全部 runnable shelf 技能的完整正文（仅 DB I/O，不进
 * prompt）。技能数量很大时可后续加「仅元数据」快查路径优化（见交接文档 §4 perf 备注）。
 */
export function buildShelfSkillDiscoveryProvider(deps: {
  shelf: ShelfSkillLister;
  resolver: OwnerAwareSkillResolver;
  tenant: number;
  userId: string;
}): SkillDiscoveryProvider {
  const { shelf, resolver, tenant, userId } = deps;
  let catalog: Promise<Map<string, SkillDescriptor>> | undefined;

  const resolveCatalog = (): Promise<Map<string, SkillDescriptor>> => {
    if (!catalog) {
      catalog = (async () => {
        const byName = new Map<string, SkillDescriptor>();
        let entries: ShelfEntryView[];
        try {
          entries = await shelf.listByUser(tenant, userId, "skill");
        } catch {
          return byName;
        }
        for (const entry of entries) {
          if (!entry.enabled || entry.runnableStatus !== "runnable") continue;
          try {
            const skill = await resolver.getSkill(tenant, entry.targetId, userId);
            if (skill?.name && !byName.has(skill.name)) byName.set(skill.name, skill);
          } catch {
            // 单个技能解析失败不影响其余（tachu 侧对 list 抛错也会整体降级）。
          }
        }
        return byName;
      })();
    }
    return catalog;
  };

  return {
    list: async (): Promise<SkillDiscoveryEntry[]> => {
      const byName = await resolveCatalog();
      return [...byName.values()].map((skill) => {
        const tags = skillTags(skill);
        return {
          name: skill.name,
          description: skill.description ?? "",
          ...(tags ? { tags } : {}),
        };
      });
    },
    search: async (query: string, topK?: number): Promise<SkillDiscoverySearchHit[]> => {
      const byName = await resolveCatalog();
      const q = query.trim().toLowerCase();
      const hits: SkillDiscoverySearchHit[] = [];
      for (const skill of byName.values()) {
        const description = skill.description ?? "";
        const inName = q.length > 0 && skill.name.toLowerCase().includes(q);
        const inDesc = q.length > 0 && description.toLowerCase().includes(q);
        if (q.length === 0 || inName || inDesc) {
          hits.push({ name: skill.name, description, score: inName ? 0.9 : inDesc ? 0.7 : 0.5 });
        }
      }
      hits.sort((left, right) => right.score - left.score);
      return typeof topK === "number" && topK > 0 ? hits.slice(0, topK) : hits;
    },
    load: async (name: string): Promise<SkillDescriptor | null> => {
      const byName = await resolveCatalog();
      return byName.get(name) ?? null;
    },
  };
}
