/**
 * DescriptorDocumentParser —— Descriptor Document（YAML frontmatter + markdown body）
 * 到结构化租户 descriptor content 的统一转换（ADR-0018 §5）。
 *
 * 纯函数、无 I/O：文件加载路径（descriptor-loader）与管理面 `:fromDocument`
 * HTTP 入口共用此 seam。frontmatter 中不在目标 schema 的字段（resources /
 * requires / deprecated 等）静默丢弃。
 */
import { parse as parseYaml } from "yaml";

import {
  ActivationSchema,
  TenantAgentContentSchema,
  TenantRuleContentSchema,
  TenantSkillContentSchema,
  type Activation,
  type TenantAgentContent,
  type TenantRuleContent,
  type TenantSkillContent,
} from "@cube-ai/contracts";

export interface DescriptorDocumentParts {
  /** frontmatter 解析出的对象（YAML） */
  record: Record<string, unknown>;
  /** frontmatter 之后的 markdown 正文（未 trim） */
  body: string;
}

/**
 * 提取 `--- … ---` YAML frontmatter 与 markdown body。
 * 缺 frontmatter 或 frontmatter 非对象时抛错。
 */
export function extractDescriptorDocumentParts(raw: string): DescriptorDocumentParts {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/u.exec(normalized);
  if (!match) throw new Error("descriptor document requires YAML frontmatter");
  const data = parseYaml(match[1] ?? "") as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("descriptor document frontmatter must be an object");
  }
  return { record: data as Record<string, unknown>, body: match[2] ?? "" };
}

function requireName(record: Record<string, unknown>): string {
  const name = typeof record["name"] === "string" ? record["name"].trim() : "";
  if (!name) throw new Error("descriptor document requires non-empty frontmatter name");
  return name;
}

/** 共有 meta 字段（displayName / tags / version），不在 schema 的字段由 zod strip。 */
function pickMeta(record: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(record["displayName"] !== undefined ? { displayName: record["displayName"] } : {}),
    ...(record["tags"] !== undefined ? { tags: record["tags"] } : {}),
    ...(record["version"] !== undefined ? { version: record["version"] } : {}),
  };
}

/**
 * SKILL.md frontmatter `activation` 归一化：接受字符串简写（`semantic` → `{ mode: "semantic" }`）
 * 或对象形（`{ mode, globs? }`）；无法识别时返回 undefined（读取侧回落 semantic）。
 * 不做合法性判定——交给 {@link ActivationSchema} fail-closed 校验。
 */
export function normalizeActivationInput(raw: unknown): unknown {
  if (typeof raw === "string" && raw.trim()) return { mode: raw.trim() };
  if (raw && typeof raw === "object" && "mode" in (raw as object)) return raw;
  return undefined;
}

/**
 * frontmatter/wire `activation` → tachu `Activation`（tachu rc.13 统一激活词汇，取代旧 `trigger`）。
 * 缺省回落 `{ mode: "semantic" }`；未知 mode / `path` 缺非空 `globs` **fail-closed** 抛错
 * （调用方 loader 跳过该文件、不静默降级）。供文件态（descriptor-loader）与租户态
 * （tenant-descriptor-resolver）共用，避免各自重写、保真度不一致（ADR-0016 addendum）。
 */
export function parseSkillActivation(raw: unknown, skillName: string): Activation {
  const normalized = normalizeActivationInput(raw);
  if (normalized === undefined) return { mode: "semantic" };
  const result = ActivationSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(`skill ${skillName} has invalid activation: ${result.error.issues.map((i) => i.message).join("; ")}`);
  }
  return result.data;
}

export function parseSkillDocument(raw: string): { name: string; content: TenantSkillContent } {
  const { record, body } = extractDescriptorDocumentParts(raw);
  const name = requireName(record);
  const activation = normalizeActivationInput(record["activation"]);
  const content = TenantSkillContentSchema.parse({
    ...pickMeta(record),
    description: record["description"],
    ...(activation !== undefined ? { activation } : {}),
    instructions: body.trim(),
  });
  return { name, content };
}

export function parseRuleDocument(raw: string): { name: string; content: TenantRuleContent } {
  const { record, body } = extractDescriptorDocumentParts(raw);
  const name = requireName(record);
  const content = TenantRuleContentSchema.parse({
    ...pickMeta(record),
    ...(record["description"] !== undefined ? { description: record["description"] } : {}),
    content: body.trim(),
  });
  return { name, content };
}

export function parseAgentDocument(raw: string): { name: string; content: TenantAgentContent } {
  const { record, body } = extractDescriptorDocumentParts(raw);
  const name = requireName(record);
  const content = TenantAgentContentSchema.parse({
    ...pickMeta(record),
    prompt: body.trim(),
    ...(record["modelConfig"] !== undefined ? { modelConfig: record["modelConfig"] } : {}),
    ...(record["ruleRefs"] !== undefined ? { ruleRefs: record["ruleRefs"] } : {}),
    ...(record["skillRefs"] !== undefined ? { skillRefs: record["skillRefs"] } : {}),
    ...(record["availableTools"] !== undefined ? { availableTools: record["availableTools"] } : {}),
    ...(record["subAgentRefs"] !== undefined ? { subAgentRefs: record["subAgentRefs"] } : {}),
    ...(record["maxDepth"] !== undefined ? { maxDepth: record["maxDepth"] } : {}),
  });
  return { name, content };
}
