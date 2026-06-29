import { BadRequestException, Inject, Injectable, NotFoundException } from "@dangao/bun-server";

import { APP_CONFIG_TOKEN, type AppConfig } from "../../../config/app.config";
import {
  DOCUMENT_PLATFORM_SYNC_PORT_TOKEN,
  type DocumentPlatformSyncPort,
  type PlatformDocumentSyncContext,
} from "../../../port/document-platform-sync.port";
import {
  type ChunkPreviewItem,
  type ChunkPreviewResult,
  type ChunkingOptions,
  DEFAULT_CHUNK_SEPARATOR,
  type DocumentChunkListItem,
  type DocumentStatus,
  type ImportJobStatus,
  type IndexStatus,
  type ParseStatus,
  type TextChunkRecord,
} from "../../common/document-types";
import { ImportJobRepositoryOrm } from "../../ingestion/infrastructure/orm/import-job.repository";
import { IngestionService } from "../../ingestion/services/ingestion.service";
import { ParserRegistryService } from "../../ingestion/services/parser-registry.service";
import { ObjectStorageService } from "../../object-storage/services/object-storage.service";
import { DocumentChunkRepositoryOrm } from "../../vector-store/infrastructure/qdrant/document-chunk.repository";
import { QdrantVectorRepository } from "../../vector-store/infrastructure/qdrant/qdrant-vector.repository";
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
    @Inject(DOCUMENT_PLATFORM_SYNC_PORT_TOKEN)
    private readonly documentPlatformSync: DocumentPlatformSyncPort,
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

  public async uploadDocument(
    file: File,
    directoryId: string,
    chunkingOptions?: ChunkingOptions,
    presetDocumentId?: string,
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

    const document = await this.documentRepository.createDocument({
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
    } as Partial<DocumentEntity>);

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

    const ingestionResult = await this.ingestionService.ingestDocument({
      chunkingOptions: resolvedChunkingOptions,
      document,
      file,
    });

    await this.documentRepository.update(document.id, {
      char_count: ingestionResult.totalCharCount,
      chunk_overlap: resolvedChunkingOptions.chunkOverlap,
      chunk_separator: resolvedChunkingOptions.separator,
      chunk_size: resolvedChunkingOptions.chunkSize,
      error_message: ingestionResult.errorMessage,
      index_status: ingestionResult.indexStatus,
      parse_status: ingestionResult.parseStatus,
      status: ingestionResult.documentStatus,
      table_chunk_mode: resolvedChunkingOptions.tableChunkMode,
      text_chunk_mode: resolvedChunkingOptions.textChunkMode,
    });
    await this.importJobRepository.update(importJob.id, {
      chunk_count: ingestionResult.chunkCount,
      error_message: ingestionResult.errorMessage,
      status: ingestionResult.importJobStatus,
    });

    return {
      documentId: document.id,
      importJobId: importJob.id,
      status: ingestionResult.documentStatus,
      supportedForParsing,
    };
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
    };
  }

  public async previewDocumentChunksById(documentId: string, syncContext?: PlatformDocumentSyncContext): Promise<ChunkPreviewResult> {
    await this.documentPlatformSync.ensureDocumentAvailable(documentId, syncContext);
    const document = await this.documentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundException(`document not found: ${documentId}`);
    }
    const rows = await this.documentChunkRepository.findByDocumentId(documentId);
    const items = rows.map((row) =>
      this.documentChunkListItemToPreviewItem(this.toDocumentChunkListItem(row as unknown as Record<string, unknown>)),
    );
    return {
      chunkCount: items.length,
      items,
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
    await this.vectorizationService.indexDocumentChunk(chunk);
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

    await this.objectStorageService.deleteObject({
      bucket: document.storage_bucket,
      objectKey: document.storage_key,
    });
    await this.qdrantVectorRepository.deleteByDocument(documentId);
    await this.documentRepository.logicalDelete(documentId);
  }

  public async reindexDocument(
    documentId: string,
    chunkingOptions?: ChunkingOptions,
    syncContext?: PlatformDocumentSyncContext,
  ): Promise<UploadDocumentResult> {
    await this.documentPlatformSync.ensureDocumentAvailable(documentId, syncContext);
    const document = await this.documentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundException(`document not found: ${documentId}`);
    }

    const resolvedChunkingOptions = this.resolveChunkingOptions(chunkingOptions);
    const bytes = await this.objectStorageService.getObject({
      bucket: document.storage_bucket,
      objectKey: document.storage_key,
    });
    const file = new File([bytes], document.name, { type: document.mime_type });

    const importJob = await this.importJobRepository.createJob({
      chunk_count: 0,
      document_id: document.id,
      error_message: null,
      status: "processing",
    });

    const ingestionResult = await this.ingestionService.ingestDocument({
      chunkingOptions: resolvedChunkingOptions,
      document,
      file,
    });
    await this.documentRepository.update(document.id, {
      char_count: ingestionResult.totalCharCount,
      chunk_overlap: resolvedChunkingOptions.chunkOverlap,
      chunk_separator: resolvedChunkingOptions.separator,
      chunk_size: resolvedChunkingOptions.chunkSize,
      error_message: ingestionResult.errorMessage,
      index_status: ingestionResult.indexStatus,
      parse_status: ingestionResult.parseStatus,
      status: ingestionResult.documentStatus,
      table_chunk_mode: resolvedChunkingOptions.tableChunkMode,
      text_chunk_mode: resolvedChunkingOptions.textChunkMode,
    });
    await this.importJobRepository.update(importJob.id, {
      chunk_count: ingestionResult.chunkCount,
      error_message: ingestionResult.errorMessage,
      status: ingestionResult.importJobStatus,
    });

    return {
      documentId: document.id,
      importJobId: importJob.id,
      status: ingestionResult.documentStatus,
      supportedForParsing: this.parserRegistryService.isSupported(document.name, document.mime_type),
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
