import { describe, expect, test } from "bun:test";

import { buildStableQdrantPointId } from "@cube-ai/vector-qdrant";

import { makeMockAppConfig } from "../../../test-helpers/mock-app-config";
import { type TextChunkRecord } from "../../common/document-types";
import { type EmbeddingContext, type EmbeddingProvider, type EmbeddingVector } from "../infrastructure/embeddings/embedding-provider";
import { EMBEDDING_FINGERPRINT_ALGO_VERSION } from "./embedding-fingerprint";
import { InMemoryVectorReconcileScheduler } from "./vector-reconcile-scheduler";
import { VectorizationService } from "./vectorization.service";

class FakeEmbeddingProvider implements EmbeddingProvider {
  public inputs: string[][] = [];
  public contexts: (EmbeddingContext[] | undefined)[] = [];

  public async embed(input: string[], _purpose?: never, contexts?: EmbeddingContext[]): Promise<EmbeddingVector[]> {
    this.inputs.push(input);
    this.contexts.push(contexts);
    return input.map(() => ({
      dense: [0.1, 0.2, 0.3],
      sparse: { indices: [1, 2], values: [0.9, 0.4] },
    }));
  }
}

class FakeQdrantVectorRepository {
  public ensured = false;
  public upsertCalls: { id: string | number; payload: Record<string, unknown>; vectors: EmbeddingVector }[][] = [];
  public deleteDocumentIds: string[] = [];
  public deletedPointIds: string[][] = [];
  public pointIdsByDocument = new Map<string, string[]>();
  public failUpsert = false;
  public failDelete = false;
  public callOrder: string[] = [];
  public points = new Map<string, { payload: Record<string, unknown>; vectors: EmbeddingVector }>();

  public async ensureCollection(): Promise<void> {
    this.ensured = true;
  }

  public async upsert(points: { id: string | number; payload: Record<string, unknown>; vectors: EmbeddingVector }[]): Promise<void> {
    this.callOrder.push("qdrant.upsert");
    if (this.failUpsert) {
      throw new Error("qdrant upsert failed");
    }
    this.upsertCalls.push(points);
    for (const point of points) {
      const documentId = String(point.payload.documentId ?? "");
      const existing = this.pointIdsByDocument.get(documentId) ?? [];
      const id = String(point.id);
      if (!existing.includes(id)) {
        existing.push(id);
      }
      this.pointIdsByDocument.set(documentId, existing);
      this.points.set(id, { payload: point.payload, vectors: point.vectors });
    }
  }

  public async deleteByDocument(documentId: string): Promise<void> {
    this.callOrder.push("qdrant.deleteByDocument");
    if (this.failDelete) {
      throw new Error("qdrant delete failed");
    }
    this.deleteDocumentIds.push(documentId);
    this.pointIdsByDocument.set(documentId, []);
    for (const [id, point] of this.points) {
      if (String(point.payload.documentId ?? "") === documentId) this.points.delete(id);
    }
  }

  public async listPointIdsByDocument(documentId: string): Promise<string[]> {
    return [...(this.pointIdsByDocument.get(documentId) ?? [])];
  }

  public async deleteByPointIds(pointIds: string[]): Promise<void> {
    this.callOrder.push("qdrant.deleteByPointIds");
    if (this.failDelete) {
      throw new Error("qdrant delete failed");
    }
    this.deletedPointIds.push(pointIds);
    for (const [documentId, ids] of this.pointIdsByDocument.entries()) {
      this.pointIdsByDocument.set(
        documentId,
        ids.filter((id) => !pointIds.includes(id)),
      );
    }
    pointIds.forEach((id) => this.points.delete(id));
  }

  public async getVectorsByPointIds(pointIds: string[]): Promise<Map<string, EmbeddingVector>> {
    return new Map(
      pointIds.flatMap((id) => {
        const point = this.points.get(id);
        return point ? [[id, point.vectors] as const] : [];
      }),
    );
  }

  public async listPointIdsByDocumentGeneration(documentId: string, generationId: string): Promise<string[]> {
    return Array.from(this.points.entries())
      .filter(([, point]) => point.payload.documentId === documentId && point.payload.generationId === generationId)
      .map(([id]) => id);
  }

  public async deleteByDocumentGeneration(documentId: string, generationId: string): Promise<void> {
    const ids = await this.listPointIdsByDocumentGeneration(documentId, generationId);
    await this.deleteByPointIds(ids);
  }
}

