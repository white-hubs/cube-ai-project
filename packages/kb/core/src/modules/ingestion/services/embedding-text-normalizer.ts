import type { ChunkType, RetrievalProfile } from '../../common/document-types'
import { resolveChunkRetrievalProfile } from '../../vector-store/infrastructure/embeddings/retrieval-profile'

export interface NormalizeEmbeddingTextInput {
  chunkType: ChunkType
  sourceType: string
  displayText: string
  embeddingText: string
  headingPath: string[]
}

function joinNonEmptyLines(lines: string[]): string {
  return lines.map((line) => line.trim()).filter((line) => line !== '').join('\n')
}

function buildSemanticQaEmbeddingText(input: NormalizeEmbeddingTextInput): string {
  return joinNonEmptyLines([
    input.headingPath.length > 0 ? `标题路径: ${input.headingPath.join(' > ')}` : '',
    `正文: ${input.displayText}`,
  ])
}

function buildNavigationEmbeddingText(input: NormalizeEmbeddingTextInput): string {
  const sectionTitle = input.headingPath.at(-1) ?? input.displayText
  return joinNonEmptyLines([
    input.headingPath.length > 0 ? `标题路径: ${input.headingPath.join(' > ')}` : '',
    `章节: ${sectionTitle}`,
    `导航内容: ${input.displayText}`,
  ])
}

function normalizeNonSpecialEmbeddingText(input: NormalizeEmbeddingTextInput, retrievalProfile: RetrievalProfile): string {
  if (retrievalProfile === 'navigation') {
    return buildNavigationEmbeddingText(input)
  }
  return buildSemanticQaEmbeddingText(input)
}

export function normalizeEmbeddingText(input: NormalizeEmbeddingTextInput): string {
  const retrievalProfile = resolveChunkRetrievalProfile({
    chunkType: input.chunkType,
    sourceType: input.sourceType,
    headingPath: input.headingPath,
    text: input.displayText,
  })

  if (input.chunkType === 'table-row-window' || input.chunkType === 'vtt-cue-window' || input.chunkType === 'properties-group') {
    return input.embeddingText.trim()
  }

  return normalizeNonSpecialEmbeddingText(input, retrievalProfile)
}

