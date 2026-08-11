import { Inject, Injectable } from "@dangao/bun-server";

import { APP_CONFIG_TOKEN, type AppConfig } from "../../../config/app.config";
import { assessChunkQuality, chunkQualityPolicyFromConfig } from "../../common/chunk-quality";
import { documentMetadataFromEntity } from "../../common/document-metadata";
import {
  type ChunkingOptions,
  type ImportJobStatus,
  type IndexStatus,
  type ParseStatus,
  type ParsedDocumentChunk,
  type ParsedDocumentContent,
  type TextChunkRecord,
} from "../../common/document-types";
import { type DocumentEntity } from "../../documents/infrastructure/orm/document.entity";
import { resolveChunkRetrievalProfile } from "../../vector-store/infrastructure/embeddings/retrieval-profile";
import { computeContentChecksum } from "../../vector-store/services/embedding-fingerprint";
import { VectorizationService } from "../../vector-store/services/vectorization.service";
import { OverlapTextChunker } from "../chunkers/overlap-text.chunker";
import { normalizeEmbeddingText } from "./embedding-text-normalizer";
import { ParserRegistryService } from "./parser-registry.service";
type MergeSources<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer R) => void ? R : never;

function mergeObject<T extends object, S extends readonly object[]>(target: T, ...sources: S): T & MergeSources<S[number]> {
  const clone = { ...target } as T & MergeSources<S[number]>;
  return Object.assign(clone, ...sources);
}

type IngestDocumentEntity = Pick<DocumentEntity, "id" | "name" | "mime_type" | "tenant_id"> &
  Partial<Pick<DocumentEntity, "doc_type" | "lang" | "tags_json" | "acl_group_ids_json" | "metadata_json" | "create_time">>;

export interface IngestDocumentParams {
  document: IngestDocumentEntity;
  file: File;
  chunkingOptions?: ChunkingOptions;
  /** W3.5 / W3.3-compatible: force full re-embed path. */
  forceFull?: boolean;
  /** Override embedding model code (tests / explicit reindex). */
  modelCode?: string;
  /** Override fingerprint algo version (tests / bump). */
  algoVersion?: string;
  /** Monotonic import-job SFID used to order concurrent generation activation. */
  sourceJobId?: string;
}

export interface IngestionResult {
  importJobStatus: ImportJobStatus;
  documentStatus: "indexed" | "failed";
  parseStatus: ParseStatus;
  indexStatus: IndexStatus;
  errorMessage: string | null;
  chunkCount: number;
  /** 各分段正文 text 长度之和（与入库分段一致） */
  totalCharCount: number;
  /** W3.5: sha256 of source file bytes */
  contentChecksum: string | null;
  /** W3.5: embedding model used for this ingest */
  embeddingModelCode: string | null;
  /** W3.5: number of chunks that invoked embed */
  embeddedCount: number;
}

