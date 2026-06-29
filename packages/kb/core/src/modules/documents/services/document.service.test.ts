import { describe, expect, test } from "bun:test";

import { makeMockAppConfig } from "../../../test-helpers/mock-app-config";
import { type TextChunkRecord } from "../../common/document-types";
import { DocumentService } from "./document.service";

class FakeDocumentRepository {
  public createCalls: Record<string, unknown>[] = [];
  public updateCalls: Record<string, unknown>[] = [];

  public async createDocument(payload: Record<string, unknown>) {
    this.createCalls.push(payload);
    return {
      id: 101,
      ...payload,
    };
  }

  public async findById(id: string) {
    return {
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
    };
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

  public async logicalDelete() {
    return true;
  }
}

class FakeImportJobRepository {
  public async createJob(payload: Record<string, unknown>) {
    return {
      id: "202",
      ...payload,
    };
  }

  public async update() {
    return {
      id: "202",
      status: "completed",
    };
  }
}

class FakeObjectStorageService {
  public putCalls: { objectKey: string }[] = [];
  public deleteObjectCalls: { bucket: string; objectKey: string }[] = [];

  public async putObject(params: { objectKey: string }) {
    this.putCalls.push(params);
    return { storageBucket: "docs", storageKey: params.objectKey };
  }

  public async getObject(params: { bucket: string; objectKey: string }): Promise<Uint8Array> {
    void params;
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
      documentStatus: "indexed",
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

  public async deleteByDocument(documentId: string) {
    this.deleteDocumentIds.push(documentId);
  }
}

class FakeDocumentChunkRepository {
  public findByDocumentIdCalls: string[] = [];
  public findByDocumentIdAndChunkIdCalls: { documentId: string; chunkId: string }[] = [];
  private readonly findByDocumentIdAndChunkIdRound = new Map<string, number>();

  public async findByDocumentId(documentId: string) {
    this.findByDocumentIdCalls.push(documentId);
    return [
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
}

class FakeVectorizationService {
  public upsertCalls: TextChunkRecord[] = [];

  public async indexDocumentChunk(chunk: TextChunkRecord) {
    this.upsertCalls.push(chunk);
  }
}

class FakeDocumentPlatformSyncService {
  public ensureCalls: { documentId: string; syncContext?: unknown }[] = [];

  public async ensureDocumentAvailable(documentId: string, syncContext?: unknown) {
    this.ensureCalls.push({ documentId, syncContext });
  }
}

describe("DocumentService", () => {
  test("uploads supported files to storage and triggers ingestion", async () => {
    const objectStorageService = new FakeObjectStorageService();
    const ingestionService = new FakeIngestionService();
    const documentRepository = new FakeDocumentRepository();
    const service = new DocumentService(
      makeMockAppConfig(),
      documentRepository as never,
      new FakeImportJobRepository() as never,
      objectStorageService as never,
      new FakeParserRegistry() as never,
      ingestionService as never,
      new FakeQdrantVectorRepository() as never,
      new FakeDocumentChunkRepository() as never,
      new FakeVectorizationService() as never,
      new FakeDocumentPlatformSyncService() as never,
    );

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
    expect(result.supportedForParsing).toBe(true);
    expect(result.status).toBe("indexed");
    expect(objectStorageService.putCalls).toHaveLength(1);
    expect(ingestionService.ingestCalls).toHaveLength(1);
    expect(String(documentRepository.createCalls.at(0)?.directory_id)).toBe("10");
    expect(ingestionService.ingestCalls[0]?.chunkingOptions).toEqual({
      chunkOverlap: 32,
      chunkSize: 256,
      separator: "###",
      tableChunkMode: "row",
      textChunkMode: "block",
    });
  });

  test("deletes object and vector data when deleting a document", async () => {
    const objectStorageService = new FakeObjectStorageService();
    const qdrantVectorRepository = new FakeQdrantVectorRepository();
    const service = new DocumentService(
      makeMockAppConfig(),
      new FakeDocumentRepository() as never,
      new FakeImportJobRepository() as never,
      objectStorageService as never,
      new FakeParserRegistry() as never,
      new FakeIngestionService() as never,
      qdrantVectorRepository as never,
      new FakeDocumentChunkRepository() as never,
      new FakeVectorizationService() as never,
      new FakeDocumentPlatformSyncService() as never,
    );

    await service.deleteDocument("101");

    expect(objectStorageService.deleteObjectCalls).toEqual([{ bucket: "docs", objectKey: "2002" }]);
    expect(qdrantVectorRepository.deleteDocumentIds).toEqual(["101"]);
  });

  test("previews upload via ingestion preview and existing document via stored chunks", async () => {
    const ingestionService = new FakeIngestionService();
    const chunkRepository = new FakeDocumentChunkRepository();
    const service = new DocumentService(
      makeMockAppConfig(),
      new FakeDocumentRepository() as never,
      new FakeImportJobRepository() as never,
      new FakeObjectStorageService() as never,
      new FakeParserRegistry() as never,
      ingestionService as never,
      new FakeQdrantVectorRepository() as never,
      chunkRepository as never,
      new FakeVectorizationService() as never,
      new FakeDocumentPlatformSyncService() as never,
    );

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

  test("lists stored chunks and updates one chunk text through vectorization service", async () => {
    const chunkRepository = new FakeDocumentChunkRepository();
    const vectorizationService = new FakeVectorizationService();
    const service = new DocumentService(
      makeMockAppConfig(),
      new FakeDocumentRepository() as never,
      new FakeImportJobRepository() as never,
      new FakeObjectStorageService() as never,
      new FakeParserRegistry() as never,
      new FakeIngestionService() as never,
      new FakeQdrantVectorRepository() as never,
      chunkRepository as never,
      vectorizationService as never,
      new FakeDocumentPlatformSyncService() as never,
    );

    const list = await service.listDocumentChunks("101");
    const updated = await service.updateDocumentChunk("101", "101-2", "new text");

    expect(list.items[0]?.chunkId).toBe("101-0");
    expect(chunkRepository.findByDocumentIdCalls).toEqual(["101"]);
    expect(vectorizationService.upsertCalls[0]).toEqual(
      expect.objectContaining({
        chunkId: "101-2",
        embeddingText: "heading\nnew text",
        text: "new text",
      }),
    );
    expect(updated.text).toBe("new text");
  });
});
