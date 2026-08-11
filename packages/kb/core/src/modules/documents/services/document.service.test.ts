import { describe, expect, test } from "bun:test";

import { makeMockAppConfig } from "../../../test-helpers/mock-app-config";
import { type TextChunkRecord } from "../../common/document-types";
import { InMemoryIngestScheduler } from "../../ingestion/services/ingest-scheduler";
import { DocumentService } from "./document.service";

class FakeDocumentRepository {
  public createCalls: Record<string, unknown>[] = [];
  public updateCalls: Record<string, unknown>[] = [];
  public logicalDeleteCalls: string[] = [];
  public callOrder: string[] = [];

  public async createDocument(payload: Record<string, unknown>) {
    this.createCalls.push(payload);
    return {
      id: 101,
      ...payload,
    };
  }

  public findByIdResult: Record<string, unknown> | null = null;

  public async findById(id: string) {
    return (
      this.findByIdResult ?? {
        content_checksum: "a".repeat(64),
        embedding_model_code: "doubao-embedding-vision-251215",
        error_message: null,
        extension: "txt",
        id,
        index_status: "success",
        mime_type: "text/plain",
        name: "note.txt",
        parse_status: "success",
        size: 12,
        status: "indexed",
        storage_bucket: "docs",
        storage_key: "2002",
        tenant_id: null,
      }
    );
  }

  public async findAll(): Promise<Record<string, unknown>[]> {
    return [{ id: "101", name: "note.txt" }];
  }

  public async update(...args: unknown[]) {
    this.updateCalls.push(args[1] as Record<string, unknown>);
    return {
      id: "101",
      status: "deleted",
    };
  }

  public async logicalDelete(id: string) {
    this.callOrder.push("mysql.logicalDelete");
    this.logicalDeleteCalls.push(id);
    return true;
  }
}

class FakeImportJobRepository {
  public updates: Record<string, unknown>[] = [];

  public async createJob(payload: Record<string, unknown>) {
    return {
      id: "202",
      ...payload,
    };
  }

  public async update(_id: string, patch: Record<string, unknown>) {
    this.updates.push(patch);
    return {
      id: "202",
      ...patch,
    };
  }
}

class FakeObjectStorageService {
  public putCalls: { objectKey: string }[] = [];
  public getObjectCalls: { bucket: string; objectKey: string }[] = [];
  public deleteObjectCalls: { bucket: string; objectKey: string }[] = [];

  public async putObject(params: { objectKey: string }) {
    this.putCalls.push(params);
    return { storageBucket: "docs", storageKey: params.objectKey };
  }

  public async getObject(params: { bucket: string; objectKey: string }): Promise<Uint8Array> {
    this.getObjectCalls.push(params);
    return new TextEncoder().encode("hello world");
  }

  public async deleteObject(params: { bucket: string; objectKey: string }) {
    this.deleteObjectCalls.push(params);
  }
}

class FakeParserRegistry {
  public isSupported(filename: string) {
    return filename.endsWith(".txt");
  }
}

class FakeIngestionService {
  public ingestCalls: Record<string, unknown>[] = [];
  public previewCalls: Record<string, unknown>[] = [];

  public async ingestDocument(params: Record<string, unknown>) {
    this.ingestCalls.push(params);
    return {
      chunkCount: 1,
      contentChecksum: "a".repeat(64),
      documentStatus: "indexed",
      embeddedCount: params.forceFull === true ? 1 : 0,
      embeddingModelCode: "doubao-embedding-vision-251215",
      errorMessage: null,
      importJobStatus: "completed",
      indexStatus: "success",
      parseStatus: "success",
      totalCharCount: 11,
    };
  }

  public async previewDocumentChunks(params: Record<string, unknown>) {
    this.previewCalls.push(params);
    return [
      {
        captionText: null,
        chunkId: "101-0",
        chunkIndex: 0,
        chunkType: "paragraph",
        documentId: "101",
        embeddingText: "heading\npreview text",
        fileName: "note.txt",
        headingPath: ["heading"],
        orderInSection: 0,
        pageNo: 1,
        pictureDescription: null,
        sectionId: "section-1",
        sourceType: "txt",
        tenantId: null,
        text: "preview text",
      },
    ];
  }
}

