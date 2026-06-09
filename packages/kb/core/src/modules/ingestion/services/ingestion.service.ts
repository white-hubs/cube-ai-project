import { Injectable } from '@dangao/bun-server'
import type { ChunkingOptions, ParsedDocumentChunk, ParsedDocumentContent, TextChunkRecord } from '../../common/document-types'
import type { DocumentEntity } from '../../documents/infrastructure/orm/document.entity'
import { OverlapTextChunker } from '../chunkers/overlap-text.chunker'
import { ParserRegistryService } from './parser-registry.service'
import { VectorizationService } from '../../vector-store/services/vectorization.service'
import type { ImportJobStatus, IndexStatus, ParseStatus } from '../../common/document-types'
import { normalizeEmbeddingText } from './embedding-text-normalizer'
import { resolveChunkRetrievalProfile } from '../../vector-store/infrastructure/embeddings/retrieval-profile'

export interface IngestDocumentParams {
  document: Pick<DocumentEntity, 'id' | 'name' | 'mime_type' | 'project_id'>
  file: File
  chunkingOptions?: ChunkingOptions
}

export interface IngestionResult {
  importJobStatus: ImportJobStatus
  documentStatus: 'indexed' | 'failed'
  parseStatus: ParseStatus
  indexStatus: IndexStatus
  errorMessage: string | null
  chunkCount: number
  /** 各分段正文 text 长度之和（与入库分段一致） */
  totalCharCount: number
}

@Injectable()
export class IngestionService {
  public constructor(
    private readonly parserRegistryService: ParserRegistryService,
    private readonly overlapTextChunker: OverlapTextChunker,
    private readonly vectorizationService: VectorizationService,
  ) {}

  private hasUsableStructuredChunks(parsed: ParsedDocumentContent): boolean {
    return (parsed.chunks ?? []).some(
      (chunk) => chunk.displayText.trim() !== '' || chunk.embeddingText.trim() !== '',
    )
  }

  private mapParsedChunks(
    parsed: ParsedDocumentContent,
    document: Pick<DocumentEntity, 'id' | 'name' | 'mime_type' | 'project_id'>,
  ): TextChunkRecord[] {
    return (parsed.chunks ?? []).map((chunk) => ({
      chunkId: `${document.id}-${chunk.chunkIndex}`,
      documentId: document.id,
      chunkIndex: chunk.chunkIndex,
      text: chunk.displayText,
      embeddingText: normalizeEmbeddingText({
        chunkType: chunk.chunkType,
        sourceType: parsed.sourceType,
        displayText: chunk.displayText,
        embeddingText: chunk.embeddingText,
        headingPath: chunk.headingPath,
      }),
      tenantId: document.project_id,
      sourceType: parsed.sourceType,
      fileName: document.name,
      sectionId: chunk.sectionId,
      headingPath: chunk.headingPath,
      pageNo: chunk.pageNo,
      chunkType: chunk.chunkType,
      orderInSection: chunk.orderInSection,
      captionText: chunk.captionText,
      pictureDescription: chunk.pictureDescription,
      sheetName: chunk.sheetName ?? null,
      tableId: chunk.tableId ?? null,
      rowStart: chunk.rowStart ?? null,
      rowEnd: chunk.rowEnd ?? null,
      headers: chunk.headers,
      keywords: chunk.keywords,
      startTime: chunk.startTime ?? null,
      endTime: chunk.endTime ?? null,
      cueIndex: chunk.cueIndex ?? null,
      propertyNamespace: chunk.propertyNamespace ?? null,
      retrievalProfile: resolveChunkRetrievalProfile({
        chunkType: chunk.chunkType,
        sourceType: parsed.sourceType,
        headingPath: chunk.headingPath,
        text: chunk.displayText,
      }),
    }))
  }

  private shouldSkipRuntimeRechunk(chunk: ParsedDocumentChunk): boolean {
    return chunk.chunkType === 'table-row-window'
      || chunk.chunkType === 'vtt-cue-window'
      || chunk.chunkType === 'properties-group'
  }

