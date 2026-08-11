import { Inject, Injectable } from "@dangao/bun-server";

import { buildStableQdrantPointId } from "@cube-ai/vector-qdrant";

import { type TextChunkRecord } from "../../common/document-types";
import { type DocumentEntity } from "../../documents/infrastructure/orm/document.entity";
import { DocumentRepositoryOrm } from "../../documents/infrastructure/orm/document.repository";
import { EmbeddingProvider, type EmbeddingProvider as EmbeddingProviderContract } from "../infrastructure/embeddings/embedding-provider";
import { DocumentChunkRepositoryOrm } from "../infrastructure/qdrant/document-chunk.repository";
import { QdrantVectorRepository } from "../infrastructure/qdrant/qdrant-vector.repository";
import { EMBEDDING_FINGERPRINT_ALGO_VERSION, computeEmbeddingFingerprint, diffChunksByFingerprint } from "./embedding-fingerprint";
import { VECTOR_RECONCILE_SCHEDULER_TOKEN, type VectorReconcileScheduler } from "./vector-reconcile-scheduler";
import { APP_CONFIG_TOKEN, type AppConfig } from "@/config/app.config";
import { generateKbRecordId } from "@/infrastructure/kb-record-id";

export interface IndexDocumentChunksOptions {
  /** When true, wipe + re-embed all chunks (W3.1 full path). */
  forceFull?: boolean;
  /** Embedding model code; defaults to app config EMBEDDING_MODEL. */
  modelCode?: string;
  /** Override fingerprint algo version (tests / bump simulation). */
  algoVersion?: string;
  /** Monotonic import-job SFID; rejects an older rebuild that finishes late. */
  sourceJobId?: string;
  /** Document metadata committed atomically with the active-generation switch. */
  documentPatchOnActivate?: Pick<Partial<DocumentEntity>, "doc_type" | "lang" | "tags_json" | "acl_group_ids_json" | "metadata_json">;
}

export interface IndexDocumentChunksResult {
  /** Number of chunks that invoked the embedding provider. */
  embeddedCount: number;
  forceFull: boolean;
}

/** A newer import/reindex generation won the document CAS. This job must stop without changing document state. */
export class GenerationActivationSupersededError extends Error {
  public constructor(documentId: string) {
    super(`generation activation superseded for document=${documentId}`);
    this.name = "GenerationActivationSupersededError";
  }
}

