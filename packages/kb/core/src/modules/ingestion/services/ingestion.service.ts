import { Injectable } from "@dangao/bun-server";

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
import { VectorizationService } from "../../vector-store/services/vectorization.service";
import { OverlapTextChunker } from "../chunkers/overlap-text.chunker";
import { normalizeEmbeddingText } from "./embedding-text-normalizer";
import { ParserRegistryService } from "./parser-registry.service";
type MergeSources<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer R) => void ? R : never;

function mergeObject<T extends object, S extends readonly object[]>(target: T, ...sources: S): T & MergeSources<S[number]> {
  const clone = { ...target } as T & MergeSources<S[number]>;
  return Object.assign(clone, ...sources);
}

export interface IngestDocumentParams {
  document: Pick<DocumentEntity, "id" | "name" | "mime_type" | "tenant_id">;
  file: File;
  chunkingOptions?: ChunkingOptions;
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
}

@Injectable()
export class IngestionService {
  public constructor(
    private readonly parserRegistryService: ParserRegistryService,
    private readonly overlapTextChunker: OverlapTextChunker,
    private readonly vectorizationService: VectorizationService,
  ) {}

  private hasUsableStructuredChunks(parsed: ParsedDocumentContent): boolean {
    return (parsed.chunks ?? []).some((chunk) => chunk.displayText.trim() !== "" || chunk.embeddingText.trim() !== "");
  }

  private mapParsedChunks(
    parsed: ParsedDocumentContent,
    document: Pick<DocumentEntity, "id" | "name" | "mime_type" | "tenant_id">,
  ): TextChunkRecord[] {
    return (parsed.chunks ?? []).map((chunk) => ({
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

  private rechunkParsedChunks(
    chunks: ParsedDocumentChunk[],
    chunkingOptions: ChunkingOptions,
    document: Pick<DocumentEntity, "id" | "name" | "mime_type" | "tenant_id">,
    sourceType: string,
  ): TextChunkRecord[] {
    const sectionOrderMap = new Map<string, number>();
    let chunkIndex = 0;

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

  private async buildDocumentChunks(params: IngestDocumentParams): Promise<TextChunkRecord[]> {
    const parser = this.parserRegistryService.getParser(params.document.name, params.document.mime_type);
    let parsed: ParsedDocumentContent;
    const fallbackParser = this.parserRegistryService.getFallbackParser(params.document.name, params.document.mime_type);
    try {
      parsed = await parser.parse({
        chunkingOptions: params.chunkingOptions,
        file: params.file,
        filename: params.document.name,
        mimeType: params.document.mime_type,
      });
    } catch (error) {
      if (!fallbackParser) {
        throw error;
      }
      parsed = await fallbackParser.parse({
        chunkingOptions: params.chunkingOptions,
        file: params.file,
        filename: params.document.name,
        mimeType: params.document.mime_type,
      });
    }
    if (parsed.chunks && !this.hasUsableStructuredChunks(parsed) && fallbackParser) {
      parsed = await fallbackParser.parse({
        chunkingOptions: params.chunkingOptions,
        file: params.file,
        filename: params.document.name,
        mimeType: params.document.mime_type,
      });
    }

    return parsed.chunks && parsed.chunks.length > 0
      ? params.chunkingOptions
        ? this.rechunkParsedChunks(parsed.chunks, params.chunkingOptions, params.document, parsed.sourceType)
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
          mergeObject({}, chunk, {
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
  }

  public async previewDocumentChunks(params: IngestDocumentParams): Promise<TextChunkRecord[]> {
    return this.buildDocumentChunks(params);
  }

  public async ingestDocument(params: IngestDocumentParams): Promise<IngestionResult> {
    try {
      const chunks = await this.buildDocumentChunks(params);
      await this.vectorizationService.indexDocumentChunks(params.document.id, chunks);
      const totalCharCount = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
      return {
        chunkCount: chunks.length,
        documentStatus: "indexed",
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
        documentStatus: "failed",
        errorMessage: message,
        importJobStatus: "failed",
        indexStatus: "failed",
        parseStatus: "failed",
        totalCharCount: 0,
      };
    }
  }
}
