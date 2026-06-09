import { BadRequestException, Inject, Injectable, NotFoundException } from '@dangao/bun-server'
import { APP_CONFIG_TOKEN, type AppConfig } from '../../../config/app.config'
import { DEFAULT_CHUNK_SEPARATOR } from '../../common/document-types'
import type {
  ChunkPreviewItem,
  ChunkPreviewResult,
  ChunkingOptions,
  DocumentChunkListItem,
  DocumentStatus,
  ImportJobStatus,
  IndexStatus,
  ParseStatus,
  TextChunkRecord,
} from '../../common/document-types'
import { ParserRegistryService } from '../../ingestion/services/parser-registry.service'
import { IngestionService } from '../../ingestion/services/ingestion.service'
import { ObjectStorageService } from '../../object-storage/services/object-storage.service'
import { VectorizationService } from '../../vector-store/services/vectorization.service'
import { QdrantVectorRepository } from '../../vector-store/infrastructure/qdrant/qdrant-vector.repository'
import { DocumentChunkRepositoryOrm } from '../../vector-store/infrastructure/qdrant/document-chunk.repository'
import { documentEntityToJson, type DocumentJson } from '../mappers/document-json.mapper'
import { DocumentEntity } from '../infrastructure/orm/document.entity'
import { DocumentRepositoryOrm } from '../infrastructure/orm/document.repository'
import { ImportJobRepositoryOrm } from '../../ingestion/infrastructure/orm/import-job.repository'
import type { ParsedPeriodRange } from './period-range'

export interface UploadDocumentResult {
  documentId: string
  importJobId: string
  status: DocumentStatus
  supportedForParsing: boolean
}

@Injectable()
export class DocumentService {
  public constructor(
    @Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly documentRepository: DocumentRepositoryOrm,
    private readonly importJobRepository: ImportJobRepositoryOrm,
    private readonly objectStorageService: ObjectStorageService,
    private readonly parserRegistryService: ParserRegistryService,
    private readonly ingestionService: IngestionService,
    private readonly qdrantVectorRepository: QdrantVectorRepository,
    private readonly documentChunkRepository: DocumentChunkRepositoryOrm,
    private readonly vectorizationService: VectorizationService,
  ) {}

  private parseHeadingPath(raw: string | string[] | undefined): string[] {
    if (Array.isArray(raw)) {
      return raw.filter((item): item is string => typeof item === 'string')
    }
    if (!raw) {
      return []
    }
    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  private toChunkPreviewItem(chunk: TextChunkRecord): ChunkPreviewItem {
    return {
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      headingPath: chunk.headingPath,
      sectionId: chunk.sectionId,
      pageNo: chunk.pageNo,
      chunkType: chunk.chunkType,
      orderInSection: chunk.orderInSection,
      charCount: chunk.text.length,
      recallCount: 0,
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
    }
  }

  private documentChunkListItemToPreviewItem(item: DocumentChunkListItem): ChunkPreviewItem {
    return {
      chunkId: item.chunkId,
      chunkIndex: item.chunkIndex,
      text: item.text,
      headingPath: item.headingPath,
      sectionId: item.sectionId,
      pageNo: item.pageNo,
      chunkType: item.chunkType,
      orderInSection: item.orderInSection,
      charCount: item.charCount,
      recallCount: item.recallCount,
      sheetName: item.sheetName ?? null,
      tableId: item.tableId ?? null,
      rowStart: item.rowStart ?? null,
      rowEnd: item.rowEnd ?? null,
      headers: item.headers,
      keywords: item.keywords,
      startTime: item.startTime ?? null,
      endTime: item.endTime ?? null,
      cueIndex: item.cueIndex ?? null,
      propertyNamespace: item.propertyNamespace ?? null,
    }
  }

  private toDocumentChunkListItem(row: Record<string, unknown>): DocumentChunkListItem {
    const text = String(row.text_content ?? '')
    const charFromRow = row.char_count
    const charCount =
      typeof charFromRow === 'number' && Number.isFinite(charFromRow)
        ? charFromRow
        : text.length
    const recallFromRow = row.recall_count
    const recallCount =
      typeof recallFromRow === 'number' && Number.isFinite(recallFromRow)
        ? recallFromRow
        : Number(recallFromRow ?? 0)
    return {
      chunkId: String(row.chunk_id ?? ''),
      chunkIndex: Number(row.chunk_index ?? 0),
      text,
      embeddingText: String(row.embedding_text ?? ''),
      sectionId: String(row.section_id ?? ''),
      headingPath: this.parseHeadingPath(row.heading_path as string | string[] | undefined),
      pageNo: typeof row.page_no === 'number' ? row.page_no : null,
      chunkType: String(row.chunk_type ?? 'paragraph') as DocumentChunkListItem['chunkType'],
      orderInSection: Number(row.order_in_section ?? 0),
      captionText: typeof row.caption_text === 'string' ? row.caption_text : null,
      pictureDescription: typeof row.picture_description === 'string' ? row.picture_description : null,
      charCount,
      recallCount,
      sheetName: typeof row.sheet_name === 'string' ? row.sheet_name : null,
      tableId: typeof row.table_id === 'string' ? row.table_id : null,
      rowStart: typeof row.row_start === 'number' ? row.row_start : null,
      rowEnd: typeof row.row_end === 'number' ? row.row_end : null,
      headers: this.parseHeadingPath(row.headers_text as string | string[] | undefined),
      keywords: this.parseHeadingPath(row.keywords_text as string | string[] | undefined),
      startTime: typeof row.start_time === 'string' ? row.start_time : null,
      endTime: typeof row.end_time === 'string' ? row.end_time : null,
      cueIndex: typeof row.cue_index === 'number' ? row.cue_index : null,
      propertyNamespace: typeof row.property_namespace === 'string' ? row.property_namespace : null,
    }
  }

  private mergeKeywordList(existing: string[], add?: string[], remove?: string[]): string[] {
    const removeSet = new Set(
      (remove ?? [])
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item !== ''),
    )
    const next = existing.filter((item) => !removeSet.has(item.trim()))
    const seen = new Set(next.map((item) => item))
    for (const raw of add ?? []) {
      if (typeof raw !== 'string') {
        continue
      }
      const keyword = raw.trim()
      if (keyword === '' || seen.has(keyword)) {
        continue
      }
      seen.add(keyword)
      next.push(keyword)
    }
    return next
  }