@Injectable()
export class VectorizationService {
  public constructor(
    @Inject(EmbeddingProvider) private readonly embeddingProvider: EmbeddingProviderContract,
    private readonly qdrantVectorRepository: QdrantVectorRepository,
    private readonly documentChunkRepository: DocumentChunkRepositoryOrm,
    private readonly documentRepository: DocumentRepositoryOrm,
    @Inject(VECTOR_RECONCILE_SCHEDULER_TOKEN) private readonly reconcileScheduler: VectorReconcileScheduler,
    @Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  private resolveModelCode(explicit?: string): string {
    const code = explicit?.trim() || this.config.embeddingModel.trim();
    return code !== "" ? code : "unknown-embedding-model";
  }

  public attachEmbeddingFingerprints(chunks: TextChunkRecord[], options?: { modelCode?: string; algoVersion?: string }): TextChunkRecord[] {
    const modelCode = this.resolveModelCode(options?.modelCode);
    const algoVersion = options?.algoVersion ?? EMBEDDING_FINGERPRINT_ALGO_VERSION;
    return chunks.map((chunk) => ({
      ...chunk,
      embeddingFingerprint:
        chunk.embeddingFingerprint ??
        computeEmbeddingFingerprint({
          algoVersion,
          embeddingText: chunk.embeddingText,
          instructionProfile: chunk.retrievalProfile ?? "semantic-qa",
          modelCode,
        }),
    }));
  }

  /** Embed + upsert Qdrant only (MySQL already authoritative). Used by reconcile. */
  public async upsertChunksToQdrant(chunks: TextChunkRecord[]): Promise<void> {
    if (chunks.length === 0) {
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
    await this.upsertChunksWithVectors(chunks, vectors);
  }

  private async upsertChunksWithVectors(
    chunks: TextChunkRecord[],
    vectors: { dense: number[]; sparse: { indices: number[]; values: number[] } | null }[],
  ): Promise<void> {
    if (chunks.length === 0) {
      return;
    }
    await this.qdrantVectorRepository.ensureCollection();
    await this.qdrantVectorRepository.upsert(
      chunks.map((chunk, index) => ({
        // `legacy` is the migration sentinel for pre-generation rows. Those rows
        // already use the historical chunkId-derived point id, so preserve it
        // during single-chunk repair/reconcile instead of inventing a second id.
        id: buildStableQdrantPointId(
          chunk.generationId && chunk.generationId !== "legacy" ? `${chunk.generationId}:${chunk.chunkId}` : chunk.chunkId,
        ),
        payload: {
          aclGroupIds: chunk.aclGroupIds ?? null,
          captionText: chunk.captionText,
          chunkId: chunk.chunkId,
          chunkIndex: chunk.chunkIndex,
          chunkRole: chunk.chunkRole ?? null,
          chunkType: chunk.chunkType,
          createdAt: chunk.docCreatedAt ?? null,
          cueIndex: chunk.cueIndex ?? null,
          docType: chunk.docType ?? null,
          documentId: chunk.documentId,
          embeddingText: chunk.embeddingText,
          endTime: chunk.endTime ?? null,
          fileName: chunk.fileName,
          ...(chunk.generationId ? { generationId: chunk.generationId } : {}),
          headers: chunk.headers,
          headingPath: chunk.headingPath,
          keywords: chunk.keywords,
          lang: chunk.lang ?? null,
          orderInSection: chunk.orderInSection,
          pageNo: chunk.pageNo,
          pictureDescription: chunk.pictureDescription,
          propertyNamespace: chunk.propertyNamespace ?? null,
          qualityReasons: chunk.qualityReasons ?? null,
          qualityScore: chunk.qualityScore ?? null,
          retrievalProfile: chunk.retrievalProfile,
          retrievableByDefault: chunk.retrievableByDefault ?? null,
          rowEnd: chunk.rowEnd ?? null,
          rowStart: chunk.rowStart ?? null,
          sectionId: chunk.sectionId,
          sheetName: chunk.sheetName ?? null,
          sourceType: chunk.sourceType,
          startTime: chunk.startTime ?? null,
          tableId: chunk.tableId ?? null,
          tags: chunk.tags ?? null,
          tenantId: chunk.tenantId,
          text: chunk.text,
        },
        vectors: vectors[index] ?? { dense: [], sparse: null },
      })),
    );
  }

  /**
   * Index document chunks. Default is incremental (fingerprint diff); `forceFull` uses W3.1 full path.
   */
  public async indexDocumentChunks(
    documentId: string,
    chunks: TextChunkRecord[],
    options?: IndexDocumentChunksOptions,
  ): Promise<IndexDocumentChunksResult> {
    const forceFull = options?.forceFull === true;
    const withFingerprints = this.attachEmbeddingFingerprints(chunks, {
      algoVersion: options?.algoVersion,
      modelCode: options?.modelCode,
    });
    const existing = await this.documentChunkRepository.findByDocumentId(documentId);
    const diff = diffChunksByFingerprint(
      existing.map((row) => ({
        chunkId: row.chunk_id,
        embeddingFingerprint: row.embedding_fingerprint,
      })),
      withFingerprints.map((chunk) => ({
        chunkId: chunk.chunkId,
        embeddingFingerprint: chunk.embeddingFingerprint ?? "",
      })),
    );
    const generationId = generateKbRecordId();
    const generationChunks = withFingerprints.map((chunk) => ({ ...chunk, generationId }));
    const existingByChunkId = new Map(existing.map((row) => [row.chunk_id, row]));
    const mustEmbed = new Set(forceFull ? generationChunks.map((chunk) => chunk.chunkId) : diff.toEmbed);

    // Unchanged embeddings are copied to new generation point ids. If Qdrant cannot
    // return a prior vector, fail safe by embedding that chunk again.
    const reusableRows = generationChunks
      .filter((chunk) => !mustEmbed.has(chunk.chunkId))
      .map((chunk) => existingByChunkId.get(chunk.chunkId))
      .filter((row): row is NonNullable<typeof row> => row !== undefined && row.qdrant_point_id !== "");
    const reusableVectors =
      typeof (this.qdrantVectorRepository as unknown as { getVectorsByPointIds?: unknown }).getVectorsByPointIds === "function"
        ? await this.qdrantVectorRepository.getVectorsByPointIds(reusableRows.map((row) => row.qdrant_point_id))
        : new Map<string, { dense: number[]; sparse: { indices: number[]; values: number[] } | null }>();

    const vectorsByChunkId = new Map<string, { dense: number[]; sparse: { indices: number[]; values: number[] } | null }>();
    for (const chunk of generationChunks) {
      if (mustEmbed.has(chunk.chunkId)) {
        continue;
      }
      const row = existingByChunkId.get(chunk.chunkId);
      const vector = row ? reusableVectors.get(row.qdrant_point_id) : undefined;
      if (vector) {
        vectorsByChunkId.set(chunk.chunkId, vector);
      } else {
        mustEmbed.add(chunk.chunkId);
      }
    }

    const toEmbed = generationChunks.filter((chunk) => mustEmbed.has(chunk.chunkId));
    if (toEmbed.length > 0) {
      const embedded = await this.embeddingProvider.embed(
        toEmbed.map((chunk) => chunk.embeddingText),
        "document",
        toEmbed.map((chunk) => ({
          chunkType: chunk.chunkType,
          retrievalProfile: chunk.retrievalProfile,
          sourceType: chunk.sourceType,
        })),
      );
      toEmbed.forEach((chunk, index) => {
        const vector = embedded[index];
        if (!vector || vector.dense.length === 0) {
          throw new Error(`embedding provider returned no vector for chunk ${chunk.chunkId}`);
        }
        vectorsByChunkId.set(chunk.chunkId, vector);
      });
    }

    const orderedVectors = generationChunks.map((chunk) => {
      const vector = vectorsByChunkId.get(chunk.chunkId);
      if (!vector) {
        throw new Error(`missing staged vector for chunk ${chunk.chunkId}`);
      }
      return vector;
    });
    const oldPointIds = existing.map((row) => row.qdrant_point_id).filter((id) => id !== "");
    const oldGenerationIds = Array.from(new Set(existing.map((row) => row.generation_id ?? "legacy")));
    const expectedGenerationId = existing[0]?.generation_id ?? "legacy";

    if (options?.sourceJobId !== undefined && !/^\d{1,19}$/u.test(options.sourceJobId)) {
      throw new Error(`sourceJobId must be a 1-19 digit SFID: ${options.sourceJobId}`);
    }

    await this.documentChunkRepository.insertDocumentGenerationChunks(documentId, generationId, generationChunks);
    try {
      await this.upsertChunksWithVectors(generationChunks, orderedVectors);
      const [mysqlCount, qdrantPointIds] = await Promise.all([
        this.documentChunkRepository.countDocumentGeneration(documentId, generationId),
        this.qdrantVectorRepository.listPointIdsByDocumentGeneration(documentId, generationId),
      ]);
      if (mysqlCount !== generationChunks.length || qdrantPointIds.length !== generationChunks.length) {
        throw new Error(
          `staging generation validation failed document=${documentId} mysql=${mysqlCount} qdrant=${qdrantPointIds.length} expected=${generationChunks.length}`,
        );
      }
    } catch (error) {
      await Promise.allSettled([
        this.documentChunkRepository.deleteDocumentGeneration(documentId, generationId),
        this.qdrantVectorRepository.deleteByDocumentGeneration(documentId, generationId),
      ]);
      throw error;
    }

    // The active switch is outside the staging rollback boundary. Once MySQL may
    // point at the new generation, deleting it is never a safe error response.
    const activated = await this.documentRepository.activateGeneration({
      documentPatch: options?.documentPatchOnActivate,
      documentId,
      expectedGenerationId,
      generationId,
      ...(options?.sourceJobId !== undefined ? { sourceJobId: options.sourceJobId } : {}),
    });
    if (!activated) {
      await Promise.allSettled([
        this.documentChunkRepository.deleteDocumentGeneration(documentId, generationId),
        this.qdrantVectorRepository.deleteByDocumentGeneration(documentId, generationId),
      ]);
      throw new GenerationActivationSupersededError(documentId);
    }

    // Cleanup happens only after the authoritative switch. Cleanup and even
    // reconcile-scheduling failures must not roll back or delete the active data.
    try {
      if (oldPointIds.length > 0) {
        await this.qdrantVectorRepository.deleteByPointIds(oldPointIds);
      }
      for (const oldGenerationId of oldGenerationIds) {
        await this.documentChunkRepository.deleteDocumentGeneration(documentId, oldGenerationId);
      }
    } catch {
      try {
        await this.reconcileScheduler.schedule({ documentId, reason: "FULL_INDEX" });
      } catch {
        // Active-generation filters preserve correctness; orphan cleanup is best effort.
      }
    }
    return { embeddedCount: toEmbed.length, forceFull };
  }
}
