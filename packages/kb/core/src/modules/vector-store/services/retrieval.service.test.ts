import { describe, expect, test } from "bun:test";

import { makeMockAppConfig } from "../../../test-helpers/mock-app-config";
import { type EmbeddingProvider, type EmbeddingVector } from "../infrastructure/embeddings/embedding-provider";
import { type QdrantSearchResult, type QdrantVectorRepository } from "../infrastructure/qdrant/qdrant-vector.repository";
import { RetrievalService } from "./retrieval.service";
type MergeSources<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer R) => void ? R : never;

function mergeObject<T extends object, S extends readonly object[]>(target: T, ...sources: S): T & MergeSources<S[number]> {
  const clone = { ...target } as T & MergeSources<S[number]>;
  return Object.assign(clone, ...sources);
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  public readonly dimension = 3;
  public readonly inputs: string[][] = [];

  public async embed(input: string[]): Promise<EmbeddingVector[]> {
    this.inputs.push(input);
    return input.map(() => ({
      dense: [0.1, 0.2, 0.3],
      sparse: { indices: [1, 2], values: [0.8, 0.6] },
    }));
  }
}

class EmptyEmbeddingProvider implements EmbeddingProvider {
  public readonly dimension = 3;

  public async embed(): Promise<EmbeddingVector[]> {
    return [{ dense: [], sparse: null }];
  }
}

class FakeQdrantVectorRepository {
  public readonly searchCalls: Record<string, unknown>[] = [];
  public async ensureCollection(): Promise<void> {}

  public async upsert(): Promise<void> {}