class FakeQdrantVectorRepository {
  public deleteDocumentIds: string[] = [];
  public callOrder: string[] = [];
  public failDelete = false;
  public points = new Map<string, string[]>();

  public async deleteByDocument(documentId: string) {
    this.callOrder.push("qdrant.deleteByDocument");
    if (this.failDelete) {
      throw new Error("qdrant delete failed");
    }
    this.deleteDocumentIds.push(documentId);
    this.points.set(documentId, []);
  }

  public async listPointIdsByDocument(documentId: string) {
    return [...(this.points.get(documentId) ?? [])];
  }
}

class FakeDocumentChunkRepository {
  public findByDocumentIdCalls: string[] = [];
  public findByDocumentIdAndChunkIdCalls: { documentId: string; chunkId: string }[] = [];
  public logicalDeleteCalls: string[] = [];
  public emptyFindByDocumentId = false;
  public includeEditedChunkInList = false;
  private readonly findByDocumentIdAndChunkIdRound = new Map<string, number>();

  public async logicalDeleteByDocument(documentId: string) {
    this.logicalDeleteCalls.push(documentId);
  }

  public async findByDocumentId(documentId: string) {
    this.findByDocumentIdCalls.push(documentId);
    if (this.emptyFindByDocumentId) {
      return [];
    }
    const rows = [
      {
        caption_text: null,
        char_count: 10,
        chunk_id: `${documentId}-0`,
        chunk_index: 0,
        chunk_type: "paragraph",
        document_id: documentId,
        embedding_text: "heading\nsaved text",
        heading_path: '["heading"]',
        order_in_section: 0,
        page_no: 1,
        picture_description: null,
        recall_count: 3,
        section_id: "section-1",
        text_content: "saved text",
      },
    ];
    if (this.includeEditedChunkInList) {
      rows.push({
        ...rows[0],
        chunk_id: `${documentId}-2`,
        chunk_index: 2,
        text_content: "old text",
      });
    }
    return rows;
  }

  public async findByDocumentIdAndChunkId(documentId: string, chunkId: string) {
    this.findByDocumentIdAndChunkIdCalls.push({ chunkId, documentId });
    const key = `${documentId}:${chunkId}`;
    const round = (this.findByDocumentIdAndChunkIdRound.get(key) ?? 0) + 1;
    this.findByDocumentIdAndChunkIdRound.set(key, round);
    const textContent = round >= 2 ? "new text" : "old text";
    return {
      caption_text: null,
      char_count: textContent.length,
      chunk_id: chunkId,
      chunk_index: 2,
      chunk_type: "paragraph",
      document_id: documentId,
      embedding_text: `heading\n${textContent}`,
      file_name: "note.txt",
      heading_path: '["heading"]',
      order_in_section: 0,
      page_no: 1,
      picture_description: null,
      recall_count: 0,
      section_id: "section-1",
      source_type: "text/plain",
      text_content: textContent,
    };
  }

  public async findByChunkId(chunkId: string) {
    return {
      caption_text: null,
      char_count: 10,
      chunk_id: chunkId,
      chunk_index: 0,
      chunk_type: "paragraph",
      doc_type: "manual",
      document_id: "101",
      embedding_text: "internal embedding text",
      file_name: "note.txt",
      heading_path: '["heading"]',
      lang: "zh",
      order_in_section: 0,
      page_no: 1,
      picture_description: null,
      recall_count: 3,
      section_id: "section-1",
      source_type: "text/plain",
      tags_json: '["guide"]',
      text_content: "saved text",
    };
  }
}

class FakeVectorizationService {
  public upsertCalls: TextChunkRecord[] = [];
  public generationCalls: {
    documentId: string;
    chunks: TextChunkRecord[];
    options?: Record<string, unknown>;
  }[] = [];

  public async indexDocumentChunk(chunk: TextChunkRecord) {
    this.upsertCalls.push(chunk);
  }

  public async indexDocumentChunks(documentId: string, chunks: TextChunkRecord[], options?: Record<string, unknown>) {
    this.generationCalls.push({ chunks, documentId, options });
    return { embeddedCount: 0, forceFull: false };
  }
}

