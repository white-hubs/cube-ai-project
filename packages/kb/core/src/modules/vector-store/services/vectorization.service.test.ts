import { describe, expect, test } from "bun:test";

import { type TextChunkRecord } from "../../common/document-types";
import { type EmbeddingContext, type EmbeddingProvider, type EmbeddingVector } from "../infrastructure/embeddings/embedding-provider";
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

  public async ensureCollection(): Promise<void> {
    this.ensured = true;
  }

  public async upsert(points: { id: string | number; payload: Record<string, unknown>; vectors: EmbeddingVector }[]): Promise<void> {
    this.upsertCalls.push(points);
  }
}

class FakeDocumentChunkRepository {
  public replaceCalls: { documentId: string; chunks: TextChunkRecord[] }[] = [];
  public updateCalls: TextChunkRecord[] = [];

  public async replaceDocumentChunks(documentId: string, chunks: TextChunkRecord[]): Promise<void> {
    this.replaceCalls.push({ chunks, documentId });
  }

  public async updateDocumentChunk(chunk: TextChunkRecord): Promise<void> {
    this.updateCalls.push(chunk);
  }
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

describe("VectorizationService", () => {
  test("uses stable legal qdrant point ids while preserving business chunkId in payload", async () => {
    const embeddingProvider = new FakeEmbeddingProvider();
    const qdrantVectorRepository = new FakeQdrantVectorRepository();
    const documentChunkRepository = new FakeDocumentChunkRepository();
    const service = new VectorizationService(embeddingProvider, qdrantVectorRepository as never, documentChunkRepository as never);

    const chunks: TextChunkRecord[] = [
      {
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
      },
    ];

    await service.indexDocumentChunks("67", chunks);
    await service.indexDocumentChunks("67", chunks);

    expect(qdrantVectorRepository.ensured).toBe(true);
    expect(embeddingProvider.inputs).toEqual([["heading\ndisplay text"], ["heading\ndisplay text"]]);
    expect(qdrantVectorRepository.upsertCalls).toHaveLength(2);
    expect(qdrantVectorRepository.upsertCalls[0]?.[0]?.payload.chunkId).toBe("67-0");
    expect(qdrantVectorRepository.upsertCalls[0]?.[0]?.payload.text).toBe("display text");
    expect(qdrantVectorRepository.upsertCalls[0]?.[0]?.payload.embeddingText).toBe("heading\ndisplay text");
    expect(qdrantVectorRepository.upsertCalls[0]?.[0]?.vectors).toEqual({
      dense: [0.1, 0.2, 0.3],
      sparse: { indices: [1, 2], values: [0.9, 0.4] },
    });
    expect(embeddingProvider.contexts[0]).toEqual([{ chunkType: "paragraph", retrievalProfile: "semantic-qa", sourceType: "txt" }]);
    expect(qdrantVectorRepository.upsertCalls[0]?.[0]?.payload.sheetName).toBeNull();
    expect(String(qdrantVectorRepository.upsertCalls[0]?.[0]?.id)).toMatch(UUID_V4_PATTERN);
    expect(qdrantVectorRepository.upsertCalls[1]?.[0]?.id).toBe(qdrantVectorRepository.upsertCalls[0]?.[0]?.id);
    expect(documentChunkRepository.replaceCalls).toHaveLength(2);
  });

  test("reindexes a single edited chunk without replacing whole document", async () => {
    const embeddingProvider = new FakeEmbeddingProvider();
    const qdrantVectorRepository = new FakeQdrantVectorRepository();
    const documentChunkRepository = new FakeDocumentChunkRepository();
    const service = new VectorizationService(embeddingProvider, qdrantVectorRepository as never, documentChunkRepository as never);

    const chunk: TextChunkRecord = {
      captionText: null,
      chunkId: "67-2",
      chunkIndex: 2,
      chunkType: "paragraph",
      cueIndex: null,
      documentId: "67",
      embeddingText: "heading\nedited text",
      endTime: null,
      fileName: "demo.txt",
      headers: undefined,
      headingPath: ["heading"],
      keywords: undefined,
      orderInSection: 1,
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
      text: "edited text",
    };

    await service.indexDocumentChunk(chunk);

    expect(embeddingProvider.inputs).toEqual([["heading\nedited text"]]);
    expect(qdrantVectorRepository.upsertCalls).toHaveLength(1);
    expect(documentChunkRepository.updateCalls).toEqual([chunk]);
    expect(documentChunkRepository.replaceCalls).toHaveLength(0);
  });
});
