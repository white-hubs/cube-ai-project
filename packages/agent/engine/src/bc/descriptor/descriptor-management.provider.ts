/**
 * DescriptorManagementService 的 DI 工厂（管理 ops 工具集「核」的**唯一**装配点）。
 *
 * 三处共用同一 factory + 候选源（ADR-0027 §8，不重复实现）：
 *   - HTTP 管理面（`descriptor-management-http.module`）
 *   - MCP 门面（`descriptor-mcp.module`）
 *   - 进程内 Tool Handler（`tools.module` 的 `DescriptorOpsHandler`）
 *
 * 复用 engine 同一 MySQL pool（`MYSQL_POOL_TOKEN`）、辅助 LLM（`AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN`，
 * 缺省可降级）与系统级候选 ref 来源（registries）。住 descriptor BC，避免 descriptor→tools 反向依赖。
 *
 * 无 MySQL 时仍可构造（repository 延迟到方法调用才校验 pool），不阻塞无库 dev 启动。
 */
import { type Container } from "@dangao/bun-server";
import type { Pool } from "mysql2/promise";

import { OUTBOX_WRITER_TOKEN, type OutboxWriter } from "@cube-ai/bun-server-ext-outbox";
import type { LlmProviderPort } from "@cube-ai/contracts";
import { isEngineInternalAgentRef, isEngineInternalSkillRef } from "@cube-ai/contracts";
import { AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN } from "@cube-ai/contracts/platform";

import { MYSQL_POOL_TOKEN } from "../../infra/mysql/mysql.tokens";
import { buildOutboxWriter } from "../../infra/outbox/outbox-factory";
import { sharedSfidService } from "../../infra/sfid/shared-sfid";
import { DescriptorManagementService, type ProposeCandidate, type ProposeCandidateSource } from "./descriptor-management.service";
import { DescriptorRegistryService } from "./descriptor-registry.service";
import { RuleRegistryService } from "./rule-registry.service";
import { ShelfService } from "./shelf.service";
import { SkillRegistryService } from "./skill-registry.service";
import { TenantDescriptorRepositoryImpl } from "./tenant-descriptor.repository";

function tryResolve<T>(c: Container, token: unknown): T | undefined {
  try {
    return c.resolve(token as never) as T;
  } catch {
    return undefined;
  }
}

/**
 * 系统级候选 ref 来源（ADR-0027 §6）：经现有 registry 投影为 name + description。
 * registry 未装配时各方法返回空数组（无候选 = 不接地，propose 仍可降级运行）。
 */
function buildCandidateSource(c: Container): ProposeCandidateSource {
  const skills = tryResolve<SkillRegistryService>(c, SkillRegistryService);
  const rules = tryResolve<RuleRegistryService>(c, RuleRegistryService);
  const tools = tryResolve<DescriptorRegistryService>(c, DescriptorRegistryService);
  return {
    systemSkills: (): ProposeCandidate[] =>
      (skills?.list() ?? [])
        .filter((s) => !isEngineInternalSkillRef(s.name))
        .map((s) => ({
          kind: "skill",
          ref: s.name,
          ...(s.description ? { description: s.description } : {}),
        })),
    systemRules: (): ProposeCandidate[] =>
      (rules?.list() ?? []).map((r) => ({
        kind: "rule",
        ref: r.name,
        ...(r.description ? { description: r.description } : {}),
      })),
    systemTools: (): ProposeCandidate[] =>
      (tools?.listAll() ?? []).map((t) => ({
        kind: "tool",
        ref: t.name,
        ...(t.description ? { description: t.description } : {}),
      })),
  };
}

export function buildDescriptorManagementService(c: Container): DescriptorManagementService {
  let pool: Pool | null = null;
  try {
    pool = c.resolve(MYSQL_POOL_TOKEN) as Pool | null;
  } catch {
    pool = null;
  }
  const repo = new TenantDescriptorRepositoryImpl(pool, sharedSfidService);
  const llm = tryResolve<LlmProviderPort>(c, AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN);
  const shelf = tryResolve<ShelfService>(c, ShelfService);
  const outbox = buildOutboxWriter(pool) ?? tryResolve<OutboxWriter>(c, OUTBOX_WRITER_TOKEN);
  return new DescriptorManagementService(repo, llm, buildCandidateSource(c), shelf, outbox);
}

/** Provider 对象：三处装配共享，使「核」可被 DI 解析为 {@link DescriptorManagementService}。 */
export const descriptorManagementServiceProvider = {
  provide: DescriptorManagementService,
  useFactory: (c: Container) => buildDescriptorManagementService(c),
};
