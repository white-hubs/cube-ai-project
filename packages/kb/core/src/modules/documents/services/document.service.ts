import { BadRequestException, DATABASE_SERVICE_TOKEN, Inject, Injectable, NotFoundException } from "@dangao/bun-server";

import { APP_CONFIG_TOKEN, type AppConfig } from "../../../config/app.config";
import { type KbTransactionRunner } from "../../../infrastructure/orm/kb-mysql-database.service";
import {
  DOCUMENT_PLATFORM_SYNC_PORT_TOKEN,
  type DocumentPlatformSyncPort,
  type PlatformDocumentSyncContext,
} from "../../../port/document-platform-sync.port";
import { documentMetadataFromEntity } from "../../common/document-metadata";
import {
  type ChunkPreviewItem,
  type ChunkPreviewResult,
  type ChunkingOptions,
  DEFAULT_CHUNK_SEPARATOR,
  type DocumentChunkDetail,
  type DocumentChunkListItem,
  type DocumentStatus,
  type ImportJobStatus,
  type IndexStatus,
  type ParseStatus,
  type TextChunkRecord,
} from "../../common/document-types";
import { ImportJobRepositoryOrm } from "../../ingestion/infrastructure/orm/import-job.repository";
import { INGEST_SCHEDULER_TOKEN, type IngestScheduler } from "../../ingestion/services/ingest-scheduler";
import { IngestionService } from "../../ingestion/services/ingestion.service";
import { ParserRegistryService } from "../../ingestion/services/parser-registry.service";
import { ObjectStorageService } from "../../object-storage/services/object-storage.service";
import { DocumentChunkRepositoryOrm } from "../../vector-store/infrastructure/qdrant/document-chunk.repository";
import { QdrantVectorRepository } from "../../vector-store/infrastructure/qdrant/qdrant-vector.repository";
import { documentChunkEntityToRecord } from "../../vector-store/services/chunk-entity-mapper";
import { VectorReconcileService } from "../../vector-store/services/vector-reconcile.service";
import { VectorizationService } from "../../vector-store/services/vectorization.service";
import { type DocumentEntity } from "../infrastructure/orm/document.entity";
import { DocumentRepositoryOrm } from "../infrastructure/orm/document.repository";
import { type DocumentJson, documentEntityToJson } from "../mappers/document-json.mapper";
import { type ParsedPeriodRange } from "./period-range";

export interface UploadDocumentResult {
  documentId: string;
  importJobId: string;
  status: DocumentStatus;
  supportedForParsing: boolean;
}

export interface ReindexDocumentOptions {
  /** W3.5 / W3.3-compatible: force full wipe + re-embed. */
  forceFull?: boolean;
}

