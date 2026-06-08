import { Injectable } from '@dangao/bun-server'
import { DEFAULT_CHUNK_SEPARATOR } from '../../common/document-types'
import type { ChunkDocumentInput, ChunkingOptions, TextChunkMode, TextChunkRecord } from '../../common/document-types'

export interface OverlapTextChunkerOptions {
  chunkSize: number
  chunkOverlap: number
}

const MIN_CHUNK_SIZE = 1
const LINE_SEPARATOR = '\n'
const URL_PATTERN = /https?:\/\/\S+|www\.\S+/giu
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const MARKDOWN_HEADING_PATTERN = /^#{1,6}\s+\S/u
const MARKDOWN_LIST_PATTERN = /^(?:[-*+]|\d+\.)\s+\S/u

function preprocessText(text: string): string {
  return text
    .replace(/\r\n?/g, LINE_SEPARATOR)
    .replace(URL_PATTERN, ' ')
    .replace(EMAIL_PATTERN, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, LINE_SEPARATOR)
    .replace(/\n{3,}/g, DEFAULT_CHUNK_SEPARATOR)
    .trim()
}

function splitBySeparator(text: string, separator: string): string[] {
  return text
    .split(separator)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function decodeSeparator(separator: string | undefined): string {
  if (typeof separator !== 'string' || separator.trim() === '') {
    return DEFAULT_CHUNK_SEPARATOR
  }

  return separator
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
}

function resolveTextChunkMode(chunkingOptions?: ChunkingOptions): TextChunkMode {
  return chunkingOptions?.textChunkMode ?? 'auto'
}

function sliceWithOverlap(text: string, chunkSize: number, chunkOverlap: number): string[] {
  const step = Math.max(chunkSize - chunkOverlap, MIN_CHUNK_SIZE)
  const chunks: string[] = []

  for (let start = 0; start < text.length; start += step) {
    const chunk = text.slice(start, start + chunkSize).trim()
    if (!chunk) {
      continue
    }
    chunks.push(chunk)
    if (start + chunkSize >= text.length) {
      break
    }
  }

  return chunks
}

function isHeadingParagraph(paragraph: string): boolean {
  return MARKDOWN_HEADING_PATTERN.test(paragraph)
}

function isListParagraph(paragraph: string): boolean {
  return MARKDOWN_LIST_PATTERN.test(paragraph)
}

function shouldUseBlockMode(paragraphs: string[]): boolean {
  if (paragraphs.length < 2) {
    return false
  }

  const headingCount = paragraphs.filter((paragraph) => isHeadingParagraph(paragraph)).length
  const listCount = paragraphs.filter((paragraph) => isListParagraph(paragraph)).length

  return headingCount >= 2 || listCount >= 2
}

function splitOversizedParagraph(paragraph: string, chunkSize: number, chunkOverlap: number): string[] {
  const lines = splitBySeparator(paragraph, LINE_SEPARATOR)
  if (lines.length <= 1) {
    return sliceWithOverlap(paragraph, chunkSize, chunkOverlap)
  }

  const chunks: string[] = []
  let current = ''
  for (const line of lines) {
    if (line.length > chunkSize) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      chunks.push(...sliceWithOverlap(line, chunkSize, chunkOverlap))
      continue
    }

    const candidate = current ? `${current}${LINE_SEPARATOR}${line}` : line
    if (candidate.length <= chunkSize) {
      current = candidate
      continue
    }

    if (current) {
      chunks.push(current)
    }
    current = line
  }

  if (current) {
    chunks.push(current)
  }

  return chunks
}

function splitByBlockMode(paragraphs: string[], separator: string, chunkSize: number, chunkOverlap: number): string[] {
  const blocks: string[] = []
  let currentBlock = ''
  let currentBlockType: 'heading' | 'plain' | null = null

  for (const paragraph of paragraphs) {
    if (isHeadingParagraph(paragraph)) {
      if (currentBlock) {
        blocks.push(currentBlock)
      }
      currentBlock = paragraph
      currentBlockType = 'heading'
      continue
    }

    if (currentBlockType === 'heading') {
      currentBlock = `${currentBlock}${separator}${paragraph}`
      continue
    }

    if (isListParagraph(paragraph)) {
      if (currentBlock) {
        blocks.push(currentBlock)
        currentBlock = ''
        currentBlockType = null
      }
      blocks.push(paragraph)
      continue
    }

    if (currentBlock) {
      blocks.push(currentBlock)
    }
    currentBlock = paragraph
    currentBlockType = 'plain'
  }

  if (currentBlock) {
    blocks.push(currentBlock)
  }

  return blocks.flatMap((block) => {
    if (block.length <= chunkSize) {
      return [block]
    }
    return splitOversizedParagraph(block, chunkSize, chunkOverlap)
  })
}

@Injectable()
export class OverlapTextChunker {
  public constructor(private readonly options: OverlapTextChunkerOptions) {}

  public splitText(text: string, chunkingOptions?: ChunkingOptions): string[] {
    const normalizedText = preprocessText(text)
    if (!normalizedText) {
      return []
    }

    const separator = decodeSeparator(chunkingOptions?.separator)
    const chunkSize = Math.max(chunkingOptions?.chunkSize ?? this.options.chunkSize, MIN_CHUNK_SIZE)
    const requestedChunkOverlap = chunkingOptions?.chunkOverlap ?? this.options.chunkOverlap
    const chunkOverlap = Math.max(0, Math.min(requestedChunkOverlap, chunkSize - MIN_CHUNK_SIZE))
    const paragraphs = splitBySeparator(normalizedText, separator)
    const textChunkMode = resolveTextChunkMode(chunkingOptions)

    if (textChunkMode === 'block' || (textChunkMode === 'auto' && shouldUseBlockMode(paragraphs))) {
      return splitByBlockMode(paragraphs, separator, chunkSize, chunkOverlap)
    }

    const chunkTexts: string[] = []
    let current = ''

    for (const paragraph of paragraphs) {
      if (paragraph.length > chunkSize) {
        if (current) {
          chunkTexts.push(current)
          current = ''
        }
        chunkTexts.push(...splitOversizedParagraph(paragraph, chunkSize, chunkOverlap))
        continue
      }

      const candidate = current ? `${current}${separator}${paragraph}` : paragraph
      if (candidate.length <= chunkSize) {
        current = candidate
        continue
      }

      if (current) {
        chunkTexts.push(current)
      }
      current = paragraph
    }

    if (current) {
      chunkTexts.push(current)
    }

    return chunkTexts
  }

  public async chunkDocument(input: ChunkDocumentInput): Promise<TextChunkRecord[]> {
    const chunkTexts = this.splitText(input.text, input.chunkingOptions)

    return chunkTexts.map((text, chunkIndex) => ({
      chunkId: `${input.documentId}-${chunkIndex}`,
      documentId: input.documentId,
      chunkIndex,
      text,
      embeddingText: text,
      projectId: input.projectId,
      sourceType: input.sourceType,
      fileName: input.fileName,
      sectionId: 'document-root',
      headingPath: [],
      pageNo: null,
      chunkType: 'text',
      orderInSection: chunkIndex,
      captionText: null,
      pictureDescription: null,
    }))
  }
}
