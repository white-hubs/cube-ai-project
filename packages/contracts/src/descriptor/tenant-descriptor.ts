import { z } from "zod";

/**
 * 租户级 descriptor 的 wire schema 与 id 前缀命名空间。
 *
 * ADR-0016：租户资产 id = 类型前缀 + SFID（`agt_` / `skl_` / `rul_`），服务端生成；
 * 裸 name（无前缀）永远指系统级资产。
 * ADR-0018：三种 kind 的 content schema 对称扩展 displayName / tags / version。
 */
export const TENANT_DESCRIPTOR_ID_PREFIXES = {
  agent: "agt_",
  rule: "rul_",
  skill: "skl_",
} as const;

export type TenantDescriptorKind = keyof typeof TENANT_DESCRIPTOR_ID_PREFIXES;

const PREFIX_TO_KIND: ReadonlyMap<string, TenantDescriptorKind> = new Map(
  (Object.entries(TENANT_DESCRIPTOR_ID_PREFIXES) as [TenantDescriptorKind, string][]).map(([kind, prefix]) => [prefix, kind]),
);

/**
 * `'agt_123' -> { kind: 'agent', sfid: '123' }`；裸 name / 未知前缀 / 空 sfid 返回 null（= 系统级）。
 */
export function parseTenantDescriptorId(ref: string): { kind: TenantDescriptorKind; sfid: string } | null {
  const underscore = ref.indexOf("_");
  if (underscore === -1) {
    return null;
  }
  const prefix = ref.slice(0, underscore + 1);
  const kind = PREFIX_TO_KIND.get(prefix);
  if (!kind) {
    return null;
  }
  const sfid = ref.slice(underscore + 1);
  if (!sfid) {
    return null;
  }
  return { kind, sfid };
}

/**
 * 租户级 descriptor 的 **name** = 租户内唯一 key（ADR-0016 §"name 仅在租户内唯一"）。
 * 与另外两个「像身份」的概念严格区分（ADR-0033）：
 *   - `name`        身份 key：顶层、不可变、slug-safe；upsert 主键；不参与运行时解析、不进版本内容。
 *   - `displayName` 人类标签：住 content 内、被版本化、可含中文等任意字符、可重复。
 *   - `id`（agt_…） 运行时身份：server 生成的前缀 SFID。
 * name 必填且 fail-closed 限定小写 kebab —— displayName 可能是中文/含特殊符号，故 name 不可从其派生。
 */
export const DESCRIPTOR_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DescriptorNameSchema = z
  .string()
  .trim()
  .regex(
    DESCRIPTOR_NAME_PATTERN,
    "descriptor name must be lower kebab-case matching ^[a-z0-9]+(?:-[a-z0-9]+)*$ (no leading/trailing/double hyphen)",
  );
export type DescriptorName = z.infer<typeof DescriptorNameSchema>;

/** 三种 kind 共有的可选展示/检索字段（对齐 Descriptor Document frontmatter，ADR-0018 §6） */
const TenantDescriptorMetaSchema = z.object({
  displayName: z.string().optional(),
  tags: z.array(z.string()).optional(),
  /** 内容语义版本，独立于 DB head_version_no */
  version: z.string().optional(),
});

/**
 * 激活轴 wire schema（tachu rc.13：四类描述符统一 `activation` 词汇，删除旧 `trigger`）。
 * 与 `@tachu/core` `Activation` 判别联合同形：`always` / `manual` / `semantic` / `path`。
 * fail-closed：未知 `mode` 或 `path` 缺非空 `globs` 直接 parse 失败（ADR-0016 addendum）。
 */
export const ActivationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("always") }),
  z.object({ mode: z.literal("manual") }),
  z.object({ mode: z.literal("semantic") }),
  z.object({ mode: z.literal("path"), globs: z.array(z.string().min(1)).min(1) }),
]);
export type Activation = z.infer<typeof ActivationSchema>;

/**
 * 接地预取（grounding prefetch）声明项：agent 声明「tool-loop 开始前，主机替它预跑一次
 * 发现/检索类工具，把结果注入本轮上下文」。领域知识（调哪个工具、如何取参）只住此声明，
 * 通用运行时代码不硬编码任何具体 MCP 工具名（见 CONTEXT.md「接地预取」）。
 */
export const GroundingPrefetchEntrySchema = z.object({
  /** 预跑的工具名（运行时镜像/registry 中的名字，如 `mcp.<server>.read_ontology`）。 */
  tool: z.string().min(1),
  /** 传给该工具的静态参数（如 `{ connection: "", entity: "_index" }`）。 */
  args: z.record(z.string(), z.unknown()).optional(),
  /** 为 true 时把本轮用户 prompt 作为 `query` 注入工具入参（与 args 合并）。 */
  queryFromPrompt: z.boolean().optional(),
  /** queryFromPrompt 时的召回条数。 */
  topK: z.number().int().positive().optional(),
});
export type GroundingPrefetchEntry = z.infer<typeof GroundingPrefetchEntrySchema>;

export const TenantAgentContentSchema = TenantDescriptorMetaSchema.extend({
  availableTools: z.array(z.string()).default([]),
  maxDepth: z.number().int().positive().optional(),
  modelConfig: z
    .object({
      provider: z.string().optional(),
      model: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
    })
    .optional(),
  prompt: z.string().min(1),
  ruleRefs: z.array(z.string()).default([]),
  skillRefs: z.array(z.string()).default([]),
  subAgentRefs: z.array(z.string()).default([]),
  /** 可选：接地预取声明（ADR-0031，CONTEXT.md「接地预取」）。 */
  groundingPrefetch: z.array(GroundingPrefetchEntrySchema).optional(),
});
export type TenantAgentContent = z.infer<typeof TenantAgentContentSchema>;

