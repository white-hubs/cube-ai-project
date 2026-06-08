import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'

/** 与 api-all / Langflow 导出对齐的换行与行尾空白规范化（黄金比对用）。 */
export function normalizeLfCode(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .trim()
}

/**
 * 从 api-all 索引中提取 `lfComponentKey` → `template.code.value`。
 * 无 `code` 槽的组件不会出现在 Map 中。
 */
export function extractLfTemplateCodeGoldens(apiAllPath: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!existsSync(apiAllPath)) return map
  const root = JSON.parse(readFileSync(apiAllPath, 'utf-8')) as Record<string, unknown>
  for (const [_category, group] of Object.entries(root)) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue
    for (const [name, def] of Object.entries(group as Record<string, unknown>)) {
      if (!def || typeof def !== 'object') continue
      const template = (def as Record<string, unknown>)['template']
      if (!template || typeof template !== 'object') continue
      const codeSlot = (template as Record<string, unknown>)['code']
      if (!codeSlot || typeof codeSlot !== 'object' || !('value' in codeSlot)) continue
      const v = (codeSlot as { value: unknown }).value
      if (typeof v === 'string' && v.length > 0) {
        map.set(name, v)
      }
    }
  }
  return map
}