@Injectable()
export class IngestionService {
  public constructor(
    private readonly parserRegistryService: ParserRegistryService,
    private readonly overlapTextChunker: OverlapTextChunker,
    private readonly vectorizationService: VectorizationService,
    @Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  private applyQualityPolicy(chunks: TextChunkRecord[]): TextChunkRecord[] {
    const policy = chunkQualityPolicyFromConfig(this.config);
    const accepted: TextChunkRecord[] = [];
    for (const chunk of chunks) {
      const assessment = assessChunkQuality(
        {
          chunkType: chunk.chunkType,
          embeddingText: chunk.embeddingText,
          headingPath: chunk.headingPath,
          pageNo: chunk.pageNo,
          sectionId: chunk.sectionId,
          text: chunk.text,
        },
        policy,
      );
      // 硬门禁：noise/占位符等不入库；封面/目录可入库但带上软策略标记
      if (!assessment.indexable) {
        continue;
      }
      accepted.push({
        ...chunk,
        chunkRole: assessment.role,
        qualityReasons: assessment.reasons,
        qualityScore: assessment.qualityScore,
        retrievableByDefault: assessment.retrievableByDefault,
      });
    }
    return accepted;
  }

  private hasUsableStructuredChunks(parsed: ParsedDocumentContent): boolean {
    return (parsed.chunks ?? []).some((chunk) => chunk.displayText.trim() !== "" || chunk.embeddingText.trim() !== "");
  }

  private documentAccessFields(
    document: IngestDocumentEntity,
  ): Pick<TextChunkRecord, "aclGroupIds" | "docCreatedAt" | "docType" | "lang" | "tags"> {
    const meta = documentMetadataFromEntity(document);
    return {
      aclGroupIds: meta.aclGroupIds,
      docCreatedAt: meta.docCreatedAt,
      docType: meta.docType,
      lang: meta.lang,
      tags: meta.tags,
    };
  }

  private mapParsedChunks(parsed: ParsedDocumentContent, document: IngestDocumentEntity): TextChunkRecord[] {
    const access = this.documentAccessFields(document);
    return (parsed.chunks ?? []).map((chunk) => ({
      ...access,
      captionText: chunk.captionText,
      chunkId: `${document.id}-${chunk.chunkIndex}`,
      chunkIndex: chunk.chunkIndex,
      chunkType: chunk.chunkType,
      cueIndex: chunk.cueIndex ?? null,
      documentId: document.id,
      embeddingText: normalizeEmbeddingText({
        chunkType: chunk.chunkType,
        sourceType: parsed.sourceType,
        displayText: chunk.displayText,
        embeddingText: chunk.embeddingText,
        headingPath: chunk.headingPath,
      }),
      endTime: chunk.endTime ?? null,
      fileName: document.name,
      headers: chunk.headers,
      headingPath: chunk.headingPath,
      keywords: chunk.keywords,
      orderInSection: chunk.orderInSection,
      pageNo: chunk.pageNo,
      pictureDescription: chunk.pictureDescription,
      propertyNamespace: chunk.propertyNamespace ?? null,
      retrievalProfile: resolveChunkRetrievalProfile({
        chunkType: chunk.chunkType,
        sourceType: parsed.sourceType,
        headingPath: chunk.headingPath,
        text: chunk.displayText,
      }),
      rowEnd: chunk.rowEnd ?? null,
      rowStart: chunk.rowStart ?? null,
      sectionId: chunk.sectionId,
      sheetName: chunk.sheetName ?? null,
      sourceType: parsed.sourceType,
      startTime: chunk.startTime ?? null,
      tableId: chunk.tableId ?? null,
      tenantId: document.tenant_id,
      text: chunk.displayText,
    }));
  }

  private shouldSkipRuntimeRechunk(chunk: ParsedDocumentChunk): boolean {
    return chunk.chunkType === "table-row-window" || chunk.chunkType === "vtt-cue-window" || chunk.chunkType === "properties-group";
  }

  /** 仅当调用方显式要求文本再切（block/merge）时，才对 structured chunks 做二次字符切分 */
  private shouldRuntimeRechunk(options?: ChunkingOptions): boolean {
    return options?.textChunkMode === "block" || options?.textChunkMode === "merge";
  }

  private rechunkParsedChunks(
    chunks: ParsedDocumentChunk[],
    chunkingOptions: ChunkingOptions,
    document: IngestDocumentEntity,
    sourceType: string,
  ): TextChunkRecord[] {
    const sectionOrderMap = new Map<string, number>();
    let chunkIndex = 0;
    const access = this.documentAccessFields(document);

    return chunks.flatMap((chunk) => {
      const splitDisplayTexts = this.shouldSkipRuntimeRechunk(chunk)
        ? [chunk.displayText]
        : this.overlapTextChunker.splitText(chunk.displayText, chunkingOptions);
      const displayTexts = splitDisplayTexts.length > 0 ? splitDisplayTexts : [chunk.displayText];
      return displayTexts.map((displayText) => {
        const orderInSection = sectionOrderMap.get(chunk.sectionId) ?? 0;
        sectionOrderMap.set(chunk.sectionId, orderInSection + 1);
        const embeddingText = normalizeEmbeddingText({
          chunkType: chunk.chunkType,
          displayText,
          embeddingText: this.shouldSkipRuntimeRechunk(chunk)
            ? chunk.embeddingText
            : chunk.headingPath.length > 0
              ? `${chunk.headingPath.join("\n")}\n${displayText}`
              : displayText,
          headingPath: chunk.headingPath,
          sourceType,
        });
        const retrievalProfile = resolveChunkRetrievalProfile({
          chunkType: chunk.chunkType,
          headingPath: chunk.headingPath,
          sourceType,
          text: displayText,
        });
        const record: TextChunkRecord = {
          ...access,
          captionText: chunk.captionText,
          chunkId: `${document.id}-${chunkIndex}`,
          chunkIndex,
          chunkType: chunk.chunkType,
          cueIndex: chunk.cueIndex ?? null,
          documentId: document.id,
          embeddingText,
          endTime: chunk.endTime ?? null,
          fileName: document.name,
          headers: chunk.headers,
          headingPath: chunk.headingPath,
          keywords: chunk.keywords,
          orderInSection,
          pageNo: chunk.pageNo,
          pictureDescription: chunk.pictureDescription,
          propertyNamespace: chunk.propertyNamespace ?? null,
          retrievalProfile,
          rowEnd: chunk.rowEnd ?? null,
          rowStart: chunk.rowStart ?? null,
          sectionId: chunk.sectionId,
          sheetName: chunk.sheetName ?? null,
          sourceType,
          startTime: chunk.startTime ?? null,
          tableId: chunk.tableId ?? null,
          tenantId: document.tenant_id,
          text: displayText,
        };
        chunkIndex += 1;
        return record;
      });
    });
  }

  private async parseForIngest(params: IngestDocumentParams): Promise<ParsedDocumentContent> {
    const parser = this.parserRegistryService.getParser(params.document.name, params.document.mime_type);
    const fallbackParser = this.parserRegistryService.getFallbackParser(params.document.name, params.document.mime_type);
    const parseInput = {
      chunkingOptions: params.chunkingOptions,
      file: params.file,
      filename: params.document.name,
      mimeType: params.document.mime_type,
    };
    let parsed: ParsedDocumentContent;
    try {
      parsed = await parser.parse(parseInput);
    } catch (error) {
      if (!fallbackParser) {
        throw error;
      }
      parsed = await fallbackParser.parse(parseInput);
    }
    if (parsed.chunks && !this.hasUsableStructuredChunks(parsed) && fallbackParser) {
      parsed = await fallbackParser.parse(parseInput);
    }
    return parsed;
  }

  private async buildDocumentChunks(params: IngestDocumentParams): Promise<TextChunkRecord[]> {
    // Preview and ingest must make the same parser/fallback decision so the
    // displayed split is the split that will be indexed.
    const parsed = await this.parseForIngest(params);

    const chunkingOptions = params.chunkingOptions;
    const access = this.documentAccessFields(params.document);
    const chunks =
      parsed.chunks && parsed.chunks.length > 0
        ? this.shouldRuntimeRechunk(chunkingOptions) && chunkingOptions
          ? this.rechunkParsedChunks(parsed.chunks, chunkingOptions, params.document, parsed.sourceType)
          : this.mapParsedChunks(parsed, params.document)
        : (
            await this.overlapTextChunker.chunkDocument({
              chunkingOptions: params.chunkingOptions,
              documentId: params.document.id,
              fileName: params.document.name,
              sourceType: parsed.sourceType,
              tenantId: params.document.tenant_id,
              text: parsed.text,
            })
          ).map((chunk) =>
            mergeObject({}, chunk, access, {
              embeddingText: normalizeEmbeddingText({
                chunkType: chunk.chunkType,
                displayText: chunk.text,
                embeddingText: chunk.text,
                headingPath: chunk.headingPath,
                sourceType: parsed.sourceType,
              }),
              retrievalProfile: resolveChunkRetrievalProfile({
                chunkType: chunk.chunkType,
                headingPath: chunk.headingPath,
                sourceType: parsed.sourceType,
                text: chunk.text,
              }),
            }),
          );
    const accepted = this.applyQualityPolicy(chunks);
    return accepted;
  }

  public async previewDocumentChunks(params: IngestDocumentParams): Promise<TextChunkRecord[]> {
    return this.buildDocumentChunks(params);
  }

  public async ingestDocument(params: IngestDocumentParams): Promise<IngestionResult> {
    const modelCode = params.modelCode?.trim() || this.config.embeddingModel.trim() || null;
    let contentChecksum: string | null = null;
    try {
      const bytes = new Uint8Array(await params.file.arrayBuffer());
      contentChecksum = computeContentChecksum(bytes);
      const chunks = await this.buildDocumentChunks(params);
      const indexResult = await this.vectorizationService.indexDocumentChunks(params.document.id, chunks, {
        algoVersion: params.algoVersion,
        forceFull: params.forceFull === true,
        modelCode: modelCode ?? undefined,
        sourceJobId: params.sourceJobId,
      });
      const totalCharCount = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
      return {
        chunkCount: chunks.length,
        contentChecksum,
        documentStatus: "indexed",
        embeddedCount: indexResult.embeddedCount,
        embeddingModelCode: modelCode,
        errorMessage: null,
        importJobStatus: "completed",
        indexStatus: "success",
        parseStatus: "success",
        totalCharCount,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        chunkCount: 0,
        contentChecksum,
        documentStatus: "failed",
        embeddedCount: 0,
        embeddingModelCode: modelCode,
        errorMessage: message,
        importJobStatus: "failed",
        indexStatus: "failed",
        parseStatus: "failed",
        totalCharCount: 0,
      };
    }
  }
}
