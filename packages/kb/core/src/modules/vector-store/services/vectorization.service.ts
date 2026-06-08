import { Inject, Injectable } from '@dangao/bun-server'
import type { TextChunkRecord } from '../../common/document-types'
import { EmbeddingProvider } from '../infrastructure/embeddings/embedding-provider'
import type { EmbeddingProvider as EmbeddingProviderContract } from '../infrastructure/embeddings/embedding-provider'
import { buildStableQdrantPointId } from '@cube-ai/vector-qdrant';
import { DocumentChunkRepositoryOrm } from '../infrastructure/qdrant/document-chunk.repository'
import { QdrantVectorRepository } from '../infrastructure/qdrant/qdrant-vector.repository'

@Injectable()
export class VectorizationService {
  public constructor(
    @Inject(EmbeddingProvider) private readonly embeddingProvider: EmbeddingProviderContract,
    private readonly qdrantVectorRepository: QdrantVectorRepository,
    private readonly documentChunkRepository: DocumentChunkRepositoryOrm,
  ) {}

  public async indexDocumentChunks(documentId: string, chunks: TextChunkRecord[]): Promise<void> {
    if (chunks.length === 0) {
      await this.documentChunkRepository.replaceDocumentChunks(documentId, [])
      return
    }

    const vectors = await this.embeddingProvider.embed(
      chunks.map((chunk) => chunk.embeddingText),
      'document',
      chunks.map((chunk) => ({
        retrievalProfile: chunk.retrievalProfile,
        sourceType: chunk.sourceType,
        chunkType: chunk.chunkType,
      })),
    )
    await this.qdrantVectorRepository.ensureCollection()
    await this.qdrantVectorRepository.upsert(
      chunks.map((chunk, index) => ({
        id: buildStableQdrantPointId(chunk.chunkId),
        vectors: vectors[index] ?? { dense: [], sparse: null },
        payload: {
          documentId: chunk.documentId,
          chunkId: chunk.chunkId,
          chunkIndex: chunk.chunkIndex,
          fileName: chunk.fileName,
          sourceType: chunk.sourceType,
          text: chunk.text,
          embeddingText: chunk.embeddingText,
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
          retrievalProfile: chunk.retrievalProfile,
          projectId: chunk.projectId,
        },
      })),
    )
    await this.documentChunkRepository.replaceDocumentChunks(documentId, chunks)
  }

  public async indexDocumentChunk(chunk: TextChunkRecord): Promise<void> {
    const [vector] = await this.embeddingProvider.embed([chunk.embeddingText], 'document', [{
      retrievalProfile: chunk.retrievalProfile,
      sourceType: chunk.sourceType,
      chunkType: chunk.chunkType,
    }])
    await this.qdrantVectorRepository.ensureCollection()
    await this.qdrantVectorRepository.upsert([
      {
        id: buildStableQdrantPointId(chunk.chunkId),
        vectors: vector ?? { dense: [], sparse: null },
        payload: {
          documentId: chunk.documentId,
          chunkId: chunk.chunkId,
          chunkIndex: chunk.chunkIndex,
          fileName: chunk.fileName,
          sourceType: chunk.sourceType,
          text: chunk.text,
          embeddingText: chunk.embeddingText,
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
          retrievalProfile: chunk.retrievalProfile,
          projectId: chunk.projectId,
        },
      },
    ])
    await this.documentChunkRepository.updateDocumentChunk(chunk)
  }
}