class FakeDocumentChunkRepository {
  public replaceCalls: { documentId: string; chunks: TextChunkRecord[] }[] = [];
  public updateCalls: TextChunkRecord[] = [];
  public chunksByDocument = new Map<string, { qdrant_point_id: string; chunk: TextChunkRecord }[]>();
  public callOrder: string[] = [];
  public activeGenerationByDocument = new Map<string, string>();

  public async replaceDocumentChunks(documentId: string, chunks: TextChunkRecord[]): Promise<void> {
    this.callOrder.push("mysql.replace");
    this.replaceCalls.push({ chunks, documentId });
    this.chunksByDocument.set(
      documentId,
      chunks.map((chunk) => ({
        chunk: { ...chunk, generationId: chunk.generationId ?? "legacy" },
        qdrant_point_id: buildStableQdrantPointId(chunk.chunkId),
      })),
    );
    this.activeGenerationByDocument.set(documentId, chunks[0]?.generationId ?? "legacy");
  }

  public async insertDocumentGenerationChunks(documentId: string, generationId: string, chunks: TextChunkRecord[]): Promise<void> {
    this.callOrder.push("mysql.insert-generation");
    const existing = this.chunksByDocument.get(documentId) ?? [];
    this.chunksByDocument.set(documentId, [
      ...existing,
      ...chunks.map((chunk) => ({
        chunk: { ...chunk, generationId },
        qdrant_point_id: buildStableQdrantPointId(`${generationId}:${chunk.chunkId}`),
      })),
    ]);
  }

  public async countDocumentGeneration(documentId: string, generationId: string): Promise<number> {
    return (this.chunksByDocument.get(documentId) ?? []).filter((row) => row.chunk.generationId === generationId).length;
  }

  public async deleteDocumentGeneration(documentId: string, generationId: string): Promise<void> {
    this.chunksByDocument.set(
      documentId,
      (this.chunksByDocument.get(documentId) ?? []).filter((row) => row.chunk.generationId !== generationId),
    );
  }

  public async findByDocumentIdAndChunkId(documentId: string, chunkId: string) {
    const active = this.activeGenerationByDocument.get(documentId) ?? "legacy";
    const row = (this.chunksByDocument.get(documentId) ?? []).find(
      (candidate) => candidate.chunk.chunkId === chunkId && candidate.chunk.generationId === active,
    );
    return row ? { generation_id: active } : null;
  }

  public async updateDocumentChunk(chunk: TextChunkRecord): Promise<void> {
    this.callOrder.push("mysql.update");
    this.updateCalls.push(chunk);
    const rows = this.chunksByDocument.get(chunk.documentId) ?? [];
    const generationId = chunk.generationId ?? this.activeGenerationByDocument.get(chunk.documentId) ?? "legacy";
    const pointId = buildStableQdrantPointId(generationId === "legacy" ? chunk.chunkId : `${generationId}:${chunk.chunkId}`);
    const next = rows.filter((row) => !(row.chunk.chunkId === chunk.chunkId && row.chunk.generationId === generationId));
    next.push({ chunk: { ...chunk, generationId }, qdrant_point_id: pointId });
    this.chunksByDocument.set(chunk.documentId, next);
  }

  public async findByDocumentId(documentId: string) {
    const active = this.activeGenerationByDocument.get(documentId) ?? "legacy";
    return (this.chunksByDocument.get(documentId) ?? [])
      .filter(({ chunk }) => (chunk.generationId ?? "legacy") === active)
      .map(({ chunk, qdrant_point_id }) => ({
        caption_text: chunk.captionText,
        chunk_id: chunk.chunkId,
        chunk_index: chunk.chunkIndex,
        chunk_type: chunk.chunkType,
        cue_index: chunk.cueIndex ?? null,
        document_id: chunk.documentId,
        embedding_fingerprint: chunk.embeddingFingerprint ?? null,
        embedding_text: chunk.embeddingText,
        generation_id: chunk.generationId ?? "legacy",
        end_time: chunk.endTime ?? null,
        file_name: chunk.fileName,
        headers_text: chunk.headers ? JSON.stringify(chunk.headers) : null,
        heading_path: JSON.stringify(chunk.headingPath),
        keywords_text: chunk.keywords ? JSON.stringify(chunk.keywords) : null,
        order_in_section: chunk.orderInSection,
        page_no: chunk.pageNo,
        picture_description: chunk.pictureDescription,
        property_namespace: chunk.propertyNamespace ?? null,
        qdrant_point_id,
        row_end: chunk.rowEnd ?? null,
        row_start: chunk.rowStart ?? null,
        section_id: chunk.sectionId,
        sheet_name: chunk.sheetName ?? null,
        source_type: chunk.sourceType,
        start_time: chunk.startTime ?? null,
        table_id: chunk.tableId ?? null,
        tenant_id: chunk.tenantId,
        text_content: chunk.text,
      }));
  }
}

