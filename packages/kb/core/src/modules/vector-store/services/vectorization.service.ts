import { Inject, Injectable } from "@dangao/bun-server";

import { buildStableQdrantPointId } from "@cube-ai/vector-qdrant";

import { type TextChunkRecord } from "../../common/document-types";
import { EmbeddingProvider, type EmbeddingProvider as EmbeddingProviderContract } from "../infrastructure/embeddings/embedding-provider";
import { DocumentChunkRepositoryOrm } from "../infrastructure/qdrant/document-chunk.repository";
import { QdrantVectorRepository } from "../infrastructure/qdrant/qdrant-vector.repository";

@Injectable()
export class VectorizationService {
  public constructor(
    @Inject(EmbeddingProvider) private readonly embeddingProvider: EmbeddingProviderContract,
    private readonly qdrantVectorRepository: QdrantVectorRepository,
    private readonly documentChunkRepository: DocumentChunkRepositoryOrm,
  ) {}

  public async indexDocumentChunks(documentId: string, chunks: TextChunkRecord[]): Promise<void> {
    if (chunks.length === 0) {
      await this.documentChunkRepository.replaceDocumentChunks(documentId, []);
      return;
    }

    const vectors = await this.embeddingProvider.embed(
      chunks.map((chunk) => chunk.embeddingText),
      "document",
      chunks.map((chunk) => ({
        chunkType: chunk.chunkType,
        retrievalProfile: chunk.retrievalProfile,
        sourceType: chunk.sourceType,
      })),
    );
    await this.qdrantVectorRepository.ensureCollection();
    await this.qdrantVectorRepository.upsert(
      chunks.map((chunk, index) => ({
        id: buildStableQdrantPointId(chunk.chunkId),
        payload: {
          captionText: chunk.captionText,
          chunkId: chunk.chunkId,
          chunkIndex: chunk.chunkIndex,
          chunkType: chunk.chunkType,
          cueIndex: chunk.cueIndex ?? null,
          documentId: chunk.documentId,
          embeddingText: chunk.embeddingText,
          endTime: chunk.endTime ?? null,
          fileName: chunk.fileName,
          headers: chunk.headers,
          headingPath: chunk.headingPath,
          keywords: chunk.keywords,
          orderInSection: chunk.orderInSection,
          pageNo: chunk.pageNo,
          pictureDescription: chunk.pictureDescription,
          propertyNamespace: chunk.propertyNamespace ?? null,
          retrievalProfile: chunk.retrievalProfile,
          rowEnd: chunk.rowEnd ?? null,
          rowStart: chunk.rowStart ?? null,
          sectionId: chunk.sectionId,
          sheetName: chunk.sheetName ?? null,
          sourceType: chunk.sourceType,
          startTime: chunk.startTime ?? null,
          tableId: chunk.tableId ?? null,
          tenantId: chunk.tenantId,
          text: chunk.text,
        },
        vectors: vectors[index] ?? { dense: [], sparse: null },
      })),
    );
    await this.documentChunkRepository.replaceDocumentChunks(documentId, chunks);
  }

  public async indexDocumentChunk(chunk: TextChunkRecord): Promise<void> {
    const [vector] = await this.embeddingProvider.embed([chunk.embeddingText], "document", [
      {
        chunkType: chunk.chunkType,
        retrievalProfile: chunk.retrievalProfile,
        sourceType: chunk.sourceType,
      },
    ]);
    await this.qdrantVectorRepository.ensureCollection();
    await this.qdrantVectorRepository.upsert([
      {
        id: buildStableQdrantPointId(chunk.chunkId),
        payload: {
          captionText: chunk.captionText,
          chunkId: chunk.chunkId,
          chunkIndex: chunk.chunkIndex,
          chunkType: chunk.chunkType,
          cueIndex: chunk.cueIndex ?? null,
          documentId: chunk.documentId,
          embeddingText: chunk.embeddingText,
          endTime: chunk.endTime ?? null,
          fileName: chunk.fileName,
          headers: chunk.headers,
          headingPath: chunk.headingPath,
          keywords: chunk.keywords,
          orderInSection: chunk.orderInSection,
          pageNo: chunk.pageNo,
          pictureDescription: chunk.pictureDescription,
          propertyNamespace: chunk.propertyNamespace ?? null,
          retrievalProfile: chunk.retrievalProfile,
          rowEnd: chunk.rowEnd ?? null,
          rowStart: chunk.rowStart ?? null,
          sectionId: chunk.sectionId,
          sheetName: chunk.sheetName ?? null,
          sourceType: chunk.sourceType,
          startTime: chunk.startTime ?? null,
          tableId: chunk.tableId ?? null,
          tenantId: chunk.tenantId,
          text: chunk.text,
        },
        vectors: vector ?? { dense: [], sparse: null },
      },
    ]);
    await this.documentChunkRepository.updateDocumentChunk(chunk);
  }
}