class FakeVectorReconcileService {
  public scheduleCalls: { documentId: string; reason: string }[] = [];

  public async scheduleReconcile(documentId: string, reason: string) {
    this.scheduleCalls.push({ documentId, reason });
  }

  public async reconcileDocument(documentId: string) {
    return { documentId };
  }
}

class FakeDocumentPlatformSyncService {
  public ensureCalls: { documentId: string; syncContext?: unknown }[] = [];

  public async ensureDocumentAvailable(documentId: string, syncContext?: unknown) {
    this.ensureCalls.push({ documentId, syncContext });
  }
}

class FakeKbTransactionRunner {
  public transactionCalls = 0;

  public async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return fn();
  }
}

function createDocumentService(
  overrides: {
    documentRepository?: FakeDocumentRepository;
    objectStorageService?: FakeObjectStorageService;
    ingestionService?: FakeIngestionService;
    qdrantVectorRepository?: FakeQdrantVectorRepository;
    documentChunkRepository?: FakeDocumentChunkRepository;
    vectorizationService?: FakeVectorizationService;
    vectorReconcileService?: FakeVectorReconcileService;
    ingestScheduler?: InMemoryIngestScheduler;
    asyncEnabled?: boolean;
    importJobRepository?: FakeImportJobRepository;
    transactionRunner?: FakeKbTransactionRunner;
  } = {},
) {
  return new DocumentService(
    makeMockAppConfig({ ingestionAsyncEnabled: overrides.asyncEnabled ?? true }),
    (overrides.documentRepository ?? new FakeDocumentRepository()) as never,
    (overrides.importJobRepository ?? new FakeImportJobRepository()) as never,
    (overrides.objectStorageService ?? new FakeObjectStorageService()) as never,
    new FakeParserRegistry() as never,
    (overrides.ingestionService ?? new FakeIngestionService()) as never,
    (overrides.qdrantVectorRepository ?? new FakeQdrantVectorRepository()) as never,
    (overrides.documentChunkRepository ?? new FakeDocumentChunkRepository()) as never,
    (overrides.vectorizationService ?? new FakeVectorizationService()) as never,
    (overrides.vectorReconcileService ?? new FakeVectorReconcileService()) as never,
    new FakeDocumentPlatformSyncService() as never,
    overrides.ingestScheduler ?? new InMemoryIngestScheduler(),
    (overrides.transactionRunner ?? new FakeKbTransactionRunner()) as never,
  );
}

