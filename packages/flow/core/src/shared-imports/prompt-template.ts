/**
 * Prompt 模板 `{var}` 变量名解析（与 Python string.Formatter 约定一致：`{{` 不展开）。
 */
export function extractPromptPlaceholderNames(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const re = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g
  let m: RegExpExecArray | null
  const s = text ?? ''
  while ((m = re.exec(s)) !== null) {
    if (m.index > 0 && s[m.index - 1] === '{') continue
    const inner = m[1]!
    if (seen.has(inner)) continue
    seen.add(inner)
    out.push(inner)
  }
  return out
}

/**
 * 从 Cube `config` 读取 Prompt 正文（与 `templateToConfig` / 异常嵌套形态兼容）。
 */
export function promptTemplateBodyFromConfig(config: Record<string, unknown>, slotName: string): string {
  const v = config[slotName]
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o['value'] === 'string') return o['value']
    const nested = o['template']
    if (nested && typeof nested === 'object' && nested !== null && 'value' in nested) {
      const nv = (nested as { value: unknown }).value
      if (typeof nv === 'string') return nv
    }
  }
  if (v != null && typeof v !== 'object') return String(v)
  return ''
}

export function resolvePromptTemplateVariableNames(
  customFields: Record<string, unknown> | undefined,
  config: Record<string, unknown>,
  promptSlotName: string,
): string[] {
  const body = promptTemplateBodyFromConfig(config, promptSlotName)
  const fromText = extractPromptPlaceholderNames(body)
  // 与 LF process_prompt_template 一致：正文能解析出变量时以正文为准（避免 custom_fields 为 [] 或与正文脱节）
  if (fromText.length > 0) return fromText

  const fromCf = customFields?.[promptSlotName]
  if (
    Array.isArray(fromCf) &&
    fromCf.length > 0 &&
    fromCf.every((x) => typeof x === 'string')
  ) {
    return fromCf as string[]
  }
  return []
}

export function findPromptInputSlotName(
  inputs: readonly { name: string; inputType: string; fieldType: string }[],
): string {
  const p = inputs.find((f) => f.inputType === 'PromptInput' || f.fieldType === 'prompt')
  return p?.name ?? 'template'
}