  private async buildUpdatedChunkRecord(
    document: Pick<DocumentEntity, 'id' | 'name' | 'mime_type' | 'project_id'>,
    chunkId: string,
    text: string,
    keywordMutations?: { keywordsAdd?: string[]; keywordsRemove?: string[] },
  ): Promise<TextChunkRecord> {
    const existing = await this.documentChunkRepository.findByDocumentIdAndChunkId(document.id, chunkId)
    if (!existing) {
      throw new NotFoundException(`chunk not found: ${chunkId}`)
    }
    const headingPath = this.parseHeadingPath(existing.heading_path)
    const previousKeywords = this.parseHeadingPath(existing.keywords_text ?? undefined)
    const hasKeywordMutation =
      keywordMutations !== undefined
      && (
        (keywordMutations.keywordsAdd?.length ?? 0) > 0
        || (keywordMutations.keywordsRemove?.length ?? 0) > 0
      )
    const keywords = hasKeywordMutation
      ? this.mergeKeywordList(
        previousKeywords,
        keywordMutations?.keywordsAdd,
        keywordMutations?.keywordsRemove,
      )
      : previousKeywords
    return {
      chunkId,
      documentId: document.id,
      chunkIndex: existing.chunk_index,
      text,
      embeddingText: headingPath.length > 0 ? `${headingPath.join('\n')}\n${text}` : text,
      tenantId: document.project_id,
      sourceType: document.mime_type,
      fileName: document.name,
      sectionId: existing.section_id,
      headingPath,
      pageNo: existing.page_no,
      chunkType: existing.chunk_type as TextChunkRecord['chunkType'],
      orderInSection: existing.order_in_section,
      captionText: existing.caption_text,
      pictureDescription: existing.picture_description,
      sheetName: existing.sheet_name,
      tableId: existing.table_id,
      rowStart: existing.row_start,
      rowEnd: existing.row_end,
      headers: this.parseHeadingPath(existing.headers_text ?? undefined),
      keywords,
      startTime: existing.start_time,
      endTime: existing.end_time,
      cueIndex: existing.cue_index,
      propertyNamespace: existing.property_namespace,
    }
  }

  private resolveChunkingOptions(overrides?: ChunkingOptions): Required<ChunkingOptions> {
    const config = this.config
    return {
      separator: overrides?.separator ?? DEFAULT_CHUNK_SEPARATOR,
      chunkSize: overrides?.chunkSize ?? config.ingestionChunkSize,
      chunkOverlap: overrides?.chunkOverlap ?? config.ingestionChunkOverlap,
      tableChunkMode: overrides?.tableChunkMode ?? 'auto',
      textChunkMode: overrides?.textChunkMode ?? 'auto',
    }
  }

