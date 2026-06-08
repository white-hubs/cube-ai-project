const MARKDOWN_TOKENS = /(^|\s)([#>*_`\-[\]()!]+)/g
const HTML_TAGS = /<[^>]+>/g
const MULTIPLE_SPACES = /\s+/g
const LINE_SEPARATOR = '\n'
const PARAGRAPH_SEPARATOR = '\n\n'

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

export function normalizePlainText(input: string): string {
  return input.replace(MULTIPLE_SPACES, ' ').trim()
}

function normalizePlainTextPreservingParagraphs(input: string): string {
  return input
    .replace(/\r\n?/g, LINE_SEPARATOR)
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, LINE_SEPARATOR)
    .replace(/\n{3,}/g, PARAGRAPH_SEPARATOR)
    .trim()
}

export function splitSdkStyleInstructionBlocks(input: string): string[] {
  const normalized = normalizePlainTextPreservingParagraphs(input).replace(/\n+/g, ' ').trim()
  if (!normalized.includes('{') || !normalized.includes('}')) {
    return []
  }

  const blocks: string[] = []
  let current = ''
  let depth = 0
  let sawBrace = false

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]
    current += character

    if (character === '{') {
      depth += 1
      sawBrace = true
      continue
    }

    if (character !== '}' || depth === 0) {
      continue
    }

    depth -= 1
    if (depth !== 0) {
      continue
    }

    const block = current.trim()
    if (sawBrace && block.length > 0) {
      blocks.push(block)
      current = ''
      sawBrace = false
    }

    while (normalized[index + 1] === ' ') {
      index += 1
    }
  }

  if (depth !== 0 || blocks.length === 0) {
    return []
  }

  const trailing = current.trim()
  if (trailing.length > 0) {
    blocks.push(trailing)
  }

  return blocks
}

export function convertPlainTextToMarkdownForIngestion(input: string): string {
  const normalized = normalizePlainTextPreservingParagraphs(input)
  if (!normalized) {
    return ''
  }

  const sdkInstructionBlocks = splitSdkStyleInstructionBlocks(normalized)
  if (sdkInstructionBlocks.length >= 2) {
    return sdkInstructionBlocks.map((block, index) => `### 指令 ${index + 1}\n\n${block}`).join(PARAGRAPH_SEPARATOR)
  }

  if (normalized.includes(PARAGRAPH_SEPARATOR)) {
    return normalized
  }

  const lines = normalized
    .split(LINE_SEPARATOR)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length <= 1) {
    return normalized
  }

  return lines.map((line) => `- ${line}`).join(PARAGRAPH_SEPARATOR)
}

export function stripMarkdown(input: string): string {
  const withoutTokens = input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(MARKDOWN_TOKENS, ' ')

  return normalizePlainText(withoutTokens)
}

export function stripHtml(input: string): string {
  const withoutScripts = input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(HTML_TAGS, ' ')

  let text = withoutScripts
  for (const [entity, value] of Object.entries(HTML_ENTITIES)) {
    text = text.replaceAll(entity, value)
  }

  return normalizePlainText(text)
}

export function extractPdfText(buffer: Uint8Array): string {
  const binary = Buffer.from(buffer).toString('latin1')
  const matches = binary.match(/\((?:\\.|[^()])+\)/g) ?? []
  const extracted = matches
    .map((value) => {
      const trimmed = value.slice(1, -1)
      return trimmed
        .replace(/\\n/g, ' ')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\\/g, '\\')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
    })
    .join(' ')

  return normalizePlainText(extracted)
}
