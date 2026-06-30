import type { SkillDescriptor } from '@tachu/core';
import { parseTenantDescriptorId } from '@cube-ai/contracts';

import type { RuleDescriptor } from './rule-registry.service';
import type { TenantDescriptorResolver } from './tenant-descriptor-resolver';
import type { RuleRegistryResolveLike } from '../session/snapshot-rule-hydration';
import type { SkillRegistryResolveLike } from '../session/snapshot-skill-hydration';

/**
 * Prefetch tenant `rul_*` refs and merge into a synchronous resolve() wrapper.
 * Bare refs or missing resolver → returns base registry unchanged.
 */
export async function mergeTenantRules(
  refs: readonly string[],
  base: RuleRegistryResolveLike | undefined,
  resolver: TenantDescriptorResolver | undefined,
  tenant: number,
): Promise<RuleRegistryResolveLike | undefined> {
  if (!resolver || refs.length === 0) return base;
  const hasTenantRef = refs.some((r) => parseTenantDescriptorId(r)?.kind === 'rule');
  if (!hasTenantRef) return base;
  const tenantRules = new Map<string, RuleDescriptor>();
  for (const ref of refs) {
    if (parseTenantDescriptorId(ref)?.kind !== 'rule') continue;
    const rule = await resolver.getRule(tenant, ref);
    if (rule) tenantRules.set(ref, rule);
  }
  return {
    resolve: (name: string, version?: string) => tenantRules.get(name) ?? base?.resolve(name, version),
  };
}

/**
 * Prefetch tenant `skl_*` refs and merge into a synchronous resolve() wrapper.
 * Used by session snapshot hydration and per-turn runtime skill @-mentions.
 */
export async function mergeTenantSkills(
  refs: readonly string[],
  base: SkillRegistryResolveLike | undefined,
  resolver: TenantDescriptorResolver | undefined,
  tenant: number,
): Promise<SkillRegistryResolveLike | undefined> {
  if (!resolver || refs.length === 0) return base;
  const hasTenantRef = refs.some((r) => parseTenantDescriptorId(r)?.kind === 'skill');
  if (!hasTenantRef) return base;
  const tenantSkills = new Map<string, SkillDescriptor>();
  for (const ref of refs) {
    if (parseTenantDescriptorId(ref)?.kind !== 'skill') continue;
    const skill = await resolver.getSkill(tenant, ref);
    if (skill) tenantSkills.set(ref, skill);
  }
  return {
    resolve: (name: string, version?: string) => tenantSkills.get(name) ?? base?.resolve(name, version),
  };
}