  public async uploadDocument(file: File, directoryId: string, chunkingOptions?: ChunkingOptions): Promise<UploadDocumentResult> {
    if (!(file instanceof File)) {
      throw new BadRequestException('file is required')
    }

    const extension = this.getExtension(file.name)
    const supportedForParsing = this.parserRegistryService.isSupported(file.name, file.type)
    const resolvedChunkingOptions = this.resolveChunkingOptions(chunkingOptions)
    const objectKey = this.buildObjectKey(file.name)
    const documentStatus: DocumentStatus = supportedForParsing ? 'uploaded' : 'unsupported'
    const parseStatus: ParseStatus = supportedForParsing ? 'pending' : 'unsupported'
    const indexStatus: IndexStatus = supportedForParsing ? 'pending' : 'unsupported'
    const importJobStatus: ImportJobStatus = supportedForParsing ? 'pending' : 'unsupported'

    const putResult = await this.objectStorageService.putObject({
      objectKey,
      fileName: file.name,
      body: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || 'application/octet-stream',
    })

    const document = await this.documentRepository.createDocument({
      name: file.name,
      mime_type: file.type || 'application/octet-stream',
      extension,
      size: file.size,
      storage_bucket: putResult.storageBucket,
      storage_key: putResult.storageKey,
      directory_id: directoryId,
      status: documentStatus,
      parse_status: parseStatus,
      index_status: indexStatus,
      error_message: supportedForParsing ? null : '当前文件类型暂未实现解析',
      recall_count: 0,
      char_count: 0,
      chunk_separator: resolvedChunkingOptions.separator,
      chunk_size: resolvedChunkingOptions.chunkSize,
      chunk_overlap: resolvedChunkingOptions.chunkOverlap,
      table_chunk_mode: resolvedChunkingOptions.tableChunkMode,
      text_chunk_mode: resolvedChunkingOptions.textChunkMode,
    } as Partial<DocumentEntity>)

    const importJob = await this.importJobRepository.createJob({
      document_id: document.id,
      status: importJobStatus,
      error_message: supportedForParsing ? null : '当前文件类型暂未实现解析',
      chunk_count: 0,
    })

    if (!supportedForParsing) {
      return {
        documentId: document.id,
        importJobId: importJob.id,
        status: 'unsupported',
        supportedForParsing,
      }
    }

    const ingestionResult = await this.ingestionService.ingestDocument({
      document,
      file,
      chunkingOptions: resolvedChunkingOptions,
    })

    await this.documentRepository.update(document.id, {
      status: ingestionResult.documentStatus,
      parse_status: ingestionResult.parseStatus,
      index_status: ingestionResult.indexStatus,
      error_message: ingestionResult.errorMessage,
      char_count: ingestionResult.totalCharCount,
      chunk_separator: resolvedChunkingOptions.separator,
      chunk_size: resolvedChunkingOptions.chunkSize,
      chunk_overlap: resolvedChunkingOptions.chunkOverlap,
      table_chunk_mode: resolvedChunkingOptions.tableChunkMode,
      text_chunk_mode: resolvedChunkingOptions.textChunkMode,
    })
    await this.importJobRepository.update(importJob.id, {
      status: ingestionResult.importJobStatus,
      error_message: ingestionResult.errorMessage,
      chunk_count: ingestionResult.chunkCount,
    })

    return {
      documentId: document.id,
      importJobId: importJob.id,
      status: ingestionResult.documentStatus,
      supportedForParsing,
    }
  }

  public async listDocuments(): Promise<DocumentJson[]> {
    const rows = await this.documentRepository.findAll()
    return rows.map(documentEntityToJson)
  }

  public async searchDocumentsByDirectory(params: {
    directoryId: string
    pageNumber: number
    pageSize: number
    keyword: string | null
    period?: ParsedPeriodRange
  }): Promise<{ items: DocumentJson[]; total: number; pages: number }> {
    const result = await this.documentRepository.searchByDirectoryId({
      directoryId: params.directoryId,
      pageNumber: params.pageNumber,
      pageSize: params.pageSize,
      keyword: params.keyword,
      period: params.period,
    })
    return {
      items: result.items.map(documentEntityToJson),
      total: result.total,
      pages: result.pages,
    }
  }

  public async previewDocumentChunks(file: File, chunkingOptions?: ChunkingOptions): Promise<ChunkPreviewResult> {
    const chunks = await this.ingestionService.previewDocumentChunks({
      document: {
        id: '0',
        name: file.name,
        mime_type: file.type || 'application/octet-stream',
        project_id: null,
      },
      file,
      chunkingOptions: this.resolveChunkingOptions(chunkingOptions),
    })
    return {
      items: chunks.map((chunk) => this.toChunkPreviewItem(chunk)),
      chunkCount: chunks.length,
    }
  }