  public async search(params: {
    topK: number;
    denseVector?: number[];
    sparseVector?: { indices: number[]; values: number[] } | null;
    documentId?: string;
    documentIds?: string[];
    scoreThreshold?: number;
  }): Promise<QdrantSearchResult[]> {
    this.searchCalls.push({ ...params });
    const docId = params.documentId === undefined ? undefined : String(params.documentId);
    if (Array.isArray(params.documentIds)) {
      return [
        {
          id: "chunk-A",
          payload: {
            captionText: null,
            chunkId: "chunk-A",
            chunkIndex: 0,
            chunkType: "paragraph",
            documentId: "2",
            embeddingText: "Dir2 title\nDir2 heading body",
            fileName: "a.md",
            headingPath: ["Dir2 title"],
            orderInSection: 0,
            pageNo: 2,
            pictureDescription: null,
            sectionId: "section-b",
            sourceType: "md",
            text: "Dir2 heading body",
          },
          score: 0.9,
        },
        {
          id: "chunk-C",
          payload: {
            captionText: null,
            chunkId: "chunk-C",
            chunkIndex: 2,
            chunkType: "paragraph",
            documentId: "2",
            embeddingText: "Dir2 title\nDir2 later body",
            fileName: "c.md",
            headingPath: ["Dir2 appendix"],
            orderInSection: 2,
            pageNo: 3,
            pictureDescription: null,
            sectionId: "section-c",
            sourceType: "md",
            text: "Dir2 later body",
          },
          score: 0.5,
        },
        {
          id: "chunk-B",
          payload: {
            captionText: null,
            chunkId: "chunk-B",
            chunkIndex: 1,
            chunkType: "paragraph",
            documentId: "1",
            embeddingText: "Dir1 title\nDir1 supporting body",
            fileName: "b.md",
            headingPath: ["Dir1 title"],
            orderInSection: 1,
            pageNo: 1,
            pictureDescription: null,
            sectionId: "section-a",
            sourceType: "md",
            text: "Dir1 supporting body",
          },
          score: 0.29,
        },
      ];
    }
    if (docId === "1") {
      return [
        {
          id: "chunk-A",
          payload: {
            captionText: null,
            chunkId: "chunk-A",
            chunkIndex: 0,
            chunkType: "paragraph",
            documentId: "1",
            embeddingText: "Dir1 title\nDir1 heading body",
            fileName: "a.md",
            headingPath: ["Dir1 title"],
            orderInSection: 0,
            pageNo: 1,
            pictureDescription: null,
            sectionId: "section-a",
            sourceType: "md",
            text: "Dir1 heading body",
          },
          score: 0.4,
        },
        {
          id: "chunk-B",
          payload: {
            captionText: null,
            chunkId: "chunk-B",
            chunkIndex: 1,
            chunkType: "paragraph",
            documentId: "1",
            embeddingText: "Dir1 title\nDir1 supporting body",
            fileName: "b.md",
            headingPath: ["Dir1 title"],
            orderInSection: 1,
            pageNo: 1,
            pictureDescription: null,
            sectionId: "section-a",
            sourceType: "md",
            text: "Dir1 supporting body",
          },
          score: 0.3,
        },
      ].slice(0, params.topK);
    }

    if (docId === "2") {
      return [
        {
          id: "chunk-A",
          payload: {
            captionText: null,
            chunkId: "chunk-A",
            chunkIndex: 0,
            chunkType: "paragraph",
            documentId: "2",
            embeddingText: "Dir2 title\nDir2 heading body",
            fileName: "a.md",
            headingPath: ["Dir2 title"],
            orderInSection: 0,
            pageNo: 2,
            pictureDescription: null,
            sectionId: "section-b",
            sourceType: "md",
            text: "Dir2 heading body",
          },
          score: 0.9,
        },
        {
          id: "chunk-C",
          payload: {
            captionText: null,
            chunkId: "chunk-C",
            chunkIndex: 2,
            chunkType: "paragraph",
            documentId: "2",
            embeddingText: "Dir2 title\nDir2 later body",
            fileName: "c.md",
            headingPath: ["Dir2 appendix"],
            orderInSection: 2,
            pageNo: 3,
            pictureDescription: null,
            sectionId: "section-c",
            sourceType: "md",
            text: "Dir2 later body",
          },
          score: 0.5,
        },
      ].slice(0, params.topK);
    }

    // default for documentId search test
    return [
      {
        id: "chunk-1",
        payload: {
          captionText: null,
          chunkId: "chunk-1",
          chunkIndex: 0,
          chunkType: "paragraph",
          documentId: "12",
          embeddingText: "Section one\nfirst result",
          fileName: "note.md",
          headingPath: ["Section one"],
          orderInSection: 0,
          pageNo: 1,
          pictureDescription: null,
          sectionId: "section-1",
          sourceType: "md",
          text: "first result",
        },
        score: 0.98,
      },
      {
        id: "chunk-2",
        payload: {
          captionText: null,
          chunkId: "chunk-2",
          chunkIndex: 1,
          chunkType: "paragraph",
          documentId: "12",
          embeddingText: "Section one\nsecond result",
          fileName: "note.md",
          headingPath: ["Section one"],
          orderInSection: 1,
          pageNo: 1,
          pictureDescription: null,
          sectionId: "section-1",
          sourceType: "md",
          text: "second result",
        },
        score: 0.71,
      },
    ].slice(0, params.topK);
  }

  public async deleteByDocument(): Promise<void> {}
}

class FakeDocumentRepository {
  public async findIdsByDirectoryId(): Promise<string[]> {
    return ["1", "2"];
  }
}

class FakeDocumentChunkRepository {
  public readonly lexicalCalls: Record<string, unknown>[] = [];