/** W4.1 document metadata + ACL (written on create / patch; denormalized at ingest). */
export interface DocumentMetadataInput {
  docType?: string | null;
  lang?: string | null;
  tags?: string[] | null;
  aclGroupIds?: string[] | null;
  metadata?: Record<string, unknown> | null;
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
    private readonly vectorReconcileService: VectorReconcileService,
    @Inject(DOCUMENT_PLATFORM_SYNC_PORT_TOKEN)
    private readonly documentPlatformSync: DocumentPlatformSyncPort,
    @Inject(INGEST_SCHEDULER_TOKEN) private readonly ingestScheduler: IngestScheduler,
    @Inject(DATABASE_SERVICE_TOKEN) private readonly transactionRunner: KbTransactionRunner,
  ) {}

  private parseHeadingPath(raw: string | string[] | undefined): string[] {
    if (Array.isArray(raw)) {
      return raw.filter((item): item is string => typeof item === "string");
    }
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  private toChunkPreviewItem(chunk: TextChunkRecord): ChunkPreviewItem {
    return {
      charCount: chunk.text.length,
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
      chunkType: chunk.chunkType,
      cueIndex: chunk.cueIndex ?? null,
      endTime: chunk.endTime ?? null,
      headers: chunk.headers,
      headingPath: chunk.headingPath,
      keywords: chunk.keywords,
      orderInSection: chunk.orderInSection,
      pageNo: chunk.pageNo,
      propertyNamespace: chunk.propertyNamespace ?? null,
      recallCount: 0,
      rowEnd: chunk.rowEnd ?? null,
      rowStart: chunk.rowStart ?? null,
      sectionId: chunk.sectionId,
      sheetName: chunk.sheetName ?? null,
      startTime: chunk.startTime ?? null,
      tableId: chunk.tableId ?? null,
      text: chunk.text,
    };
  }

  private documentChunkListItemToPreviewItem(item: DocumentChunkListItem): ChunkPreviewItem {
    return {
      charCount: item.charCount,
      chunkId: item.chunkId,
      chunkIndex: item.chunkIndex,
      chunkType: item.chunkType,
      cueIndex: item.cueIndex ?? null,
      endTime: item.endTime ?? null,
      headers: item.headers,
      headingPath: item.headingPath,
      keywords: item.keywords,
      orderInSection: item.orderInSection,
      pageNo: item.pageNo,
      propertyNamespace: item.propertyNamespace ?? null,
      recallCount: item.recallCount,
      rowEnd: item.rowEnd ?? null,
      rowStart: item.rowStart ?? null,
      sectionId: item.sectionId,
      sheetName: item.sheetName ?? null,
      startTime: item.startTime ?? null,
      tableId: item.tableId ?? null,
      text: item.text,
    };
  }

  private toDocumentChunkListItem(row: Record<string, unknown>): DocumentChunkListItem {
    const text = String(row.text_content ?? "");
    const charFromRow = row.char_count;
    const charCount = typeof charFromRow === "number" && Number.isFinite(charFromRow) ? charFromRow : text.length;
    const recallFromRow = row.recall_count;
    const recallCount = typeof recallFromRow === "number" && Number.isFinite(recallFromRow) ? recallFromRow : Number(recallFromRow ?? 0);
    return {
      captionText: typeof row.caption_text === "string" ? row.caption_text : null,
      charCount,
      chunkId: String(row.chunk_id ?? ""),
      chunkIndex: Number(row.chunk_index ?? 0),
      chunkType: String(row.chunk_type ?? "paragraph") as DocumentChunkListItem["chunkType"],
      cueIndex: typeof row.cue_index === "number" ? row.cue_index : null,
      embeddingText: String(row.embedding_text ?? ""),
      endTime: typeof row.end_time === "string" ? row.end_time : null,
      headers: this.parseHeadingPath(row.headers_text as string | string[] | undefined),
      headingPath: this.parseHeadingPath(row.heading_path as string | string[] | undefined),
      keywords: this.parseHeadingPath(row.keywords_text as string | string[] | undefined),
      orderInSection: Number(row.order_in_section ?? 0),
      pageNo: typeof row.page_no === "number" ? row.page_no : null,
      pictureDescription: typeof row.picture_description === "string" ? row.picture_description : null,
      propertyNamespace: typeof row.property_namespace === "string" ? row.property_namespace : null,
      recallCount,
      rowEnd: typeof row.row_end === "number" ? row.row_end : null,
      rowStart: typeof row.row_start === "number" ? row.row_start : null,
      sectionId: String(row.section_id ?? ""),
      sheetName: typeof row.sheet_name === "string" ? row.sheet_name : null,
      startTime: typeof row.start_time === "string" ? row.start_time : null,
      tableId: typeof row.table_id === "string" ? row.table_id : null,
      text,
    };
  }

  private toDocumentChunkDetail(row: Record<string, unknown>): DocumentChunkDetail {
    const { embeddingText: _embeddingText, ...display } = this.toDocumentChunkListItem(row);
    return {
      ...display,
      docType: typeof row.doc_type === "string" ? row.doc_type : null,
      documentId: String(row.document_id ?? ""),
      fileName: String(row.file_name ?? ""),
      lang: typeof row.lang === "string" ? row.lang : null,
      sourceType: String(row.source_type ?? ""),
      tags: this.parseHeadingPath(row.tags_json as string | string[] | undefined),
    };
  }

  private mergeKeywordList(existing: string[], add?: string[], remove?: string[]): string[] {
    const removeSet = new Set((remove ?? []).map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item !== ""));
    const next = existing.filter((item) => !removeSet.has(item.trim()));
    const seen = new Set(next.map((item) => item));
    for (const raw of add ?? []) {
      if (typeof raw !== "string") {
        continue;
      }
      const keyword = raw.trim();
      if (keyword === "" || seen.has(keyword)) {
        continue;
      }
      seen.add(keyword);
      next.push(keyword);
    }
    return next;
  }

  private async buildUpdatedChunkRecord(
    document: Pick<DocumentEntity, "id" | "name" | "mime_type" | "tenant_id">,
    chunkId: string,
    text: string,
    keywordMutations?: { keywordsAdd?: string[]; keywordsRemove?: string[] },
  ): Promise<TextChunkRecord> {
    const existing = await this.documentChunkRepository.findByDocumentIdAndChunkId(document.id, chunkId);
    if (!existing) {
      throw new NotFoundException(`chunk not found: ${chunkId}`);
    }
    const headingPath = this.parseHeadingPath(existing.heading_path);
    const previousKeywords = this.parseHeadingPath(existing.keywords_text ?? undefined);
    const hasKeywordMutation =
      keywordMutations !== undefined &&
      ((keywordMutations.keywordsAdd?.length ?? 0) > 0 || (keywordMutations.keywordsRemove?.length ?? 0) > 0);
    const keywords = hasKeywordMutation
      ? this.mergeKeywordList(previousKeywords, keywordMutations?.keywordsAdd, keywordMutations?.keywordsRemove)
      : previousKeywords;
    return {
      captionText: existing.caption_text,
      chunkId,
      chunkIndex: existing.chunk_index,
      chunkType: existing.chunk_type as TextChunkRecord["chunkType"],
      cueIndex: existing.cue_index,
      documentId: document.id,
      embeddingText: headingPath.length > 0 ? `${headingPath.join("\n")}\n${text}` : text,
      endTime: existing.end_time,
      fileName: document.name,
      headers: this.parseHeadingPath(existing.headers_text ?? undefined),
      headingPath,
      keywords,
      orderInSection: existing.order_in_section,
      pageNo: existing.page_no,
      pictureDescription: existing.picture_description,
      propertyNamespace: existing.property_namespace,
      rowEnd: existing.row_end,
      rowStart: existing.row_start,
      sectionId: existing.section_id,
      sheetName: existing.sheet_name,
      sourceType: document.mime_type,
      startTime: existing.start_time,
      tableId: existing.table_id,
      tenantId: document.tenant_id,
      text,
    };
  }

  private resolveChunkingOptions(overrides?: ChunkingOptions): Required<ChunkingOptions> {
    const config = this.config;
    return {
      chunkOverlap: overrides?.chunkOverlap ?? config.ingestionChunkOverlap,
      chunkSize: overrides?.chunkSize ?? config.ingestionChunkSize,
      separator: overrides?.separator ?? DEFAULT_CHUNK_SEPARATOR,
      tableChunkMode: overrides?.tableChunkMode ?? "auto",
      textChunkMode: overrides?.textChunkMode ?? "auto",
    };
  }

  private serializeMetadataFields(metadata?: DocumentMetadataInput): Partial<DocumentEntity> {
    if (!metadata) {
      return {};
    }
    const patch: Partial<DocumentEntity> = {};
    if (metadata.docType !== undefined) {
      patch.doc_type = metadata.docType === null || metadata.docType.trim() === "" ? null : metadata.docType.trim();
    }
    if (metadata.lang !== undefined) {
      patch.lang = metadata.lang === null || metadata.lang.trim() === "" ? null : metadata.lang.trim();
    }
    if (metadata.tags !== undefined) {
      patch.tags_json = metadata.tags === null ? null : JSON.stringify(metadata.tags);
    }
    if (metadata.aclGroupIds !== undefined) {
      patch.acl_group_ids_json = metadata.aclGroupIds === null ? null : JSON.stringify(metadata.aclGroupIds);
    }
    if (metadata.metadata !== undefined) {
      patch.metadata_json = metadata.metadata === null ? null : JSON.stringify(metadata.metadata);
    }
    return patch;
  }

  public async uploadDocument(
    file: File,
    directoryId: string,
    chunkingOptions?: ChunkingOptions,
    presetDocumentId?: string,
    metadata?: DocumentMetadataInput,
  ): Promise<UploadDocumentResult> {
    if (!(file instanceof File)) {
      throw new BadRequestException("file is required");
    }

    const extension = this.getExtension(file.name);
    const supportedForParsing = this.parserRegistryService.isSupported(file.name, file.type);
    const resolvedChunkingOptions = this.resolveChunkingOptions(chunkingOptions);
    const objectKey = this.buildObjectKey(file.name);
    const documentStatus: DocumentStatus = supportedForParsing ? "uploaded" : "unsupported";
    const parseStatus: ParseStatus = supportedForParsing ? "pending" : "unsupported";
    const indexStatus: IndexStatus = supportedForParsing ? "pending" : "unsupported";
    const importJobStatus: ImportJobStatus = supportedForParsing ? "pending" : "unsupported";

    const putResult = await this.objectStorageService.putObject({
      body: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || "application/octet-stream",
      fileName: file.name,
      objectKey,
    });

    const documentPayload = {
      ...(presetDocumentId?.trim() ? { id: presetDocumentId.trim() } : {}),
      char_count: 0,
      chunk_overlap: resolvedChunkingOptions.chunkOverlap,
      chunk_separator: resolvedChunkingOptions.separator,
      chunk_size: resolvedChunkingOptions.chunkSize,
      directory_id: directoryId,
      error_message: supportedForParsing ? null : "当前文件类型暂未实现解析",
      extension,
      index_status: indexStatus,
      mime_type: file.type || "application/octet-stream",
      name: file.name,
      parse_status: parseStatus,
      recall_count: 0,
      size: file.size,
      status: documentStatus,
      storage_bucket: putResult.storageBucket,
      storage_key: putResult.storageKey,
      table_chunk_mode: resolvedChunkingOptions.tableChunkMode,
      text_chunk_mode: resolvedChunkingOptions.textChunkMode,
      ...this.serializeMetadataFields(metadata),
    } as Partial<DocumentEntity>;

    if (supportedForParsing && this.config.ingestionAsyncEnabled) {
      try {
        return await this.transactionRunner.runInTransaction(async () => {
          const document = await this.documentRepository.createDocument(documentPayload);
          const importJob = await this.importJobRepository.createJob({
            chunk_count: 0,
            document_id: document.id,
            error_message: null,
            status: "pending",
          });
          return this.enqueueIngest({
            document,
            importJobId: importJob.id,
            resolvedChunkingOptions,
            supportedForParsing,
          });
        });
      } catch (error) {
        try {
          await this.objectStorageService.deleteObject({
            bucket: putResult.storageBucket,
            objectKey: putResult.storageKey,
          });
        } catch {
          // MySQL remains authoritative; storage orphan cleanup needs operations reconciliation.
        }
        throw error;
      }
    }

    const document = await this.documentRepository.createDocument(documentPayload);

    const importJob = await this.importJobRepository.createJob({
      chunk_count: 0,
      document_id: document.id,
      error_message: supportedForParsing ? null : "当前文件类型暂未实现解析",
      status: importJobStatus,
    });

    if (!supportedForParsing) {
      return {
        documentId: document.id,
        importJobId: importJob.id,
        status: "unsupported",
        supportedForParsing,
      };
    }

    return this.runSyncIngest({
      document,
      file,
      importJobId: importJob.id,
      resolvedChunkingOptions,
      supportedForParsing,
    });
  }

  public async listDocuments(): Promise<DocumentJson[]> {
    const rows = await this.documentRepository.findAll();
    return rows.map((value) => documentEntityToJson(value));
  }

  public async searchDocumentsByDirectory(params: {
    directoryId: string;
    pageNumber: number;
    pageSize: number;
    keyword: string | null;
    period?: ParsedPeriodRange;
  }): Promise<{ items: DocumentJson[]; total: number; pages: number }> {
    const result = await this.documentRepository.searchByDirectoryId({
      directoryId: params.directoryId,
      keyword: params.keyword,
      pageNumber: params.pageNumber,
      pageSize: params.pageSize,
      period: params.period,
    });
    return {
      items: result.items.map(documentEntityToJson),
      pages: result.pages,
      total: result.total,
    };
  }

  /** Update document metadata/ACL with an atomic versioned payload refresh. */
  public async updateDocumentMetadata(documentId: string, metadata: DocumentMetadataInput): Promise<DocumentJson> {
    const existing = await this.documentRepository.findById(documentId);
    if (!existing) {
      throw new NotFoundException(`document not found: ${documentId}`);
    }
    const patch = this.serializeMetadataFields(metadata);
    if (Object.keys(patch).length === 0) {
      return documentEntityToJson(existing);
    }
    const rows = await this.documentChunkRepository.findByDocumentId(documentId);
    if (rows.length === 0) {
      const updated = await this.documentRepository.update(documentId, patch);
      return documentEntityToJson(updated);
    }

    const nextEntity = { ...existing, ...patch };
    const snapshot = documentMetadataFromEntity(nextEntity);
    const chunks = rows.map((row) => ({
      ...documentChunkEntityToRecord(row),
      aclGroupIds: snapshot.aclGroupIds,
      docCreatedAt: snapshot.docCreatedAt,
      docType: snapshot.docType,
      lang: snapshot.lang,
      tags: snapshot.tags,
    }));
    await this.vectorizationService.indexDocumentChunks(documentId, chunks, {
      documentPatchOnActivate: patch,
    });
    return documentEntityToJson(nextEntity);
  }

  public async previewDocumentChunks(file: File, chunkingOptions?: ChunkingOptions): Promise<ChunkPreviewResult> {
    const chunks = await this.ingestionService.previewDocumentChunks({
      chunkingOptions: this.resolveChunkingOptions(chunkingOptions),
      document: {
        id: "0",
        mime_type: file.type || "application/octet-stream",
        name: file.name,
        tenant_id: null,
      },
      file,
    });
    return {
      chunkCount: chunks.length,
      items: chunks.map((chunk) => this.toChunkPreviewItem(chunk)),
      previewStatus: "ready",
    };
  }

  public async previewDocumentChunksById(documentId: string, syncContext?: PlatformDocumentSyncContext): Promise<ChunkPreviewResult> {
    await this.documentPlatformSync.ensureDocumentAvailable(documentId, syncContext);
    const document = await this.documentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundException(`document not found: ${documentId}`);
    }
    const rows = await this.documentChunkRepository.findByDocumentId(documentId);
    if (rows.length > 0) {
      const items = rows.map((row) =>
        this.documentChunkListItemToPreviewItem(this.toDocumentChunkListItem(row as unknown as Record<string, unknown>)),
      );
      return {
        chunkCount: items.length,
        items,
        previewStatus: "ready",
      };
    }
    if (document.status === "failed" || document.parse_status === "failed" || document.index_status === "failed") {
      return {
        chunkCount: 0,
        documentStatus: document.status,
        errorMessage: document.error_message,
        indexStatus: document.index_status,
        items: [],
        parseStatus: document.parse_status,
        previewStatus: "failed",
      };
    }
    if (document.status === "unsupported" || document.parse_status === "unsupported" || document.index_status === "unsupported") {
      return {
        chunkCount: 0,
        documentStatus: document.status,
        errorMessage: document.error_message,
        indexStatus: document.index_status,
        items: [],
        parseStatus: document.parse_status,
        previewStatus: "unsupported",
      };
    }

    // Preview is a read-only synchronous operation. Upload/reindex may ingest in the
    // background, but preview must not return an empty success merely because no active
    // chunks exist yet.
    const bytes = await this.objectStorageService.getObject({
      bucket: document.storage_bucket,
      objectKey: document.storage_key,
    });
    const file = new File([bytes], document.name, { type: document.mime_type });
    const chunks = await this.ingestionService.previewDocumentChunks({
      chunkingOptions: this.resolveChunkingOptions({
        chunkOverlap: document.chunk_overlap ?? undefined,
        chunkSize: document.chunk_size ?? undefined,
        separator: document.chunk_separator ?? undefined,
        tableChunkMode:
          document.table_chunk_mode === "auto" || document.table_chunk_mode === "row" || document.table_chunk_mode === "window"
            ? document.table_chunk_mode
            : undefined,
        textChunkMode:
          document.text_chunk_mode === "auto" || document.text_chunk_mode === "block" || document.text_chunk_mode === "merge"
            ? document.text_chunk_mode
            : undefined,
      }),
      document,
      file,
    });
    return {
      chunkCount: chunks.length,
      items: chunks.map((chunk) => this.toChunkPreviewItem(chunk)),
      previewStatus: "ready",
    };
  }

  public async listDocumentChunks(documentId: string): Promise<{ items: DocumentChunkListItem[] }> {
    const document = await this.documentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundException(`document not found: ${documentId}`);
    }
    const rows = await this.documentChunkRepository.findByDocumentId(documentId);
    return {
      items: rows.map((row) => this.toDocumentChunkListItem(row as unknown as Record<string, unknown>)),
    };
  }

  public async getDocumentChunkDetail(chunkId: string): Promise<DocumentChunkDetail> {
    const normalized = chunkId.trim();
    if (normalized === "") {
      throw new NotFoundException("chunk not found");
    }
    const row = await this.documentChunkRepository.findByChunkId(normalized);
    if (!row) {
      throw new NotFoundException(`chunk not found: ${normalized}`);
    }
    return this.toDocumentChunkDetail(row as unknown as Record<string, unknown>);
  }

  public async updateDocumentChunk(
    documentId: string,
    chunkId: string,
    text: string,
    keywordMutations?: { keywordsAdd?: string[]; keywordsRemove?: string[] },
  ): Promise<DocumentChunkListItem> {
    if (text.trim() === "") {
      throw new BadRequestException("text is required");
    }
    const document = await this.documentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundException(`document not found: ${documentId}`);
    }
    const chunk = await this.buildUpdatedChunkRecord(document, chunkId, text, keywordMutations);
    const activeRows = await this.documentChunkRepository.findByDocumentId(documentId);
    let replaced = false;
    const chunks = activeRows.map((row) => {
      const current = documentChunkEntityToRecord(row);
      if (current.chunkId !== chunkId) {
        return current;
      }
      replaced = true;
      return { ...current, ...chunk, embeddingFingerprint: undefined };
    });
    if (!replaced) {
      throw new NotFoundException(`chunk is no longer active: ${chunkId}`);
    }
    await this.vectorizationService.indexDocumentChunks(documentId, chunks);
    const updated = await this.documentChunkRepository.findByDocumentIdAndChunkId(documentId, chunkId);
    if (!updated) {
      throw new NotFoundException(`chunk not found after update: ${chunkId}`);
    }
    return this.toDocumentChunkListItem(updated as unknown as Record<string, unknown>);
  }

  public async deleteDocument(documentId: string): Promise<void> {
    const document = await this.documentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundException(`document not found: ${documentId}`);
    }

    // MySQL logicalDelete first (authoritative) — avoids "vectors gone, doc still previewable".
    await this.documentRepository.logicalDelete(documentId);
    await this.documentChunkRepository.logicalDeleteByDocument(documentId);

    try {
      await this.qdrantVectorRepository.deleteByDocument(documentId);
    } catch {
      await this.vectorReconcileService.scheduleReconcile(documentId, "DELETE_DOCUMENT");
    }

    try {
      await this.objectStorageService.deleteObject({
        bucket: document.storage_bucket,
        objectKey: document.storage_key,
      });
    } catch {
      // Object cleanup is best-effort after MySQL delete; vectors handled above / via reconcile.
    }
  }

  public async reindexDocument(
    documentId: string,
    chunkingOptions?: ChunkingOptions,
    syncContext?: PlatformDocumentSyncContext,
    reindexOptions?: ReindexDocumentOptions,
  ): Promise<UploadDocumentResult> {
    await this.documentPlatformSync.ensureDocumentAvailable(documentId, syncContext);
    const document = await this.documentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundException(`document not found: ${documentId}`);
    }

    const resolvedChunkingOptions = this.resolveChunkingOptions(chunkingOptions);
    const modelCode = this.config.embeddingModel.trim();
    // W3.5-H3: modelCode change forces full re-embed.
    const forceFull =
      reindexOptions?.forceFull === true ||
      (document.embedding_model_code != null && document.embedding_model_code !== "" && document.embedding_model_code !== modelCode);
    const supportedForParsing = this.parserRegistryService.isSupported(document.name, document.mime_type);

    if (this.config.ingestionAsyncEnabled) {
      return this.createAsyncImportJobAndEnqueue({
        document,
        forceFull,
        resolvedChunkingOptions,
        supportedForParsing,
      });
    }

    const bytes = await this.objectStorageService.getObject({
      bucket: document.storage_bucket,
      objectKey: document.storage_key,
    });
    const file = new File([bytes], document.name, { type: document.mime_type });

    const importJob = await this.importJobRepository.createJob({
      chunk_count: 0,
      document_id: document.id,
      error_message: null,
      status: "pending",
    });

    return this.runSyncIngest({
      document,
      file,
      forceFull,
      importJobId: importJob.id,
      modelCode,
      resolvedChunkingOptions,
      supportedForParsing,
    });
  }

  private async createAsyncImportJobAndEnqueue(params: {
    document: DocumentEntity;
    resolvedChunkingOptions: Required<ChunkingOptions>;
    supportedForParsing: boolean;
    forceFull?: boolean;
  }): Promise<UploadDocumentResult> {
    return this.transactionRunner.runInTransaction(async () => {
      const importJob = await this.importJobRepository.createJob({
        chunk_count: 0,
        document_id: params.document.id,
        error_message: null,
        status: "pending",
      });
      return this.enqueueIngest({
        ...params,
        importJobId: importJob.id,
      });
    });
  }

  private async enqueueIngest(params: {
    document: DocumentEntity;
    importJobId: string;
    resolvedChunkingOptions: Required<ChunkingOptions>;
    supportedForParsing: boolean;
    forceFull?: boolean;
  }): Promise<UploadDocumentResult> {
    await this.documentRepository.update(params.document.id, {
      chunk_overlap: params.resolvedChunkingOptions.chunkOverlap,
      chunk_separator: params.resolvedChunkingOptions.separator,
      chunk_size: params.resolvedChunkingOptions.chunkSize,
      error_message: null,
      index_status: "pending",
      parse_status: "pending",
      status: "parsing",
      table_chunk_mode: params.resolvedChunkingOptions.tableChunkMode,
      text_chunk_mode: params.resolvedChunkingOptions.textChunkMode,
    });
    await this.importJobRepository.update(params.importJobId, {
      error_message: null,
      status: "pending",
    });
    await this.ingestScheduler.schedule({
      attempt: 1,
      chunkOverlap: params.resolvedChunkingOptions.chunkOverlap,
      chunkSize: params.resolvedChunkingOptions.chunkSize,
      documentId: String(params.document.id),
      forceFull: params.forceFull,
      importJobId: params.importJobId,
      maxAttempts: this.config.ingestionMaxAttempts,
      separator: params.resolvedChunkingOptions.separator,
      tableChunkMode: params.resolvedChunkingOptions.tableChunkMode,
      tenantId: params.document.tenant_id,
      textChunkMode: params.resolvedChunkingOptions.textChunkMode,
    });
    return {
      documentId: params.document.id,
      importJobId: params.importJobId,
      status: "parsing",
      supportedForParsing: params.supportedForParsing,
    };
  }

  private async runSyncIngest(params: {
    document: DocumentEntity;
    file: File;
    importJobId: string;
    resolvedChunkingOptions: Required<ChunkingOptions>;
    supportedForParsing: boolean;
    forceFull?: boolean;
    modelCode?: string;
  }): Promise<UploadDocumentResult> {
    const ingestionResult = await this.ingestionService.ingestDocument({
      chunkingOptions: params.resolvedChunkingOptions,
      document: params.document,
      file: params.file,
      forceFull: params.forceFull,
      modelCode: params.modelCode,
      sourceJobId: params.importJobId,
    });
    await this.documentRepository.update(params.document.id, {
      char_count: ingestionResult.totalCharCount,
      chunk_overlap: params.resolvedChunkingOptions.chunkOverlap,
      chunk_separator: params.resolvedChunkingOptions.separator,
      chunk_size: params.resolvedChunkingOptions.chunkSize,
      content_checksum: ingestionResult.contentChecksum,
      embedding_model_code: ingestionResult.embeddingModelCode,
      error_message: ingestionResult.errorMessage,
      index_status: ingestionResult.indexStatus,
      parse_status: ingestionResult.parseStatus,
      status: ingestionResult.documentStatus,
      table_chunk_mode: params.resolvedChunkingOptions.tableChunkMode,
      text_chunk_mode: params.resolvedChunkingOptions.textChunkMode,
    });
    await this.importJobRepository.update(params.importJobId, {
      chunk_count: ingestionResult.chunkCount,
      error_message: ingestionResult.errorMessage,
      status: ingestionResult.importJobStatus,
    });
    return {
      documentId: params.document.id,
      importJobId: params.importJobId,
      status: ingestionResult.documentStatus,
      supportedForParsing: params.supportedForParsing,
    };
  }

  private getExtension(filename: string): string {
    const segments = filename.toLowerCase().split(".");
    return segments.length > 1 ? (segments.pop() ?? "") : "";
  }

  private buildObjectKey(filename: string): string {
    return `${Date.now()}-${crypto.randomUUID()}-${filename}`;
  }
}