  private rechunkParsedChunks(
    chunks: ParsedDocumentChunk[],
    chunkingOptions: ChunkingOptions,
    document: Pick<DocumentEntity, 'id' | 'name' | 'mime_type' | 'project_id'>,
    sourceType: string,
  ): TextChunkRecord[] {
    const sectionOrderMap = new Map<string, number>()
    let chunkIndex = 0

    return chunks.flatMap((chunk) => {
      const splitDisplayTexts = this.shouldSkipRuntimeRechunk(chunk)
        ? [chunk.displayText]
        : this.overlapTextChunker.splitText(chunk.displayText, chunkingOptions)
      const displayTexts = splitDisplayTexts.length > 0 ? splitDisplayTexts : [chunk.displayText]
      return displayTexts.map((displayText) => {
        const orderInSection = sectionOrderMap.get(chunk.sectionId) ?? 0
        sectionOrderMap.set(chunk.sectionId, orderInSection + 1)
        const embeddingText = normalizeEmbeddingText({
          chunkType: chunk.chunkType,
          sourceType,
          displayText,
          embeddingText: this.shouldSkipRuntimeRechunk(chunk)
            ? chunk.embeddingText
            : chunk.headingPath.length > 0 ? `${chunk.headingPath.join('\n')}\n${displayText}` : displayText,
          headingPath: chunk.headingPath,
        })
        const retrievalProfile = resolveChunkRetrievalProfile({
          chunkType: chunk.chunkType,
          sourceType,
          headingPath: chunk.headingPath,
          text: displayText,
        })
        const record: TextChunkRecord = {
          chunkId: `${document.id}-${chunkIndex}`,
          documentId: document.id,
          chunkIndex,
          text: displayText,
          embeddingText,
          tenantId: document.project_id,
          sourceType,
          fileName: document.name,
          sectionId: chunk.sectionId,
          headingPath: chunk.headingPath,
          pageNo: chunk.pageNo,
          chunkType: chunk.chunkType,
          orderInSection,
          captionText: chunk.captionText,
          pictureDescription: chunk.pictureDescription,
          sheetName: chunk.sheetName ?? null,
          tableId: chunk.tableId ?? null,
          rowStart: chunk.rowStart ?? null,
          rowEnd: chunk.rowEnd ?? null,
          headers: chunk.headers,
          keywords: chunk.keywords,
          startTime: chunk.startTime ?? null,
          endTime: chunk.endTime ?? null,
          cueIndex: chunk.cueIndex ?? null,
          propertyNamespace: chunk.propertyNamespace ?? null,
          retrievalProfile,
        }
        chunkIndex += 1
        return record
      })
    })
  }

  private async buildDocumentChunks(params: IngestDocumentParams): Promise<TextChunkRecord[]> {
    const parser = this.parserRegistryService.getParser(params.document.name, params.document.mime_type)
    let parsed: ParsedDocumentContent
    const fallbackParser = this.parserRegistryService.getFallbackParser(params.document.name, params.document.mime_type)
    try {
      parsed = await parser.parse({
        file: params.file,
        filename: params.document.name,
        mimeType: params.document.mime_type,
        chunkingOptions: params.chunkingOptions,
      })
    } catch (error) {
      if (!fallbackParser) {
        throw error
      }
      parsed = await fallbackParser.parse({
        file: params.file,
        filename: params.document.name,
        mimeType: params.document.mime_type,
        chunkingOptions: params.chunkingOptions,
      })
    }
    if (parsed.chunks && !this.hasUsableStructuredChunks(parsed) && fallbackParser) {
      parsed = await fallbackParser.parse({
        file: params.file,
        filename: params.document.name,
        mimeType: params.document.mime_type,
        chunkingOptions: params.chunkingOptions,
      })
    }

    return parsed.chunks && parsed.chunks.length > 0
      ? (params.chunkingOptions
          ? this.rechunkParsedChunks(parsed.chunks, params.chunkingOptions, params.document, parsed.sourceType)
          : this.mapParsedChunks(parsed, params.document))
      : (await this.overlapTextChunker.chunkDocument({
          documentId: params.document.id,
          text: parsed.text,
          sourceType: parsed.sourceType,
          fileName: params.document.name,
          tenantId: params.document.project_id,
          chunkingOptions: params.chunkingOptions,
        })).map((chunk) => ({
          ...chunk,
          embeddingText: normalizeEmbeddingText({
            chunkType: chunk.chunkType,
            sourceType: parsed.sourceType,
            displayText: chunk.text,
            embeddingText: chunk.text,
            headingPath: chunk.headingPath,
          }),
          retrievalProfile: resolveChunkRetrievalProfile({
            chunkType: chunk.chunkType,
            sourceType: parsed.sourceType,
            headingPath: chunk.headingPath,
            text: chunk.text,
          }),
        }))
  }

  public async previewDocumentChunks(params: IngestDocumentParams): Promise<TextChunkRecord[]> {
    return this.buildDocumentChunks(params)
  }

  public async ingestDocument(params: IngestDocumentParams): Promise<IngestionResult> {
    try {
      const chunks = await this.buildDocumentChunks(params)
      await this.vectorizationService.indexDocumentChunks(params.document.id, chunks)
      const totalCharCount = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
      return {
        importJobStatus: 'completed',
        documentStatus: 'indexed',
        parseStatus: 'success',
        indexStatus: 'success',
        errorMessage: null,
        chunkCount: chunks.length,
        totalCharCount,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        importJobStatus: 'failed',
        documentStatus: 'failed',
        parseStatus: 'failed',
        indexStatus: 'failed',
        errorMessage: message,
        chunkCount: 0,
        totalCharCount: 0,
      }
    }
  }
}
