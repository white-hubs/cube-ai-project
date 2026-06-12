import type { RuleDescriptor } from '../descriptor/rule-registry.service';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { semverMajorAsVersionNo } from './snapshot-skill-hydration';

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
export function hydrateSnapshotRules(
  ruleRefs: readonly string[],
  registry: RuleRegistryResolveLike | undefined,
): SnapshotRuleEntry[] {
  if (ruleRefs.length === 0) {
    return [];
  }
  if (!registry) {
    throw AgenticEngineError.fromCode(
      'INTERNAL_UNKNOWN',
      'RuleRegistry is required to hydrate ruleRefs into session snapshot',
      { ruleRefs: [...ruleRefs] },
    );
  }

  const out: SnapshotRuleEntry[] = [];
  for (const ref of ruleRefs) {
    const rule = registry.resolve(ref);
    if (!rule) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_NOT_FOUND_DESCRIPTOR',
        `Rule descriptor not found for ruleRef: ${ref}`,
        { ruleName: ref },
      );
    }
    out.push({
      name: rule.name,
      versionNo: semverMajorAsVersionNo(rule.version),
      content: cloneRuleDescriptor(rule),
    });
  }
  return out;
}

/** snapshot.rules → 注入 system prompt 的规则文本（global prompt 之后、agent prompt 之前）。 */
export function snapshotRuleTexts(rules: readonly SnapshotRuleEntry[]): string[] {
  return rules
    .map((r) => r.content.content.trim())
    .filter((text) => text.length > 0);
}
