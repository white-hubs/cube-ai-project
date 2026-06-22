import { z } from 'zod';

/**
 * 租户级 descriptor 的 wire schema 与 id 前缀命名空间。
 *
 * ADR-0016：租户资产 id = 类型前缀 + SFID（`agt_` / `skl_` / `rul_`），服务端生成；
 * 裸 name（无前缀）永远指系统级资产。
 * ADR-0018：三种 kind 的 content schema 对称扩展 displayName / tags / version。
 */
export const TENANT_DESCRIPTOR_ID_PREFIXES = {
  agent: 'agt_',
  skill: 'skl_',
  rule: 'rul_',
} as const;

export type TenantDescriptorKind = keyof typeof TENANT_DESCRIPTOR_ID_PREFIXES;

const PREFIX_TO_KIND: ReadonlyMap<string, TenantDescriptorKind> = new Map(
  (Object.entries(TENANT_DESCRIPTOR_ID_PREFIXES) as [TenantDescriptorKind, string][]).map(
    ([kind, prefix]) => [prefix, kind],
  ),
);

/**
 * `'agt_123' -> { kind: 'agent', sfid: '123' }`；裸 name / 未知前缀 / 空 sfid 返回 null（= 系统级）。
 */
export function parseTenantDescriptorId(
  ref: string,
): { kind: TenantDescriptorKind; sfid: string } | null {
  const underscore = ref.indexOf('_');
  if (underscore < 0) return null;
  const prefix = ref.slice(0, underscore + 1);
  const kind = PREFIX_TO_KIND.get(prefix);
  if (!kind) return null;
  const sfid = ref.slice(underscore + 1);
  if (!sfid) return null;
  return { kind, sfid };
}

/** 三种 kind 共有的可选展示/检索字段（对齐 Descriptor Document frontmatter，ADR-0018 §6） */
const TenantDescriptorMetaSchema = z.object({
  displayName: z.string().optional(),
  tags: z.array(z.string()).optional(),
  /** 内容语义版本，独立于 DB head_version_no */
  version: z.string().optional(),
});

export const TenantAgentContentSchema = TenantDescriptorMetaSchema.extend({
  prompt: z.string().min(1),
  modelConfig: z
    .object({
      provider: z.string().optional(),
      model: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
    })
    .optional(),
  ruleRefs: z.array(z.string()).default([]),
  skillRefs: z.array(z.string()).default([]),
  availableTools: z.array(z.string()).default([]),
  subAgentRefs: z.array(z.string()).default([]),
  maxDepth: z.number().int().positive().optional(),
});
export type TenantAgentContent = z.infer<typeof TenantAgentContentSchema>;

export const TenantSkillContentSchema = TenantDescriptorMetaSchema.extend({
  description: z.string().min(1),
  /** 对齐 SKILL.md frontmatter trigger 字段 */
  trigger: z.string().optional(),
  /** markdown 文本 */
  instructions: z.string().min(1),
});
export type TenantSkillContent = z.infer<typeof TenantSkillContentSchema>;

export const TenantRuleContentSchema = TenantDescriptorMetaSchema.extend({
  /** 人类可读说明 */
  description: z.string().optional(),
  /** 注入 system prompt 的规则文本 */
  content: z.string().min(1),
});
export type TenantRuleContent = z.infer<typeof TenantRuleContentSchema>;

export const TenantDescriptorStatusSchema = z.enum(['draft', 'published']);
export type TenantDescriptorStatus = z.infer<typeof TenantDescriptorStatusSchema>;

/**
 * `:fromDocument` upsert 响应（ADR-0018 §4）。结果恒为 draft，需显式 publish 才生效。
 */
export const FromDocumentResultSchema = z.object({
  /** 带前缀完整 id（agt_/skl_/rul_） */
  id: z.string(),
  name: z.string(),
  /** 不存在 → created；已存在 → updated（新草稿版本） */
  action: z.enum(['created', 'updated']),
  headVersionNo: z.number().int(),
  status: z.literal('draft'),
});
export type FromDocumentResult = z.infer<typeof FromDocumentResultSchema>;

/**
 * `propose` 纯建议创作（ADR-0027 ①）。同步无写副作用：
 *   - `intent`（NL 意图）→ 生成模式；`base`（现有 kind content）+ `focus` → 优化模式。
 *   - `modelCode` 可选覆盖辅助「创作模型」（缺省走 env，ADR-0027 §10）。
 */
export const ProposeRequestSchema = z.object({
  /** NL intent → generate mode */
  intent: z.string().optional(),
  /** existing kind content → optimize mode */
  base: z.unknown().optional(),
  /** optional instruction to focus the change */
  focus: z.string().optional(),
  /** optional model override */
  modelCode: z.string().optional(),
});
export type ProposeRequest = z.infer<typeof ProposeRequestSchema>;

/** 单条 ref 推荐（供 diff/确认 UI 渲染「可选 ref 卡片 + 理由」，ADR-0027 §4）。 */
export const ProposeSuggestionSchema = z.object({
  kind: z.enum(['skill', 'rule', 'tool', 'agent']),
  ref: z.string(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});
export type ProposeSuggestion = z.infer<typeof ProposeSuggestionSchema>;

/**
 * `propose` 输出结构化信封（ADR-0027 §4）。`content` 为 kind 形态、refs 已 inline，
 * 可直接喂 create/update；`valid:false` 时附 `issues`（调用方/UI 决策，服务端不抛）。
 */
export const ProposeResultSchema = z.object({
  /** kind-shaped content, refs already inlined, ready to feed create/update */
  content: z.unknown(),
  suggestions: z.array(ProposeSuggestionSchema),
  valid: z.boolean(),
  issues: z.array(z.string()).optional(),
});
export type ProposeResult = z.infer<typeof ProposeResultSchema>;

export const TenantDescriptorViewSchema = z.object({
  /** 带前缀完整 id */
  id: z.string(),
  kind: z.enum(['agent', 'skill', 'rule']),
  name: z.string(),
  ownerUserId: z.string().nullable(),
  status: TenantDescriptorStatusSchema,
  headVersionNo: z.number().int(),
  publishedVersionNo: z.number().int().nullable(),
  hasUnpublishedChanges: z.boolean(),
  /** head 版本内容（按 kind 再 parse） */
  content: z.unknown(),
  createTime: z.number(),
  updateTime: z.number(),
});
export type TenantDescriptorView = z.infer<typeof TenantDescriptorViewSchema>;

/** 已发布版本历史条目；列表默认不带 content，详情/预览时可带。 */
export const DescriptorVersionSchema = z.object({
  versionNo: z.number().int(),
  createBy: z.string(),
  createTime: z.number(),
  content: z.unknown().optional(),
});
export type DescriptorVersion = z.infer<typeof DescriptorVersionSchema>;
