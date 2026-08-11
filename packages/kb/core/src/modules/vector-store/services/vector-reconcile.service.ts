import { Inject, Injectable } from "@dangao/bun-server";

import { DocumentRepositoryOrm } from "../../documents/infrastructure/orm/document.repository";
import { DocumentChunkRepositoryOrm } from "../infrastructure/qdrant/document-chunk.repository";
import { QdrantVectorRepository } from "../infrastructure/qdrant/qdrant-vector.repository";
import { documentChunkEntityToRecord } from "./chunk-entity-mapper";
import { diffDocumentVectors, type DocumentVectorDiff } from "./document-vector-diff";
import { VECTOR_RECONCILE_SCHEDULER_TOKEN, type VectorReconcileScheduler } from "./vector-reconcile-scheduler";
import { VectorizationService } from "./vectorization.service";

export interface VectorReconcileResult {
  documentId: string;
  diff: DocumentVectorDiff;
  deletedOrphanCount: number;
  upsertedMissingCount: number;
  clearedDeletedDocument: boolean;
}

function isSoftDeleted(deleted: bigint | number | null | undefined): boolean {
  if (deleted === null || deleted === undefined) {
    return false;
  }
  return Number(deleted) !== 0;
}

/**
 * Shared MySQL-authoritative reconcile for full index / single-chunk / delete paths (W3.1-H5).
 */
@Injectable()
export class VectorReconcileService {
  public constructor(
    private readonly documentRepository: DocumentRepositoryOrm,
    private readonly documentChunkRepository: DocumentChunkRepositoryOrm,
    private readonly qdrantVectorRepository: QdrantVectorRepository,
    private readonly vectorizationService: VectorizationService,
    @Inject(VECTOR_RECONCILE_SCHEDULER_TOKEN) private readonly scheduler: VectorReconcileScheduler,
  ) {}

  public async scheduleReconcile(documentId: string, reason: "FULL_INDEX" | "SINGLE_CHUNK" | "DELETE_DOCUMENT" | "MANUAL"): Promise<void> {
    await this.scheduler.schedule({ documentId, reason });
  }

  public async reconcileDocument(documentId: string): Promise<VectorReconcileResult> {
    const document = await this.documentRepository.findByIdIncludingDeleted(documentId);
    if (!document || isSoftDeleted(document.deleted)) {
      const qdrantPointIds = await this.qdrantVectorRepository.listPointIdsByDocument(documentId);
      const diff = diffDocumentVectors([], qdrantPointIds);
      if (diff.orphanInQdrant.length > 0) {
        await this.qdrantVectorRepository.deleteByDocument(documentId);
      }
      return {
        clearedDeletedDocument: true,
        deletedOrphanCount: diff.orphanInQdrant.length,
        diff,
        documentId,
        upsertedMissingCount: 0,
      };
    }

    const mysqlChunks = await this.documentChunkRepository.findByDocumentId(documentId);
    const mysqlPointIds = mysqlChunks.map((chunk) => chunk.qdrant_point_id);
    const qdrantPointIds = await this.qdrantVectorRepository.listPointIdsByDocument(documentId);
    const diff = diffDocumentVectors(mysqlPointIds, qdrantPointIds);

    if (diff.orphanInQdrant.length > 0) {
      await this.qdrantVectorRepository.deleteByPointIds(diff.orphanInQdrant);
    }

    let upsertedMissingCount = 0;
    if (diff.missingInQdrant.length > 0) {
      const missingSet = new Set(diff.missingInQdrant);
      const toUpsert = mysqlChunks.filter((chunk) => missingSet.has(chunk.qdrant_point_id)).map(documentChunkEntityToRecord);
      await this.vectorizationService.upsertChunksToQdrant(toUpsert);
      upsertedMissingCount = toUpsert.length;
    }

    if (document.index_status === "failed") {
      await this.documentRepository.update(documentId, {
        error_message: null,
        index_status: "success",
        status: "indexed",
      });
    }

    return {
      clearedDeletedDocument: false,
      deletedOrphanCount: diff.orphanInQdrant.length,
      diff,
      documentId,
      upsertedMissingCount,
    };
  }
}
