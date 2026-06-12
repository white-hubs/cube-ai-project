/**
 * TenantDescriptorResolver —— 运行时按 id 前缀路由的租户 descriptor 解析（ADR-0016 §5/§7）。
 *
 * - 裸 name（无前缀）由调用方走 registry/文件（系统级）；本解析器只认前缀 id（`agt_/skl_/rul_`），
 *   回源 {@link TenantDescriptorRepository}.resolvePublished —— 仅已发布 head 可见（草稿不可解析）。
 * - 条目级内存缓存（key = `tenant::id`，TTL 默认 30s）；T7 outbox `descriptor.reload` 事件经
 *   {@link invalidate}/{@link invalidateAll} 失效。
 * - 把租户内容投影成与系统级 registry 同构的形状（RuleDescriptor / SkillDescriptor / agent record），
 *   使 buildSnapshots 的水合逻辑无需区分来源。
 */
import { Injectable } from '@dangao/bun-server';
import type { SkillDescriptor } from '@tachu/core';
import {
  parseTenantDescriptorId,
  type TenantAgentContent,
  type TenantRuleContent,
  type TenantSkillContent,
  type TenantDescriptorView,
} from '@cube-ai/contracts';
import type { RuleDescriptor } from './rule-registry.service';
import type { TenantDescriptorRepository } from './tenant-descriptor.repository';

interface CacheEntry {
  view: TenantDescriptorView | null;
  expiresAt: number;
}

@Injectable()
export class TenantDescriptorResolver {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly repo: TenantDescriptorRepository,
    private readonly ttlMs = 30_000,
  ) {}

  private key(tenant: number, id: string): string {
    return `${tenant}::${id}`;
  }

  /** 失效单个条目（T7 descriptor.reload 精确失效）。 */
  invalidate(tenant: number, id: string): void {
    this.cache.delete(this.key(tenant, id));
  }

  /** 失效整租户（粗粒度）。 */
  invalidateTenant(tenant: number): void {
    const prefix = `${tenant}::`;
    for (const k of this.cache.keys()) {
      if (k.startsWith(prefix)) this.cache.delete(k);
    }
  }

  /** 清空全部缓存（事件源不可信时兜底）。 */
  invalidateAll(): void {
    this.cache.clear();
  }

  private async resolveView(tenant: number, id: string): Promise<TenantDescriptorView | null> {
    const k = this.key(tenant, id);
    const hit = this.cache.get(k);
    if (hit && hit.expiresAt > Date.now()) return hit.view;
    const view = await this.repo.resolvePublished(tenant, id);
    this.cache.set(k, { view, expiresAt: Date.now() + this.ttlMs });
    return view;
  }

  /** 前缀 agent id → buildSnapshots 可消费的 record（prompt/refs/tools）；非前缀或未发布 → null。 */
  async getAgentRecord(tenant: number, ref: string): Promise<Record<string, unknown> | null> {
    if (parseTenantDescriptorId(ref)?.kind !== 'agent') return null;
    const view = await this.resolveView(tenant, ref);
    if (!view || view.kind !== 'agent') return null;
    const c = view.content as TenantAgentContent;
    return {
      instructions: c.prompt,
      prompt: c.prompt,
      ...(c.modelConfig !== undefined ? { modelConfig: c.modelConfig } : {}),
      availableTools: c.availableTools ?? [],
      ruleRefs: c.ruleRefs ?? [],
      skillRefs: c.skillRefs ?? [],
      ...(c.subAgentRefs && c.subAgentRefs.length > 0 ? { subAgentRefs: c.subAgentRefs } : {}),
      ...(typeof c.maxDepth === 'number' ? { maxDepth: c.maxDepth } : {}),
    };
  }

  /** 前缀 rule id → RuleDescriptor；非前缀或未发布 → undefined（调用方回落系统 registry / not-found）。 */
  async getRule(tenant: number, ref: string): Promise<RuleDescriptor | undefined> {
    if (parseTenantDescriptorId(ref)?.kind !== 'rule') return undefined;
    const view = await this.resolveView(tenant, ref);
    if (!view || view.kind !== 'rule') return undefined;
    const c = view.content as TenantRuleContent;
    return {
      kind: 'rule',
      name: view.name,
      content: c.content,
      ...(c.version !== undefined ? { version: c.version } : {}),
      ...(c.description !== undefined ? { description: c.description } : {}),
      ...(c.displayName !== undefined ? { displayName: c.displayName } : {}),
      ...(c.tags !== undefined ? { tags: c.tags } : {}),
    };
  }

  /** 前缀 skill id → SkillDescriptor；非前缀或未发布 → undefined。 */
  async getSkill(tenant: number, ref: string): Promise<SkillDescriptor | undefined> {
    if (parseTenantDescriptorId(ref)?.kind !== 'skill') return undefined;
    const view = await this.resolveView(tenant, ref);
    if (!view || view.kind !== 'skill') return undefined;
    const c = view.content as TenantSkillContent;
    const descriptor: Record<string, unknown> = {
      kind: 'skill',
      name: view.name,
      description: c.description,
      instructions: c.instructions,
      trigger: { type: 'semantic' },
      ...(c.version !== undefined ? { version: c.version } : {}),
      ...(c.displayName !== undefined ? { displayName: c.displayName } : {}),
      ...(c.tags !== undefined ? { tags: c.tags } : {}),
    };
    return descriptor as unknown as SkillDescriptor;
  }
}