  public async previewDocumentChunksById(documentId: string): Promise<ChunkPreviewResult> {
    const document = await this.documentRepository.findById(documentId)
    if (!document) {
      throw new NotFoundException(`document not found: ${documentId}`)
    }
    const rows = await this.documentChunkRepository.findByDocumentId(documentId)
    const items = rows.map((row) =>
      this.documentChunkListItemToPreviewItem(
        this.toDocumentChunkListItem(row as unknown as Record<string, unknown>),
      ),
    )
    return {
      items,
      chunkCount: items.length,
    }
  }

  public async listDocumentChunks(documentId: string): Promise<{ items: DocumentChunkListItem[] }> {
    const document = await this.documentRepository.findById(documentId)
    if (!document) {
      throw new NotFoundException(`document not found: ${documentId}`)
    }
    const rows = await this.documentChunkRepository.findByDocumentId(documentId)
    return {
      items: rows.map((row) => this.toDocumentChunkListItem(row as unknown as Record<string, unknown>)),
    }
  }

  public async updateDocumentChunk(
    documentId: string,
    chunkId: string,
    text: string,
    keywordMutations?: { keywordsAdd?: string[]; keywordsRemove?: string[] },
  ): Promise<DocumentChunkListItem> {
    if (text.trim() === '') {
      throw new BadRequestException('text is required')
    }
    const document = await this.documentRepository.findById(documentId)
    if (!document) {
      throw new NotFoundException(`document not found: ${documentId}`)
    }
    const chunk = await this.buildUpdatedChunkRecord(document, chunkId, text, keywordMutations)
    await this.vectorizationService.indexDocumentChunk(chunk)
    const updated = await this.documentChunkRepository.findByDocumentIdAndChunkId(documentId, chunkId)
    if (!updated) {
      throw new NotFoundException(`chunk not found after update: ${chunkId}`)
    }
    return this.toDocumentChunkListItem(updated as unknown as Record<string, unknown>)
  }

  public async deleteDocument(documentId: string): Promise<void> {
    const document = await this.documentRepository.findById(documentId)
    if (!document) {
      throw new NotFoundException(`document not found: ${documentId}`)
    }

    await this.objectStorageService.deleteObject({
      bucket: document.storage_bucket,
      objectKey: document.storage_key,
    })
    await this.qdrantVectorRepository.deleteByDocument(documentId)
    await this.documentRepository.logicalDelete(documentId)
  }

  public async reindexDocument(documentId: string, chunkingOptions?: ChunkingOptions): Promise<UploadDocumentResult> {
    const document = await this.documentRepository.findById(documentId)
    if (!document) {
      throw new NotFoundException(`document not found: ${documentId}`)
    }

    const resolvedChunkingOptions = this.resolveChunkingOptions(chunkingOptions)
    const bytes = await this.objectStorageService.getObject({
      bucket: document.storage_bucket,
      objectKey: document.storage_key,
    })
    const file = new File([bytes], document.name, { type: document.mime_type })

    const importJob = await this.importJobRepository.createJob({
      document_id: document.id,
      status: 'processing',
      error_message: null,
      chunk_count: 0,
    })

    const ingestionResult = await this.ingestionService.ingestDocument({
      document,
      file,
      chunkingOptions: resolvedChunkingOptions,
    })
    await this.documentRepository.update(document.id, {
      status: ingestionResult.documentStatus,
      parse_status: ingestionResult.parseStatus,
      index_status: ingestionResult.indexStatus,
      error_message: ingestionResult.errorMessage,
      char_count: ingestionResult.totalCharCount,
      chunk_separator: resolvedChunkingOptions.separator,
      chunk_size: resolvedChunkingOptions.chunkSize,
      chunk_overlap: resolvedChunkingOptions.chunkOverlap,
      table_chunk_mode: resolvedChunkingOptions.tableChunkMode,
      text_chunk_mode: resolvedChunkingOptions.textChunkMode,
    })
    await this.importJobRepository.update(importJob.id, {
      status: ingestionResult.importJobStatus,
      error_message: ingestionResult.errorMessage,
      chunk_count: ingestionResult.chunkCount,
    })

    return {
      documentId: document.id,
      importJobId: importJob.id,
      status: ingestionResult.documentStatus,
      supportedForParsing: this.parserRegistryService.isSupported(document.name, document.mime_type),
    }
  }

  private getExtension(filename: string): string {
    const segments = filename.toLowerCase().split('.')
    return segments.length > 1 ? (segments.pop() ?? '') : ''
  }

  private buildObjectKey(filename: string): string {
    return `${Date.now()}-${crypto.randomUUID()}-${filename}`
  }
}