  public async findByDocumentIdAndSectionId(documentId: string, sectionId: string) {
    if (documentId === "12" && sectionId === "section-1") {
      return [
        {
          chunk_id: "chunk-1",
          chunk_index: 0,
          chunk_type: "paragraph",
          heading_path: '["Section one"]',
          order_in_section: 0,
          page_no: 1,
          section_id: "section-1",
          text_content: "first result",
        },
        {
          chunk_id: "chunk-2",
          chunk_index: 1,
          chunk_type: "paragraph",
          heading_path: '["Section one"]',
          order_in_section: 1,
          page_no: 1,
          section_id: "section-1",
          text_content: "second result",
        },
        {
          chunk_id: "chunk-3",
          chunk_index: 2,
          chunk_type: "paragraph",
          heading_path: '["Section one"]',
          order_in_section: 2,
          page_no: 1,
          section_id: "section-1",
          text_content: "third result",
        },
        {
          chunk_id: "chunk-4",
          chunk_index: 3,
          chunk_type: "paragraph",
          heading_path: '["Section one"]',
          order_in_section: 3,
          page_no: 1,
          section_id: "section-1",
          text_content: "fourth result",
        },
      ];
    }
    if (documentId === "2" && sectionId === "section-b") {
      return [
        {
          chunk_id: "chunk-A",
          chunk_index: 0,
          chunk_type: "paragraph",
          heading_path: '["Dir2 title"]',
          order_in_section: 0,
          page_no: 2,
          section_id: "section-b",
          text_content: "Dir2 heading body",
        },
      ];
    }
    if (documentId === "2" && sectionId === "section-c") {
      return [
        {
          chunk_id: "chunk-C",
          chunk_index: 2,
          chunk_type: "paragraph",
          heading_path: '["Dir2 appendix"]',
          order_in_section: 2,
          page_no: 3,
          section_id: "section-c",
          text_content: "Dir2 later body",
        },
      ];
    }
    if (documentId === "1" && sectionId === "section-a") {
      return [
        {
          chunk_id: "chunk-A",
          chunk_index: 0,
          chunk_type: "paragraph",
          heading_path: '["Dir1 title"]',
          order_in_section: 0,
          page_no: 1,
          section_id: "section-a",
          text_content: "Dir1 heading body",
        },
        {
          chunk_id: "chunk-B",
          chunk_index: 1,
          chunk_type: "paragraph",
          heading_path: '["Dir1 title"]',
          order_in_section: 1,
          page_no: 1,
          section_id: "section-a",
          text_content: "Dir1 supporting body",
        },
      ];
    }
    if (documentId === "77" && sectionId === "sheet:sheeta") {
      return [
        {
          chunk_id: "table-prev",
          chunk_index: 0,
          chunk_type: "table-row-window",
          heading_path: '["SheetA"]',
          order_in_section: 0,
          page_no: null,
          section_id: "sheet:sheeta",
          text_content: "工作表: SheetA\n行范围: 1-1\n\n第1行: 设备编码=prev-1; 设备名称=前一条设备",
        },
        {
          chunk_id: "table-hit",
          chunk_index: 1,
          chunk_type: "table-row-window",
          heading_path: '["SheetA"]',
          order_in_section: 1,
          page_no: null,
          section_id: "sheet:sheeta",
          text_content: "工作表: SheetA\n行范围: 2-2\n\n第2行: 设备编码=5d10--35; 设备名称=研发中心6号265VBRS",
        },
        {
          chunk_id: "table-next",
          chunk_index: 2,
          chunk_type: "table-row-window",
          heading_path: '["SheetA"]',
          order_in_section: 2,
          page_no: null,
          section_id: "sheet:sheeta",
          text_content: "工作表: SheetA\n行范围: 3-3\n\n第3行: 设备编码=next-1; 设备名称=后一条设备",
        },
      ];
    }
    return [];
  }

  public async searchLexicalChunks(params: { query: string; terms: string[]; topK: number; documentId?: string; documentIds?: string[] }) {
    this.lexicalCalls.push(params);
    if (params.documentId === "77") {
      return [
        {
          caption_text: null,
          chunk_id: "table-hit",
          chunk_index: 0,
          chunk_type: "table-row-window",
          cue_index: null,
          document_id: "77",
          embedding_text:
            "文件: demo.xlsx\n工作表: SheetA\n表头: 设备编码, 设备名称\n第1行: 设备编码=5d10--35; 设备名称=研发中心6号265VBRS",
          end_time: null,
          file_name: "demo.xlsx",
          headers_text: '["设备编码","设备名称"]',
          heading_path: '["SheetA"]',
          keywords_text: '["5d10--35","研发中心6号265VBRS"]',
          lexical_score: 5,
          order_in_section: 0,
          page_no: null,
          picture_description: null,
          property_namespace: null,
          row_end: 1,
          row_start: 1,
          section_id: "sheet:sheeta",
          sheet_name: "SheetA",
          source_type: "xlsx",
          start_time: null,
          table_id: "xlsx-table-0",
          text_content: "工作表: SheetA\n行范围: 1-1",
        },
      ];
    }
    return [];
  }
}

