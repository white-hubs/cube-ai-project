/**
 * DescriptorDocumentParser —— Descriptor Document（YAML frontmatter + markdown body）
 * 到结构化租户 descriptor content 的统一转换（ADR-0018 §5）。
 *
 * 纯函数、无 I/O：文件加载路径（descriptor-loader）与管理面 `:fromDocument`
 * HTTP 入口共用此 seam。frontmatter 中不在目标 schema 的字段（resources /
 * requires / deprecated 等）静默丢弃。
 */
import { parse as parseYaml } from 'yaml';
import {
  TenantAgentContentSchema,
  TenantRuleContentSchema,
  TenantSkillContentSchema,
  type TenantAgentContent,
  type TenantRuleContent,
  type TenantSkillContent,
} from '@cube-ai/contracts';

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
  const normalized = raw.replace(/\r\n/g, '\n');
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/u.exec(normalized);
  if (!match) throw new Error('descriptor document requires YAML frontmatter');
  const data = parseYaml(match[1] ?? '') as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('descriptor document frontmatter must be an object');
  }
  return { record: data as Record<string, unknown>, body: match[2] ?? '' };
}

function requireName(record: Record<string, unknown>): string {
  const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
  if (!name) throw new Error('descriptor document requires non-empty frontmatter name');
  return name;
}

/** 共有 meta 字段（displayName / tags / version），不在 schema 的字段由 zod strip。 */
function pickMeta(record: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(record['displayName'] !== undefined ? { displayName: record['displayName'] } : {}),
    ...(record['tags'] !== undefined ? { tags: record['tags'] } : {}),
    ...(record['version'] !== undefined ? { version: record['version'] } : {}),
  };
}

/** SKILL.md 的 trigger 既可能是字符串也可能是 `{ type }` 对象；统一为字符串。 */
function normalizeTriggerString(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw && typeof raw === 'object') {
    const type = (raw as { type?: unknown }).type;
    if (typeof type === 'string' && type.trim()) return type.trim();
  }
  return undefined;
}

export function parseSkillDocument(raw: string): { name: string; content: TenantSkillContent } {
  const { record, body } = extractDescriptorDocumentParts(raw);
  const name = requireName(record);
  const trigger = normalizeTriggerString(record['trigger']);
  const content = TenantSkillContentSchema.parse({
    ...pickMeta(record),
    description: record['description'],
    ...(trigger !== undefined ? { trigger } : {}),
    instructions: body.trim(),
  });
  return { name, content };
}

export function parseRuleDocument(raw: string): { name: string; content: TenantRuleContent } {
  const { record, body } = extractDescriptorDocumentParts(raw);
  const name = requireName(record);
  const content = TenantRuleContentSchema.parse({
    ...pickMeta(record),
    ...(record['description'] !== undefined ? { description: record['description'] } : {}),
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
    ...(record['modelConfig'] !== undefined ? { modelConfig: record['modelConfig'] } : {}),
    ...(record['ruleRefs'] !== undefined ? { ruleRefs: record['ruleRefs'] } : {}),
    ...(record['skillRefs'] !== undefined ? { skillRefs: record['skillRefs'] } : {}),
    ...(record['availableTools'] !== undefined
      ? { availableTools: record['availableTools'] }
      : {}),
    ...(record['subAgentRefs'] !== undefined ? { subAgentRefs: record['subAgentRefs'] } : {}),
    ...(record['maxDepth'] !== undefined ? { maxDepth: record['maxDepth'] } : {}),
  });
  return { name, content };
}
