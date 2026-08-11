import { describe, expect, test } from "bun:test";

import { buildStableQdrantPointId } from "@cube-ai/vector-qdrant";

import { makeMockAppConfig } from "../../../test-helpers/mock-app-config";
import { type TextChunkRecord } from "../../common/document-types";
import { type EmbeddingProvider, type EmbeddingVector } from "../infrastructure/embeddings/embedding-provider";
import { InMemoryVectorReconcileScheduler } from "./vector-reconcile-scheduler";
import { VectorReconcileService } from "./vector-reconcile.service";
import { VectorizationService } from "./vectorization.service";

class FakeEmbeddingProvider implements EmbeddingProvider {
  public async embed(input: string[]): Promise<EmbeddingVector[]> {
    return input.map(() => ({ dense: [0.1], sparse: null }));
  }
}

class FakeQdrantVectorRepository {
  public pointIdsByDocument = new Map<string, string[]>();
  public deleteDocumentIds: string[] = [];
  public deletedPointIds: string[][] = [];

  public async ensureCollection(): Promise<void> {}

  public async upsert(points: { id: string | number; payload: Record<string, unknown> }[]): Promise<void> {
    for (const point of points) {
      const documentId = String(point.payload.documentId ?? "");
      const existing = this.pointIdsByDocument.get(documentId) ?? [];
      const id = String(point.id);
      if (!existing.includes(id)) {
        existing.push(id);
      }
      this.pointIdsByDocument.set(documentId, existing);
    }
  }

  public async deleteByDocument(documentId: string): Promise<void> {
    this.deleteDocumentIds.push(documentId);
    this.pointIdsByDocument.set(documentId, []);
  }

  public async listPointIdsByDocument(documentId: string): Promise<string[]> {
    return [...(this.pointIdsByDocument.get(documentId) ?? [])];
  }

  public async deleteByPointIds(pointIds: string[]): Promise<void> {
    this.deletedPointIds.push(pointIds);
    for (const [documentId, ids] of this.pointIdsByDocument.entries()) {
      this.pointIdsByDocument.set(
        documentId,
        ids.filter((id) => !pointIds.includes(id)),
      );
    }
  }
}

class FakeDocumentChunkRepository {
  public rows: { qdrant_point_id: string; chunk: TextChunkRecord }[] = [];

  public async findByDocumentId(documentId: string) {
    return this.rows
      .filter((row) => row.chunk.documentId === documentId)
      .map(({ chunk, qdrant_point_id }) => ({
        caption_text: chunk.captionText,
        chunk_id: chunk.chunkId,
        chunk_index: chunk.chunkIndex,
        chunk_type: chunk.chunkType,
        cue_index: null,
        document_id: chunk.documentId,
        embedding_text: chunk.embeddingText,
        end_time: null,
        file_name: chunk.fileName,
        headers_text: null,
        heading_path: JSON.stringify(chunk.headingPath),
        keywords_text: null,
        order_in_section: chunk.orderInSection,
        page_no: chunk.pageNo,
        picture_description: null,
        property_namespace: null,
        qdrant_point_id,
        row_end: null,
        row_start: null,
        section_id: chunk.sectionId,
        sheet_name: null,
        source_type: chunk.sourceType,
        start_time: null,
        table_id: null,
        tenant_id: chunk.tenantId,
        text_content: chunk.text,
      }));
  }
}

class FakeDocumentRepository {
  public deleted = false;
  public index_status = "success";

  public async findByIdIncludingDeleted(id: string) {
    return {
      deleted: this.deleted ? 1n : null,
      error_message: null,
      id,
      index_status: this.index_status,
      status: this.deleted ? "deleted" : "indexed",
    };
  }

  public async update() {
    return {};
  }
}

describe("VectorReconcileService", () => {
  test("W3.1-H4: reconcile removes intentional orphan Qdrant points", async () => {
    const embeddingProvider = new FakeEmbeddingProvider();
    const qdrant = new FakeQdrantVectorRepository();
    const chunks = new FakeDocumentChunkRepository();
    const documents = new FakeDocumentRepository();
    const scheduler = new InMemoryVectorReconcileScheduler();
    const vectorization = new VectorizationService(
      embeddingProvider,
      qdrant as never,
      chunks as never,
      documents as never,
      scheduler,
      makeMockAppConfig(),
    );
    const reconcile = new VectorReconcileService(documents as never, chunks as never, qdrant as never, vectorization, scheduler);

    const chunk: TextChunkRecord = {
      captionText: null,
      chunkId: "doc-0",
      chunkIndex: 0,
      chunkType: "paragraph",
      documentId: "doc",
      embeddingText: "body",
      fileName: "a.txt",
      headingPath: [],
      orderInSection: 0,
      pageNo: 1,
      pictureDescription: null,
      sectionId: "s1",
      sourceType: "txt",
      tenantId: null,
      text: "body",
    };
    const keepId = buildStableQdrantPointId("doc-0");
    const orphanId = "00000000-0000-4000-8000-000000000099";
    chunks.rows = [{ chunk, qdrant_point_id: keepId }];
    qdrant.pointIdsByDocument.set("doc", [keepId, orphanId]);

    const result = await reconcile.reconcileDocument("doc");
    expect(result.deletedOrphanCount).toBe(1);
    expect(qdrant.deletedPointIds.flat()).toContain(orphanId);
    expect(await qdrant.listPointIdsByDocument("doc")).toEqual([keepId]);
  });

  test("soft-deleted document clears all residual Qdrant points", async () => {
    const embeddingProvider = new FakeEmbeddingProvider();
    const qdrant = new FakeQdrantVectorRepository();
    const chunks = new FakeDocumentChunkRepository();
    const documents = new FakeDocumentRepository();
    documents.deleted = true;
    const scheduler = new InMemoryVectorReconcileScheduler();
    const vectorization = new VectorizationService(
      embeddingProvider,
      qdrant as never,
      chunks as never,
      documents as never,
      scheduler,
      makeMockAppConfig(),
    );
    const reconcile = new VectorReconcileService(documents as never, chunks as never, qdrant as never, vectorization, scheduler);

    qdrant.pointIdsByDocument.set("gone", ["orphan-a", "orphan-b"]);
    const result = await reconcile.reconcileDocument("gone");
    expect(result.clearedDeletedDocument).toBe(true);
    expect(result.deletedOrphanCount).toBe(2);
    expect(qdrant.deleteDocumentIds).toEqual(["gone"]);
    expect(await qdrant.listPointIdsByDocument("gone")).toEqual([]);
  });
});