class FakeDocumentRepository {
  public updates: { id: string; patch: Record<string, unknown> }[] = [];
  public docs = new Map<
    string,
    {
      active_generation_id: string;
      active_generation_job_id: string | null;
      deleted: bigint | null;
      index_status: string;
      status: string;
      error_message: string | null;
    }
  >();
  public onActiveGeneration?: (documentId: string, generationId: string) => void;

  public async update(id: string, patch: Record<string, unknown>) {
    this.updates.push({ id, patch });
    if (typeof patch.active_generation_id === "string") {
      this.onActiveGeneration?.(id, patch.active_generation_id);
    }
    const prev = this.docs.get(id) ?? {
      active_generation_id: "legacy",
      active_generation_job_id: null,
      deleted: null,
      error_message: null,
      index_status: "pending",
      status: "parsing",
    };
    this.docs.set(id, {
      active_generation_id: String(patch.active_generation_id ?? prev.active_generation_id),
      active_generation_job_id: (patch.active_generation_job_id as string | null | undefined) ?? prev.active_generation_job_id,
      deleted: prev.deleted,
      error_message: (patch.error_message as string | null | undefined) ?? prev.error_message,
      index_status: String(patch.index_status ?? prev.index_status),
      status: String(patch.status ?? prev.status),
    });
    return { id, ...patch };
  }

  public async activateGeneration(params: {
    documentId: string;
    expectedGenerationId: string;
    generationId: string;
    sourceJobId?: string;
  }): Promise<boolean> {
    const prev = this.docs.get(params.documentId) ?? {
      active_generation_id: "legacy",
      active_generation_job_id: null,
      deleted: null,
      error_message: null,
      index_status: "pending",
      status: "parsing",
    };
    if (prev.active_generation_id !== params.expectedGenerationId) {
      return false;
    }
    if (
      params.sourceJobId !== undefined &&
      prev.active_generation_job_id !== null &&
      BigInt(prev.active_generation_job_id) > BigInt(params.sourceJobId)
    ) {
      return false;
    }
    await this.update(params.documentId, {
      active_generation_id: params.generationId,
      active_generation_job_id: params.sourceJobId ?? null,
    });
    return true;
  }