describe("RetrievalService", () => {
  test("embeds query and returns section-aggregated search results", async () => {
    const embeddingProvider = new FakeEmbeddingProvider();
    const qdrantVectorRepository = new FakeQdrantVectorRepository();
    const service = new RetrievalService(
      makeMockAppConfig(),
      embeddingProvider,
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.search({
      documentId: "12",
      query: "hello world",
      topK: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        chunkId: "chunk-1",
        chunkIndex: 0,
        chunkType: "paragraph",
        cueIndex: null,
        documentId: "12",
        endTime: null,
        fileName: "note.md",
        headingPath: ["Section one"],
        pageNo: 1,
        propertyNamespace: null,
        rankScore: 1,
        rowEnd: null,
        rowStart: null,
        score: 1,
        sectionId: "section-1",
        sheetName: null,
        sourceType: "md",
        startTime: null,
        tableId: null,
        text: "first result\n\nsecond result",
        vectorScore: 0.98,
      }),
    );
    expect(embeddingProvider.inputs).toEqual([["hello world"]]);
    expect(qdrantVectorRepository.searchCalls[0]?.topK).toBe(20);
  });

  test("limits aggregated text to a local section window around the hit chunk", async () => {
    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      new FakeQdrantVectorRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.search({
      documentId: "12",
      query: "section one",
      topK: 2,
    });

    expect(result.items[1]?.chunkId).toBe("chunk-2");
    expect(result.items[1]?.text).toBe("first result\n\nsecond result\n\nthird result");
  });

  test("searchMultiByDocuments keeps hits when qdrant payload documentId is numeric", async () => {
    class NumericPayloadRepository extends FakeQdrantVectorRepository {
      public override async search(params: { topK: number; documentId?: string }): Promise<QdrantSearchResult[]> {
        const results = await super.search(params);
        return results.map((result) =>
          mergeObject({}, result, {
            payload: mergeObject({}, result.payload, {
              documentId: Number(result.payload.documentId) as unknown as string,
            }),
          }),
        );
      }
    }

    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      new NumericPayloadRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.searchMultiByDocuments({
      documents: [{ documentId: "2", topK: 1 }],
      query: "hello world",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.documentId).toBe("2");
    expect(result.items[0]?.chunkId).toBe("chunk-A");
  });

  test("searchByDirectory and searchMultiByDocuments share per-document scores", async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository();
    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const byDocuments = await service.searchMultiByDocuments({
      documents: [{ documentId: "2", topK: 5 }],
      query: "hello world",
    });
    const byDirectory = await service.searchByDirectory({
      directoryId: "999",
      query: "hello world",
      topK: 5,
    });

    const fromDocuments = byDocuments.items.find((item) => item.documentId === "2" && item.chunkId === "chunk-A");
    const fromDirectory = byDirectory.items.find((item) => item.documentId === "2" && item.chunkId === "chunk-A");
    expect(fromDocuments).toBeDefined();
    expect(fromDirectory).toBeDefined();
    expect(fromDocuments?.score).toBe(fromDirectory?.score);
    expect(fromDocuments?.rankScore).toBe(fromDirectory?.rankScore);
    expect(fromDocuments?.vectorScore).toBe(fromDirectory?.vectorScore);
    expect(fromDocuments?.score).toBe(1);
  });

  test("searchByDirectory merges per-document results and keeps best-ranked chunks", async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository();
    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.searchByDirectory({
      directoryId: "999",
      query: "hello world",
      topK: 2,
    });

    expect(result.items).toHaveLength(2);
    expect(qdrantVectorRepository.searchCalls).toHaveLength(2);
    expect(qdrantVectorRepository.searchCalls.map((call) => call.documentId)).toEqual(["1", "2"]);
    expect(result.items[0]?.chunkId).toBe("chunk-A");
    expect(result.items[0]?.vectorScore).toBe(0.9);
    expect(result.items[0]?.score).toBe(1);
    expect(result.items[0]?.text).toBe("Dir2 heading body");
    expect(result.items[1]?.chunkId).toBe("chunk-A");
    expect(result.items[1]?.documentId).toBe("1");
    expect(result.items[1]?.vectorScore).toBe(0.4);
  });

  test("uses prefetch and score threshold before trimming topK", async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository();
    const service = new RetrievalService(
      makeMockAppConfig({ retrievalPrefetchTopK: 6, retrievalScoreThreshold: 0.5 }),
      new FakeEmbeddingProvider(),
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.search({
      documentId: "12",
      query: "hello world",
      topK: 1,
    });

    expect(qdrantVectorRepository.searchCalls[0]?.topK).toBe(6);
    expect(qdrantVectorRepository.searchCalls[0]?.scoreThreshold).toBe(0.5);
    expect(result.items).toHaveLength(1);
  });

  test("searchByDirectory searches each document independently before global topK", async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository();
    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.searchByDirectory({
      directoryId: "999",
      query: "hello world",
      topK: 2,
    });

    expect(qdrantVectorRepository.searchCalls).toHaveLength(2);
    expect(qdrantVectorRepository.searchCalls.every((call) => call.documentId !== undefined)).toBe(true);
    expect(result.items.map((item) => `${item.documentId}:${item.chunkId}`)).toEqual(["2:chunk-A", "1:chunk-A"]);
    expect(result.items[0]?.score).toBe(1);
    expect(result.items[1]?.score).toBe(1);
  });

  test("reranks short query hits using heading and keyword matches", async () => {
    process.env.RETRIEVAL_RERANK_ENABLED = "true";
    process.env.RETRIEVAL_SCORE_THRESHOLD = "0";

    class RerankRepository extends FakeQdrantVectorRepository {
      public override async search(): Promise<QdrantSearchResult[]> {
        return [
          {
            id: "generic",
            payload: {
              captionText: null,
              chunkId: "generic",
              chunkIndex: 7,
              chunkType: "paragraph",
              documentId: "33",
              embeddingText: "整体设计\n适用于园区、医院、社区、学校、交通等行业。",
              fileName: "demo.docx",
              headingPath: ["整体设计", "适用行业"],
              orderInSection: 0,
              pageNo: null,
              pictureDescription: null,
              sectionId: "heading:整体设计-适用行业",
              sourceType: "docx",
              text: "适用于园区、医院、社区、学校、交通等行业。",
            },
            score: 0.41,
          },
          {
            id: "pain-points",
            payload: {
              captionText: null,
              chunkId: "pain-points",
              chunkIndex: 4,
              chunkType: "paragraph",
              documentId: "33",
              embeddingText: "行业背景\n行业痛点\n当前安防监控行业存在以下痛点问题：误报泛滥，人工复核成本高。",
              fileName: "demo.docx",
              headingPath: ["行业背景", "行业痛点"],
              orderInSection: 0,
              pageNo: null,
              pictureDescription: null,
              sectionId: "heading:行业背景-行业痛点",
              sourceType: "docx",
              text: "当前安防监控行业存在以下痛点问题：误报泛滥，人工复核成本高。",
            },
            score: 0.31,
          },
        ];
      }
    }

    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      new RerankRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.search({
      documentId: "33",
      query: "痛点问题",
      topK: 2,
    });

    expect(result.items[0]?.chunkId).toBe("pain-points");
    expect(result.items[0]?.rankScore ?? 0).toBeGreaterThan(result.items[0]?.vectorScore ?? 0);
    expect(result.items[0]?.vectorScore).toBe(0.31);
  });

  test("returns empty result without querying qdrant when query embedding is empty", async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository();
    const service = new RetrievalService(
      makeMockAppConfig(),
      new EmptyEmbeddingProvider(),
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.search({
      query: "empty vector",
      topK: 3,
    });

    expect(result.items).toEqual([]);
    expect(qdrantVectorRepository.searchCalls).toHaveLength(0);
  });

  test("supplements vector recall with lexical table hits", async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository();
    const documentChunkRepository = new FakeDocumentChunkRepository();
    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      documentChunkRepository as unknown as never,
    );

    const result = await service.search({
      documentId: "77",
      query: "5d10--35",
      topK: 1,
    });

    expect(documentChunkRepository.lexicalCalls).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        chunkId: "table-hit",
        chunkType: "table-row-window",
        headers: ["设备编码", "设备名称"],
        keywords: ["5d10--35", "研发中心6号265VBRS"],
        rowEnd: 1,
        rowStart: 1,
        sheetName: "SheetA",
        tableId: "xlsx-table-0",
      }),
    );
    expect(result.items[0]?.text).toBe("工作表: SheetA\n行范围: 1-1");
  });

  test("does not aggregate neighboring structured table-row-window chunks into search item text", async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository();
    const documentChunkRepository = new FakeDocumentChunkRepository();
    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      documentChunkRepository as unknown as never,
    );

    const result = await service.search({
      documentId: "77",
      query: "研发中心6号265VBRS",
      topK: 1,
    });

    expect(result.items[0]?.chunkId).toBe("table-hit");
    expect(result.items[0]?.text).toBe("工作表: SheetA\n行范围: 1-1");
    expect(result.items[0]?.text).not.toContain("前一条设备");
    expect(result.items[0]?.text).not.toContain("后一条设备");
  });

  test("type-aware rerank boosts table header and keyword matches above generic dense hits", async () => {
    process.env.RETRIEVAL_RERANK_ENABLED = "true";

    class TableAwareRepository extends FakeQdrantVectorRepository {
      public override async search(): Promise<QdrantSearchResult[]> {
        return [
          {
            id: "generic",
            payload: {
              captionText: null,
              chunkId: "generic",
              chunkIndex: 0,
              chunkType: "paragraph",
              documentId: "88",
              embeddingText: "说明\n设备整体运行分析说明",
              fileName: "demo.docx",
              headingPath: ["说明"],
              orderInSection: 0,
              pageNo: null,
              pictureDescription: null,
              sectionId: "heading:说明",
              sourceType: "docx",
              text: "设备整体运行分析说明",
            },
            score: 0.72,
          },
          {
            id: "table-hit",
            payload: {
              captionText: null,
              chunkId: "table-hit",
              chunkIndex: 1,
              chunkType: "table-row-window",
              documentId: "88",
              embeddingText:
                "文件: demo.xlsx\n工作表: SheetA\n表头: 设备编码, 设备名称\n第1行: 设备编码=5d10--35; 设备名称=研发中心6号265VBRS",
              fileName: "demo.xlsx",
              headers: ["设备编码", "设备名称"],
              headingPath: ["SheetA"],
              keywords: ["5d10--35", "研发中心6号265VBRS"],
              orderInSection: 0,
              pageNo: null,
              pictureDescription: null,
              rowEnd: 1,
              rowStart: 1,
              sectionId: "sheet:sheeta",
              sheetName: "SheetA",
              sourceType: "xlsx",
              tableId: "xlsx-table-0",
              text: "工作表: SheetA\n行范围: 1-1",
            },
            score: 0.44,
          },
        ];
      }
    }

    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      new TableAwareRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.search({
      documentId: "88",
      query: "设备编码 5d10--35",
      topK: 2,
    });

    expect(result.items[0]?.chunkId).toBe("table-hit");
    expect(result.items[0]?.rankScore ?? 0).toBeGreaterThan(result.items[0]?.vectorScore ?? 0);
  });
});