export const TenantSkillContentSchema = TenantDescriptorMetaSchema.extend({
  description: z.string().min(1),
  /** markdown 文本 */
  instructions: z.string().min(1),
  /** 激活轴（对齐 SKILL.md frontmatter `activation`；tachu rc.13 统一 activation，取代旧 `trigger`）。缺省读取侧回落 semantic。 */
  activation: ActivationSchema.optional(),
});
export type TenantSkillContent = z.infer<typeof TenantSkillContentSchema>;

export const TenantRuleContentSchema = TenantDescriptorMetaSchema.extend({
  /** 注入 system prompt 的规则文本 */
  content: z.string().min(1),
  /** 人类可读说明 */
  description: z.string().optional(),
});
export type TenantRuleContent = z.infer<typeof TenantRuleContentSchema>;

export const TenantDescriptorStatusSchema = z.enum(["draft", "published"]);
export type TenantDescriptorStatus = z.infer<typeof TenantDescriptorStatusSchema>;

/**
 * 结构化创建请求信封（ADR-0033）——三面（HTTP 结构化 create / MCP ops create / propose 产出）唯一真源。
 *   - `name`    顶层身份 key（{@link DescriptorNameSchema}，slug-safe、必填、不可变）。
 *   - `content` 被版本化的 kind 内容（含 displayName 等元数据）；kind 来自路径/工具入参，故此处 `unknown`、由服务端按 kind 二次校验。
 * 与 update（只传 content、name 不可改）对称：name 只在 create 出现，二者共享同一 content 子结构。
 */
export const TenantDescriptorCreateRequestSchema = z.object({
  name: DescriptorNameSchema,
  content: z.unknown(),
});
export type TenantDescriptorCreateRequest = z.infer<typeof TenantDescriptorCreateRequestSchema>;

/**
 * `:fromDocument` upsert 响应（ADR-0018 §4）。结果恒为 draft，需显式 publish 才生效。
 */
export const FromDocumentResultSchema = z.object({
  /** 不存在 → created；已存在 → updated（新草稿版本） */
  action: z.enum(["created", "updated"]),
  headVersionNo: z.number().int(),
  /** 带前缀完整 id（agt_/skl_/rul_） */
  id: z.string(),
  name: z.string(),
  status: z.literal("draft"),
});
export type FromDocumentResult = z.infer<typeof FromDocumentResultSchema>;

/**
 * `propose` 纯建议创作（ADR-0027 ①）。同步无写副作用：
 *   - `intent`（NL 意图）→ 生成模式；`base`（现有 kind content）+ `focus` → 优化模式。
 *   - `modelCode` 可选覆盖辅助「创作模型」（缺省走 env，ADR-0027 §10）。
 */
export const ProposeRequestSchema = z.object({
  /** existing kind content → optimize mode */
  base: z.unknown().optional(),
  /** optional instruction to focus the change */
  focus: z.string().optional(),
  /** NL intent → generate mode */
  intent: z.string().optional(),
  /** optional model override */
  modelCode: z.string().optional(),
});
export type ProposeRequest = z.infer<typeof ProposeRequestSchema>;

/** 单条 ref 推荐（供 diff/确认 UI 渲染「可选 ref 卡片 + 理由」，ADR-0027 §4）。 */
export const ProposeSuggestionSchema = z.object({
  confidence: z.number().min(0).max(1).optional(),
  kind: z.enum(["skill", "rule", "tool", "agent"]),
  rationale: z.string(),
  ref: z.string(),
});
export type ProposeSuggestion = z.infer<typeof ProposeSuggestionSchema>;

/**
 * `propose` 输出结构化信封（ADR-0027 §4）。`content` 为 kind 形态、refs 已 inline，
 * 可直接喂 create/update；`valid:false` 时附 `issues`（调用方/UI 决策，服务端不抛）。
 */
export const ProposeResultSchema = z.object({
  /**
   * slug-safe 建议 name（ADR-0033）。propose 产出即带 name（displayName 可能含中文、不可作 name），
   * 使输出 `{ name, content }` 与 {@link TenantDescriptorCreateRequestSchema} 同形、可直接喂 create。
   */
  name: DescriptorNameSchema,
  /** kind-shaped content, refs already inlined, ready to feed create/update */
  content: z.unknown(),
  issues: z.array(z.string()).optional(),
  suggestions: z.array(ProposeSuggestionSchema),
  valid: z.boolean(),
});
export type ProposeResult = z.infer<typeof ProposeResultSchema>;

export const TenantDescriptorViewSchema = z.object({
  /** head 版本内容（按 kind 再 parse） */
  content: z.unknown(),
  createTime: z.number(),
  hasUnpublishedChanges: z.boolean(),
  headVersionNo: z.number().int(),
  /** 带前缀完整 id */
  id: z.string(),
  kind: z.enum(["agent", "skill", "rule"]),
  name: z.string(),
  ownerUserId: z.string().nullable(),
  publishedVersionNo: z.number().int().nullable(),
  status: TenantDescriptorStatusSchema,
  updateTime: z.number(),
});
export type TenantDescriptorView = z.infer<typeof TenantDescriptorViewSchema>;

/** 已发布版本历史条目；列表默认不带 content，详情/预览时可带。 */
export const DescriptorVersionSchema = z.object({
  content: z.unknown().optional(),
  createBy: z.string(),
  createTime: z.number(),
  versionNo: z.number().int(),
});
export type DescriptorVersion = z.infer<typeof DescriptorVersionSchema>;