  public async findByIdIncludingDeleted(id: string) {
    const doc = this.docs.get(id);
    if (!doc) {
      return {
        active_generation_id: "legacy",
        active_generation_job_id: null,
        deleted: null,
        error_message: null,
        id,
        index_status: "failed",
        status: "failed",
      };
    }
    return { ...doc, id };
  }
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MODEL = "doubao-embedding-vision-251215";

function sampleChunk(overrides: Partial<TextChunkRecord> = {}): TextChunkRecord {
  return {
    captionText: null,
    chunkId: "67-0",
    chunkIndex: 0,
    chunkType: "paragraph",
    cueIndex: null,
    documentId: "67",
    embeddingText: "heading\ndisplay text",
    endTime: null,
    fileName: "demo.txt",
    headers: undefined,
    headingPath: ["heading"],
    keywords: undefined,
    orderInSection: 0,
    pageNo: 1,
    pictureDescription: null,
    propertyNamespace: null,
    retrievalProfile: "semantic-qa",
    rowEnd: null,
    rowStart: null,
    sectionId: "section-1",
    sheetName: null,
    sourceType: "txt",
    startTime: null,
    tableId: null,
    tenantId: null,
    text: "display text",
    ...overrides,
  };
}

function createService(deps?: {
  embeddingProvider?: FakeEmbeddingProvider;
  qdrant?: FakeQdrantVectorRepository;
  chunks?: FakeDocumentChunkRepository;
  documents?: FakeDocumentRepository;
  scheduler?: InMemoryVectorReconcileScheduler;
  embeddingModel?: string;
}) {
  const embeddingProvider = deps?.embeddingProvider ?? new FakeEmbeddingProvider();
  const qdrant = deps?.qdrant ?? new FakeQdrantVectorRepository();
  const chunks = deps?.chunks ?? new FakeDocumentChunkRepository();
  const documents = deps?.documents ?? new FakeDocumentRepository();
  const scheduler = deps?.scheduler ?? new InMemoryVectorReconcileScheduler();
  documents.onActiveGeneration = (documentId, generationId) => chunks.activeGenerationByDocument.set(documentId, generationId);
  const service = new VectorizationService(
    embeddingProvider,
    qdrant as never,
    chunks as never,
    documents as never,
    scheduler,
    makeMockAppConfig({ embeddingModel: deps?.embeddingModel ?? MODEL }),
  );
  return { chunks, documents, embeddingProvider, qdrant, scheduler, service };
}

describe("VectorizationService", () => {
  test("uses stable legal qdrant point ids while preserving business chunkId in payload", async () => {
    const { service, embeddingProvider, qdrant, chunks } = createService();
    const sample = sampleChunk();

    await service.indexDocumentChunks("67", [sample], { forceFull: true });
    await service.indexDocumentChunks("67", [sample], { forceFull: true });

    expect(qdrant.ensured).toBe(true);
    expect(embeddingProvider.inputs).toEqual([["heading\ndisplay text"], ["heading\ndisplay text"]]);
    expect(qdrant.upsertCalls).toHaveLength(2);
    expect(qdrant.upsertCalls[0]?.[0]?.payload.chunkId).toBe("67-0");
    expect(String(qdrant.upsertCalls[0]?.[0]?.id)).toMatch(UUID_V4_PATTERN);
    expect(qdrant.upsertCalls[1]?.[0]?.id).not.toBe(qdrant.upsertCalls[0]?.[0]?.id);
    expect(chunks.replaceCalls).toHaveLength(0);
    expect(chunks.callOrder[0]).toBe("mysql.insert-generation");
    expect(qdrant.callOrder[0]).toBe("qdrant.upsert");
  });

  test("W3.1-H1: failed staging generation is cleaned and retry can switch active", async () => {
    const { service, qdrant, chunks, documents } = createService();
    const sampleChunks = [sampleChunk()];
    qdrant.failUpsert = true;
    await expect(service.indexDocumentChunks("67", sampleChunks, { forceFull: true })).rejects.toThrow("qdrant upsert failed");
    expect(await chunks.findByDocumentId("67")).toEqual([]);
    expect(documents.updates.some((u) => typeof u.patch.active_generation_id === "string")).toBe(false);

    qdrant.failUpsert = false;
    await service.indexDocumentChunks("67", sampleChunks, { forceFull: true });
    expect(await chunks.findByDocumentId("67")).toHaveLength(1);
    expect(documents.updates.some((u) => typeof u.patch.active_generation_id === "string")).toBe(true);
    expect(await qdrant.listPointIdsByDocument("67")).toHaveLength(1);
  });

  test("W3.5-H1: unchanged reindex embeds zero chunks", async () => {
    const { service, embeddingProvider } = createService();
    const chunks = [sampleChunk(), sampleChunk({ chunkId: "67-1", chunkIndex: 1, embeddingText: "other", text: "other" })];

    const first = await service.indexDocumentChunks("67", chunks);
    expect(first.embeddedCount).toBe(2);
    expect(embeddingProvider.inputs).toHaveLength(1);

    const second = await service.indexDocumentChunks("67", chunks);
    expect(second.embeddedCount).toBe(0);
    expect(second.forceFull).toBe(false);
    expect(embeddingProvider.inputs).toHaveLength(1);
  });

  test("W3.5-H2: single chunk change re-embeds only that chunk", async () => {
    const { service, embeddingProvider, qdrant } = createService();
    const initial = [
      sampleChunk({ chunkId: "67-0", chunkIndex: 0, embeddingText: "a", text: "a" }),
      sampleChunk({ chunkId: "67-1", chunkIndex: 1, embeddingText: "b", text: "b" }),
      sampleChunk({ chunkId: "67-2", chunkIndex: 2, embeddingText: "c", text: "c" }),
    ];
    await service.indexDocumentChunks("67", initial);
    embeddingProvider.inputs = [];

    const next = [
      sampleChunk({ chunkId: "67-0", chunkIndex: 0, embeddingText: "a", text: "a" }),
      sampleChunk({ chunkId: "67-1", chunkIndex: 1, embeddingText: "b-changed", text: "b-changed" }),
      sampleChunk({ chunkId: "67-2", chunkIndex: 2, embeddingText: "c", text: "c" }),
    ];
    const result = await service.indexDocumentChunks("67", next);
    expect(result.embeddedCount).toBe(1);
    expect(embeddingProvider.inputs).toEqual([["b-changed"]]);
    expect(qdrant.upsertCalls.at(-1)?.map((p) => p.payload.chunkId)).toEqual(["67-0", "67-1", "67-2"]);
    expect(qdrant.deleteDocumentIds).toHaveLength(0);
  });

  test("W3.5-H3: modelCode change forceFull re-embeds all chunks", async () => {
    const { service, embeddingProvider, qdrant } = createService();
    const chunks = [
      sampleChunk({ chunkId: "67-0", embeddingText: "a", text: "a" }),
      sampleChunk({ chunkId: "67-1", chunkIndex: 1, embeddingText: "b", text: "b" }),
    ];
    await service.indexDocumentChunks("67", chunks, { modelCode: "model-a" });
    embeddingProvider.inputs = [];
    qdrant.callOrder = [];

    const result = await service.indexDocumentChunks("67", chunks, { forceFull: true, modelCode: "model-b" });
    expect(result.forceFull).toBe(true);
    expect(result.embeddedCount).toBe(2);
    expect(embeddingProvider.inputs).toEqual([["a", "b"]]);
    expect(qdrant.callOrder[0]).toBe("qdrant.upsert");
  });

  test("W3.5-H4: algoVersion bump triggers re-embed via fingerprint", async () => {
    const { service, embeddingProvider } = createService();
    const chunks = [sampleChunk()];
    await service.indexDocumentChunks("67", chunks, { algoVersion: EMBEDDING_FINGERPRINT_ALGO_VERSION });
    embeddingProvider.inputs = [];

    const result = await service.indexDocumentChunks("67", chunks, { algoVersion: "v2" });
    expect(result.embeddedCount).toBe(1);
    expect(embeddingProvider.inputs).toEqual([["heading\ndisplay text"]]);
  });

  test("incremental generation cleans all obsolete point ids without a document-wide wipe", async () => {
    const { service, qdrant } = createService();
    await service.indexDocumentChunks("67", [
      sampleChunk({ chunkId: "67-0", embeddingText: "a", text: "a" }),
      sampleChunk({ chunkId: "67-1", chunkIndex: 1, embeddingText: "b", text: "b" }),
    ]);
    qdrant.callOrder = [];

    await service.indexDocumentChunks("67", [sampleChunk({ chunkId: "67-0", embeddingText: "a", text: "a" })]);
    expect(qdrant.callOrder).toContain("qdrant.deleteByPointIds");
    expect(qdrant.deletedPointIds.flat()).toHaveLength(2);
    expect(qdrant.deleteDocumentIds).toHaveLength(0);
    expect(await qdrant.listPointIdsByDocument("67")).toHaveLength(1);
  });

  test("cleanup and reconcile scheduling failure never deletes the active generation", async () => {
    const qdrant = new FakeQdrantVectorRepository();
    const chunks = new FakeDocumentChunkRepository();
    const documents = new FakeDocumentRepository();
    const throwingScheduler = {
      async schedule(): Promise<void> {
        throw new Error("reconcile scheduler unavailable");
      },
    };
    const { service } = createService({
      chunks,
      documents,
      qdrant,
      scheduler: throwingScheduler as never,
    });
    await service.indexDocumentChunks("67", [sampleChunk()], { sourceJobId: "100" });
    qdrant.failDelete = true;

    await expect(
      service.indexDocumentChunks("67", [sampleChunk({ embeddingText: "changed", text: "changed" })], {
        sourceJobId: "101",
      }),
    ).resolves.toEqual({ embeddedCount: 1, forceFull: false });
    expect(await chunks.findByDocumentId("67")).toHaveLength(1);
    expect(documents.docs.get("67")?.active_generation_job_id).toBe("101");
  });

  test("an older import job finishing late cannot overwrite a newer generation", async () => {
    const { service, chunks, documents } = createService();
    await service.indexDocumentChunks("67", [sampleChunk({ embeddingText: "new", text: "new" })], {
      sourceJobId: "200",
    });
    const activeGeneration = chunks.activeGenerationByDocument.get("67");

    await expect(
      service.indexDocumentChunks("67", [sampleChunk({ embeddingText: "old", text: "old" })], {
        sourceJobId: "199",
      }),
    ).rejects.toThrow("generation activation superseded");
    expect(chunks.activeGenerationByDocument.get("67")).toBe(activeGeneration);
    expect(documents.docs.get("67")?.active_generation_job_id).toBe("200");
    expect((await chunks.findByDocumentId("67"))[0]?.text_content).toBe("new");
  });
});
