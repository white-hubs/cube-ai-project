import { Injectable } from "@dangao/bun-server";

import { VersionedRegistry } from "./versioned-registry";

/**
 * 规则激活轴（activation axis）——只回答「规则正文**何时**进入本轮上下文」，
 * 不表达 block/annotate/validate（那些属 guard/hook）。词汇对齐 tachu rc.11
 * `RuleActivation` 与业界 rule 系统（Cursor / Copilot / Continue / Cline）。
 *
 * 本仓**自持**该类型：规则管线不经 tachu 的 `RuleDescriptor` / `PromptAssembler`
 * （见 ADR-0032 分层规则组装），与 tachu 词汇保持一致仅为将来可平滑对接。
 *
 * - `always`：静态/全局规则，冻结进会话 system prompt（≈ Cursor alwaysApply）。
 * - `manual`：仅当本轮被显式点名（prompt `@rule` ∪ 调用方 `explicitRuleNames`）时，
 *   经 **User Message** 注入（≈ `@rule`）。
 * - `semantic`：由调用方按 `description` 判定相关后经**工具回调**按需拉取（本轮 staged，尚未接线）。
 * - `path`：命中 `globs` 的文件出现在本轮上下文时注入；本仓 chat 场景暂无 per-turn
 *   文件上下文，故**已声明但运行时始终 inert**（loader 仍校验 `globs` 非空）。
 */
export type RuleActivation = { mode: "always" } | { mode: "manual" } | { mode: "semantic" } | { mode: "path"; globs: readonly string[] };

/**
 * 系统级 rule descriptor（`descriptors/rules/*.yaml`，kind: rule）。
 * 租户级 rule（`rul_` 前缀）走 tenant-descriptor 持久层（ADR-0016），不进本注册表。
 */
export interface RuleDescriptor {
  kind: "rule";
  name: string;
  /** 规则正文；按 {@link activation} 决定进 system prompt 还是经 User Message 注入。 */
  content: string;
  /** 激活轴；缺省视为 `{ mode: 'always' }`（rc.11 §1.1），读取统一走 {@link resolveRuleActivation}。 */
  activation?: RuleActivation;
  version?: string;
  description?: string;
  displayName?: string;
  tags?: string[];
}

/** 读取规则激活轴，缺省回落 `{ mode: 'always' }`（单一收口点，避免各处散落默认逻辑）。 */
export function resolveRuleActivation(rule: Pick<RuleDescriptor, "activation">): RuleActivation {
  return rule.activation ?? { mode: "always" };
}

@Injectable()
export class RuleRegistryService {
  private readonly registry = new VersionedRegistry<RuleDescriptor>({
    itemName: (r) => r.name,
    itemVersion: (r) => r.version,
    defaultVersion: "0.0.0",
    duplicateError: (key) => new Error(`Duplicate rule descriptor: ${key}`),
    nonMonotonicError: (name, version, prev) => new Error(`Rule ${name}: version ${version} is not monotonically greater than ${prev}`),
  });

  register(rule: RuleDescriptor): void {
    this.registry.register(rule);
  }

  replaceAllFromSnapshot(rules: RuleDescriptor[]): void {
    this.registry.replaceAllFromSnapshot(rules);
  }

  resolve(name: string, version?: string): RuleDescriptor | undefined {
    return this.registry.resolve(name, version);
  }

  list(): RuleDescriptor[] {
    return this.registry.latest();
  }

  size(): number {
    return this.registry.size();
  }

  clear(): void {
    this.registry.clear();
  }
}
