import type { RuleDescriptor as TachuRuleDescriptor } from "@tachu/core";

import { AgenticEngineError } from "../../infra/errors/agentic-error";
import { resolveRuleActivation, type RuleDescriptor } from "../descriptor/rule-registry.service";
import { semverMajorAsVersionNo } from "./snapshot-skill-hydration";

/** Inline rule row frozen into `agentSnapshotJson.rules[]`（ADR-0016 §7，对称于 skills[]）。 */
export type SnapshotRuleEntry = {
  name: string;
  versionNo: number;
  content: RuleDescriptor;
};

export type RuleRegistryResolveLike = {
  resolve(name: string, version?: string): RuleDescriptor | undefined;
};

function cloneRuleDescriptor(rule: RuleDescriptor): RuleDescriptor {
  return JSON.parse(JSON.stringify(rule)) as RuleDescriptor;
}

/**
 * Resolve `ruleRefs` into frozen snapshot rows. Missing refs fail session creation
 * （与 skill 水合同语义）。`rul_` 前缀的租户级引用在 tenant-descriptor 持久层落地前
 * 同样按 not-found 处理。
 */
export function hydrateSnapshotRules(ruleRefs: readonly string[], registry: RuleRegistryResolveLike | undefined): SnapshotRuleEntry[] {
  if (ruleRefs.length === 0) {
    return [];
  }
  if (!registry) {
    throw AgenticEngineError.fromCode("INTERNAL_UNKNOWN", "RuleRegistry is required to hydrate ruleRefs into session snapshot", {
      ruleRefs: [...ruleRefs],
    });
  }

  const out: SnapshotRuleEntry[] = [];
  for (const ref of ruleRefs) {
    const rule = registry.resolve(ref);
    if (!rule) {
      throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_DESCRIPTOR", `Rule descriptor not found for ruleRef: ${ref}`, {
        ruleName: ref,
      });
    }
    out.push({
      name: rule.name,
      versionNo: semverMajorAsVersionNo(rule.version),
      content: cloneRuleDescriptor(rule),
    });
  }
  return out;
}

/**
 * snapshot.rules → tachu `RuleDescriptor[]`，喂给 `SessionScope.additionalRules`（ADR-0032）。
 *
 * 规则组装**统一交给 tachu 引擎**（`PromptAssembler` 每轮按 `activation` 决定注入哪些规则：
 * `always` 恒进、`manual` 命中 `explicitRuleNames` 才进、`semantic`/`path` 由对应输入门控）——
 * 全部落 system 段、每轮重算、**不入 memory**。本函数只做「本仓 snapshot 规则 → tachu 词汇」
 * 的忠实投影，snapshot 仍是整会话规则权威（版本冻结），每轮据此投影，不读 live registry。
 *
 * 入参按 `unknown[]` 防御性解析（snapshot 从 JSON 水合，形状不受编译器保护）：
 * 非对象行、非 rule 内容、空正文一律跳过。缺省 activation 回落 `always`；本仓无
 * rule/preference 之分，`type` 一律投影为 `"rule"`（进 tachu `## Hard Rules` 段）。
 */
export function snapshotRulesToTachuDescriptors(rules: ReadonlyArray<unknown> | undefined): TachuRuleDescriptor[] {
  if (!rules || rules.length === 0) return [];
  const out: TachuRuleDescriptor[] = [];
  for (const row of rules) {
    if (!row || typeof row !== "object") continue;
    const content = (row as Record<string, unknown>)["content"];
    if (!content || typeof content !== "object") continue;
    const desc = content as RuleDescriptor;
    if (desc.kind !== "rule" || typeof desc.name !== "string") continue;
    const text = typeof desc.content === "string" ? desc.content.trim() : "";
    if (text.length === 0) continue;
    out.push({
      kind: "rule",
      name: desc.name,
      description: desc.description ?? "",
      type: "rule",
      activation: resolveRuleActivation(desc),
      content: text,
      ...(desc.version !== undefined ? { version: desc.version } : {}),
      ...(desc.displayName !== undefined ? { displayName: desc.displayName } : {}),
      ...(desc.tags !== undefined ? { tags: desc.tags } : {}),
    });
  }
  return out;
}