describe("DocumentService", () => {
  test("W3.3-H1: upload returns without requiring document indexed", async () => {
    const objectStorageService = new FakeObjectStorageService();
    const ingestionService = new FakeIngestionService();
    const documentRepository = new FakeDocumentRepository();
    const importJobRepository = new FakeImportJobRepository();
    const ingestScheduler = new InMemoryIngestScheduler();
    const transactionRunner = new FakeKbTransactionRunner();
    const service = createDocumentService({
      documentRepository,
      importJobRepository,
      ingestScheduler,
      ingestionService,
      objectStorageService,
      transactionRunner,
    });

    const file = new File(["hello world"], "note.txt", { type: "text/plain" });
    const result = await service.uploadDocument(file, "10", {
      chunkOverlap: 32,
      chunkSize: 256,
      separator: "###",
      tableChunkMode: "row",
      textChunkMode: "block",
    } as never);

    expect(String(result.documentId)).toBe("101");
    expect(result.importJobId).toBe("202");
    expect(transactionRunner.transactionCalls).toBe(1);
    expect(result.supportedForParsing).toBe(true);
    expect(result.status).toBe("parsing");
    expect(result.status).not.toBe("indexed");
    expect(objectStorageService.putCalls).toHaveLength(1);
    expect(ingestionService.ingestCalls).toHaveLength(0);
    expect(ingestScheduler.events).toHaveLength(1);
    expect(ingestScheduler.events[0]?.documentId).toBe("101");
    expect(ingestScheduler.events[0]?.importJobId).toBe("202");
    expect(ingestScheduler.events[0]?.forceFull).toBeUndefined();
    expect(ingestScheduler.events[0]?.chunkSize).toBe(256);
    expect(String(documentRepository.createCalls.at(0)?.directory_id)).toBe("10");
    expect(documentRepository.updateCalls.at(-1)?.status).toBe("parsing");
    expect(importJobRepository.updates.at(-1)?.status).toBe("pending");
  });

  test("async upload compensates object storage when the transactional enqueue fails", async () => {
    const objectStorageService = new FakeObjectStorageService();
    const transactionRunner = new FakeKbTransactionRunner();
    const failingScheduler = {
      async schedule(): Promise<void> {
        throw new Error("outbox insert failed");
      },
    };
    const service = createDocumentService({
      ingestScheduler: failingScheduler as never,
      objectStorageService,
      transactionRunner,
    });

    await expect(service.uploadDocument(new File(["hello"], "note.txt", { type: "text/plain" }), "10")).rejects.toThrow(
      "outbox insert failed",
    );
    expect(transactionRunner.transactionCalls).toBe(1);
    expect(objectStorageService.deleteObjectCalls).toHaveLength(1);
    expect(objectStorageService.deleteObjectCalls[0]?.bucket).toBe("docs");
  });

  test("sync fallback still ingests when async flag is off", async () => {
    const ingestionService = new FakeIngestionService();
    const service = createDocumentService({ asyncEnabled: false, ingestionService });
    const file = new File(["hello world"], "note.txt", { type: "text/plain" });
    const result = await service.uploadDocument(file, "10");
    expect(result.status).toBe("indexed");
    expect(ingestionService.ingestCalls).toHaveLength(1);
  });

  test("W3.1-H3: MySQL logicalDelete first then clears vectors (no orphan on success)", async () => {
    const objectStorageService = new FakeObjectStorageService();
    const qdrantVectorRepository = new FakeQdrantVectorRepository();
    qdrantVectorRepository.points.set("101", ["orphan-point"]);
    const documentRepository = new FakeDocumentRepository();
    const chunkRepository = new FakeDocumentChunkRepository();
    const service = createDocumentService({
      documentChunkRepository: chunkRepository,
      documentRepository,
      objectStorageService,
      qdrantVectorRepository,
    });

    await service.deleteDocument("101");

    expect(documentRepository.logicalDeleteCalls).toEqual(["101"]);
    expect(chunkRepository.logicalDeleteCalls).toEqual(["101"]);
    expect(documentRepository.callOrder[0]).toBe("mysql.logicalDelete");
    expect(qdrantVectorRepository.callOrder[0]).toBe("qdrant.deleteByDocument");
    expect(qdrantVectorRepository.deleteDocumentIds).toEqual(["101"]);
    expect(await qdrantVectorRepository.listPointIdsByDocument("101")).toEqual([]);
    expect(objectStorageService.deleteObjectCalls).toEqual([{ bucket: "docs", objectKey: "2002" }]);
  });

  test("delete schedules reconcile when Qdrant delete fails after MySQL delete", async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository();
    qdrantVectorRepository.failDelete = true;
    const reconcile = new FakeVectorReconcileService();
    const service = createDocumentService({ qdrantVectorRepository, vectorReconcileService: reconcile });

    await service.deleteDocument("101");

    expect(reconcile.scheduleCalls).toEqual([{ documentId: "101", reason: "DELETE_DOCUMENT" }]);
  });

  test("previews upload via ingestion preview and existing document via stored chunks", async () => {
    const ingestionService = new FakeIngestionService();
    const chunkRepository = new FakeDocumentChunkRepository();
    const service = createDocumentService({ documentChunkRepository: chunkRepository, ingestionService });

    const file = new File(["hello world"], "note.txt", { type: "text/plain" });
    const preview = await service.previewDocumentChunks(file, {
      chunkOverlap: 10,
      chunkSize: 100,
      separator: "###",
      textChunkMode: "block",
    } as never);
    const previewById = await service.previewDocumentChunksById("101");

    expect(preview.items[0]?.text).toBe("preview text");
    expect(previewById.items[0]?.text).toBe("saved text");
    expect(ingestionService.previewCalls).toHaveLength(1);
    expect(ingestionService.previewCalls[0]?.chunkingOptions).toEqual({
      chunkOverlap: 10,
      chunkSize: 100,
      separator: "###",
      tableChunkMode: "auto",
      textChunkMode: "block",
    });
    expect(chunkRepository.findByDocumentIdCalls).toEqual(["101"]);
  });

  test("previewById synchronously returns a read-only split when no persisted chunks exist", async () => {
    const ingestionService = new FakeIngestionService();
    const chunkRepository = new FakeDocumentChunkRepository();
    chunkRepository.emptyFindByDocumentId = true;
    const documentRepository = new FakeDocumentRepository();
    documentRepository.findByIdResult = {
      chunk_overlap: 24,
      chunk_separator: "###",
      chunk_size: 512,
      error_message: null,
      id: "101",
      index_status: "pending",
      mime_type: "text/plain",
      name: "note.txt",
      parse_status: "pending",
      status: "parsing",
      storage_bucket: "docs",
      storage_key: "stored-note",
      table_chunk_mode: "row",
      tenant_id: "1",
      text_chunk_mode: "block",
    };
    const objectStorageService = new FakeObjectStorageService();
    const service = createDocumentService({
      documentChunkRepository: chunkRepository,
      documentRepository,
      ingestionService,
      objectStorageService,
    });

    const previewById = await service.previewDocumentChunksById("101");

    expect(chunkRepository.findByDocumentIdCalls).toEqual(["101"]);
    expect(objectStorageService.getObjectCalls).toEqual([{ bucket: "docs", objectKey: "stored-note" }]);
    expect(ingestionService.previewCalls).toHaveLength(1);
    expect(ingestionService.previewCalls[0]?.chunkingOptions).toEqual({
      chunkOverlap: 24,
      chunkSize: 512,
      separator: "###",
      tableChunkMode: "row",
      textChunkMode: "block",
    });
    expect(previewById.items[0]?.text).toBe("preview text");
    expect(previewById.chunkCount).toBe(1);
    expect(previewById.previewStatus).toBe("ready");
  });

  test("previewById preserves a failed terminal state without polling or duplicate parsing", async () => {
    const ingestionService = new FakeIngestionService();
    const chunkRepository = new FakeDocumentChunkRepository();
    chunkRepository.emptyFindByDocumentId = true;
    const documentRepository = new FakeDocumentRepository();
    documentRepository.findByIdResult = {
      error_message: "docling request failed",
      id: "101",
      index_status: "failed",
      mime_type: "application/pdf",
      name: "failed.pdf",
      parse_status: "failed",
      status: "failed",
      storage_bucket: "docs",
      storage_key: "failed-pdf",
      tenant_id: "1",
    };
    const objectStorageService = new FakeObjectStorageService();
    const service = createDocumentService({
      documentChunkRepository: chunkRepository,
      documentRepository,
      ingestionService,
      objectStorageService,
    });

    const previewById = await service.previewDocumentChunksById("101");

    expect(previewById).toEqual(
      expect.objectContaining({
        chunkCount: 0,
        documentStatus: "failed",
        errorMessage: "docling request failed",
        indexStatus: "failed",
        items: [],
        parseStatus: "failed",
        previewStatus: "failed",
      }),
    );
    expect(objectStorageService.getObjectCalls).toEqual([]);
    expect(ingestionService.previewCalls).toHaveLength(0);
  });

  test("returns chunk source detail without internal embedding text", async () => {
    const service = createDocumentService({ documentChunkRepository: new FakeDocumentChunkRepository() });

    const detail = await service.getDocumentChunkDetail("101-0");

    expect(detail).toEqual(
      expect.objectContaining({
        chunkId: "101-0",
        documentId: "101",
        fileName: "note.txt",
        pageNo: 1,
        sectionId: "section-1",
        text: "saved text",
      }),
    );
    expect("embeddingText" in detail).toBe(false);
  });

  test("metadata/ACL updates use a versioned payload refresh instead of leaving active chunks stale", async () => {
    const documentRepository = new FakeDocumentRepository();
    const vectorizationService = new FakeVectorizationService();
    const service = createDocumentService({ documentRepository, vectorizationService });

    const result = await service.updateDocumentMetadata("101", {
      aclGroupIds: ["eng"],
      docType: "manual",
      tags: ["guide"],
    });

    expect(result.id).toBe("101");
    expect(documentRepository.updateCalls).toHaveLength(0);
    expect(vectorizationService.generationCalls).toHaveLength(1);
    expect(vectorizationService.generationCalls[0]?.chunks[0]?.aclGroupIds).toEqual(["eng"]);
    expect(vectorizationService.generationCalls[0]?.options?.documentPatchOnActivate).toEqual({
      acl_group_ids_json: '["eng"]',
      doc_type: "manual",
      tags_json: '["guide"]',
    });
  });

  test("lists stored chunks and updates one chunk text through vectorization service", async () => {
    const chunkRepository = new FakeDocumentChunkRepository();
    chunkRepository.includeEditedChunkInList = true;
    const vectorizationService = new FakeVectorizationService();
    const service = createDocumentService({ documentChunkRepository: chunkRepository, vectorizationService });

    const list = await service.listDocumentChunks("101");
    const updated = await service.updateDocumentChunk("101", "101-2", "new text");

    expect(list.items[0]?.chunkId).toBe("101-0");
    expect(chunkRepository.findByDocumentIdCalls).toEqual(["101", "101"]);
    expect(vectorizationService.generationCalls[0]?.chunks.find((chunk) => chunk.chunkId === "101-2")).toEqual(
      expect.objectContaining({
        chunkId: "101-2",
        embeddingText: "heading\nnew text",
        text: "new text",
      }),
    );
    expect(updated.text).toBe("new text");
  });

  test("W3.5: reindex defaults to incremental (forceFull=false) when model unchanged", async () => {
    const ingestionService = new FakeIngestionService();
    const documentRepository = new FakeDocumentRepository();
    const service = createDocumentService({ asyncEnabled: false, documentRepository, ingestionService });

    await service.reindexDocument("101");

    expect(ingestionService.ingestCalls[0]?.forceFull).toBe(false);
    expect(documentRepository.updateCalls.at(-1)).toEqual(
      expect.objectContaining({
        content_checksum: "a".repeat(64),
        embedding_model_code: "doubao-embedding-vision-251215",
      }),
    );
  });

  test("W3.5-H3: reindex forces full when stored embedding_model_code differs", async () => {
    const ingestionService = new FakeIngestionService();
    const documentRepository = new FakeDocumentRepository();
    documentRepository.findByIdResult = {
      content_checksum: "a".repeat(64),
      embedding_model_code: "old-model",
      error_message: null,
      extension: "txt",
      id: "101",
      index_status: "success",
      mime_type: "text/plain",
      name: "note.txt",
      parse_status: "success",
      size: 12,
      status: "indexed",
      storage_bucket: "docs",
      storage_key: "2002",
      tenant_id: null,
    };
    const service = createDocumentService({ asyncEnabled: false, documentRepository, ingestionService });

    await service.reindexDocument("101");

    expect(ingestionService.ingestCalls[0]?.forceFull).toBe(true);
  });

  test("W3.5: reindexOptions.forceFull=true is forwarded", async () => {
    const ingestionService = new FakeIngestionService();
    const service = createDocumentService({ asyncEnabled: false, ingestionService });

    await service.reindexDocument("101", undefined, undefined, { forceFull: true });

    expect(ingestionService.ingestCalls[0]?.forceFull).toBe(true);
  });

  test("W3.5: async reindex forwards forceFull onto ingest queue", async () => {
    const ingestScheduler = new InMemoryIngestScheduler();
    const objectStorageService = new FakeObjectStorageService();
    const service = createDocumentService({ ingestScheduler, objectStorageService });

    await service.reindexDocument("101", undefined, undefined, { forceFull: true });

    expect(ingestScheduler.events).toHaveLength(1);
    expect(ingestScheduler.events[0]?.forceFull).toBe(true);
    expect(objectStorageService.getObjectCalls).toEqual([]);
  });
});
