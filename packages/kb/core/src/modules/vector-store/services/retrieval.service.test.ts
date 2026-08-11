import { describe, expect, spyOn, test } from "bun:test";

import type { RerankPort, RerankRequest, RerankResultItem } from "@cube-ai/contracts/platform";
import { tenantContextAls } from "@cube-ai/tenant-context";

import { makeMockAppConfig } from "../../../test-helpers/mock-app-config";
import { type EmbeddingProvider, type EmbeddingVector } from "../infrastructure/embeddings/embedding-provider";
import { type QdrantSearchResult, type QdrantVectorRepository } from "../infrastructure/qdrant/qdrant-vector.repository";
import { getRetrievalOperationalMetrics, resetRetrievalOperationalMetricsForTests } from "./retrieval-operational-metrics";
import { RetrievalService } from "./retrieval.service";

class CountingRerankPort implements RerankPort {
  public calls = 0;
  public lastRequest: RerankRequest | undefined;

  public constructor(
    private readonly impl: (req: RerankRequest) => RerankResultItem[] | Promise<RerankResultItem[]> = (req) =>
      req.documents.map((_, index) => ({ index, relevanceScore: 1 - index * 0.01 })),
  ) {}

  public async rerank(req: RerankRequest): Promise<RerankResultItem[]> {
    this.calls += 1;
    this.lastRequest = req;
    return this.impl(req);
  }
}
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
        rankScore: 0.98,
        rowEnd: null,
        rowStart: null,
        score: 0.98,
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
      makeMockAppConfig({ retrievalDiversificationEnabled: false }),
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

  test("W2.3: default section quota removes duplicate expanded contexts", async () => {
    const service = new RetrievalService(
      makeMockAppConfig({ retrievalDiversificationEnabled: true, retrievalMaxChunksPerSection: 1 }),
      new FakeEmbeddingProvider(),
      new FakeQdrantVectorRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.search({ documentId: "12", query: "section one", topK: 2 });
    expect(result.items.map((item) => item.chunkId)).toEqual(["chunk-1"]);
    expect(result.items).toHaveLength(1);
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
    expect(fromDocuments?.score).toBe(0.9);
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
    // 绝对相关度排序：同库 topK 优先高分，不再把每文档第一名抬到 1.0
    expect(result.items[0]?.chunkId).toBe("chunk-A");
    expect(result.items[0]?.documentId).toBe("2");
    expect(result.items[0]?.vectorScore).toBe(0.9);
    expect(result.items[0]?.score).toBe(0.9);
    expect(result.items[0]?.text).toBe("Dir2 heading body");
    expect(result.items[1]?.chunkId).toBe("chunk-C");
    expect(result.items[1]?.documentId).toBe("2");
    expect(result.items[1]?.vectorScore).toBe(0.5);
    expect(result.items[1]?.score).toBe(0.5);
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
    expect(result.items.map((item) => `${item.documentId}:${item.chunkId}`)).toEqual(["2:chunk-A", "2:chunk-C"]);
    expect(result.items[0]?.score).toBe(0.9);
    expect(result.items[1]?.score).toBe(0.5);
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

  test("drops low-quality unknown and TOC leader chunks from search results", async () => {
    class JunkRepository extends FakeQdrantVectorRepository {
      public override async search(): Promise<QdrantSearchResult[]> {
        return [
          {
            id: "good",
            payload: {
              captionText: null,
              chunkId: "good",
              chunkIndex: 1,
              chunkType: "paragraph",
              documentId: "90",
              embeddingText: "正文: 本文件必不可少的条款如下。",
              fileName: "std.pdf",
              headingPath: ["规范性引用文件"],
              orderInSection: 1,
              pageNo: 7,
              pictureDescription: null,
              sectionId: "heading:规范性引用文件",
              sourceType: "application/pdf",
              text: "本文件必不可少的条款如下。",
            },
            score: 0.55,
          },
          {
            id: "unknown",
            payload: {
              captionText: null,
              chunkId: "unknown",
              chunkIndex: 0,
              chunkType: "paragraph",
              documentId: "90",
              embeddingText: "正文: <unknown>",
              fileName: "std.pdf",
              headingPath: [],
              orderInSection: 0,
              pageNo: 1,
              pictureDescription: null,
              sectionId: "page:1",
              sourceType: "application/pdf",
              text: "<unknown>",
            },
            score: 0.7,
          },
          {
            id: "toc",
            payload: {
              captionText: null,
              chunkId: "toc",
              chunkIndex: 3,
              chunkType: "paragraph",
              documentId: "90",
              embeddingText: "正文: ………… 14",
              fileName: "std.pdf",
              headingPath: ["目次"],
              orderInSection: 0,
              pageNo: 3,
              pictureDescription: null,
              sectionId: "heading:目次",
              sourceType: "application/pdf",
              text: "…………………………………………………………………………………………………… 1 4",
            },
            score: 0.65,
          },
        ];
      }
    }

    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      new JunkRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.search({
      documentId: "90",
      query: "条款",
      topK: 10,
    });

    expect(result.items.map((item) => item.chunkId)).toEqual(["good"]);
    expect(result.items[0]?.text).toContain("条款");
  });

  test("keyword-like queries require a term match and keep absolute scores", async () => {
    class MixedRepository extends FakeQdrantVectorRepository {
      public override async search(): Promise<QdrantSearchResult[]> {
        return [
          {
            id: "with-term",
            payload: {
              captionText: null,
              chunkId: "with-term",
              chunkIndex: 0,
              chunkType: "paragraph",
              documentId: "91",
              embeddingText: "正文: 下列文件构成本文件必不可少的条款。",
              fileName: "a.pdf",
              headingPath: ["规范性引用文件"],
              orderInSection: 0,
              pageNo: 7,
              pictureDescription: null,
              sectionId: "s1",
              sourceType: "pdf",
              text: "下列文件构成本文件必不可少的条款。",
            },
            score: 0.4,
          },
          {
            id: "semantic-only",
            payload: {
              captionText: null,
              chunkId: "semantic-only",
              chunkIndex: 1,
              chunkType: "paragraph",
              documentId: "91",
              embeddingText: "正文: 设备选择和配置方案完成后应组织评审。",
              fileName: "a.pdf",
              headingPath: ["设备选择"],
              orderInSection: 1,
              pageNo: 12,
              pictureDescription: null,
              sectionId: "s2",
              sourceType: "pdf",
              text: "设备选择和配置方案完成后应组织评审。",
            },
            score: 0.8,
          },
        ];
      }
    }

    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      new MixedRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.search({
      documentId: "91",
      query: "条款",
      topK: 10,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.chunkId).toBe("with-term");
    // 绝对分：vector 0.4 + 正文精确命中 0.2，不再被抬成 1.0
    expect(result.items[0]?.vectorScore).toBe(0.4);
    expect(result.items[0]?.score).toBeGreaterThan(0.4);
    expect(result.items[0]?.score).toBeLessThan(1);
  });

  test("soft-filters cover role chunks that are indexable but not retrievable by default", async () => {
    class CoverRepository extends FakeQdrantVectorRepository {
      public override async search(): Promise<QdrantSearchResult[]> {
        return [
          {
            id: "cover",
            payload: {
              captionText: null,
              chunkId: "cover",
              chunkIndex: 0,
              chunkRole: "cover",
              chunkType: "paragraph",
              documentId: "92",
              embeddingText: "正文: 冷库安全规程",
              fileName: "a.pdf",
              headingPath: [],
              orderInSection: 0,
              pageNo: 1,
              pictureDescription: null,
              qualityScore: 0.5,
              retrievableByDefault: false,
              sectionId: "page:1",
              sourceType: "pdf",
              text: "冷库安全规程",
            },
            score: 0.9,
          },
          {
            id: "body",
            payload: {
              captionText: null,
              chunkId: "body",
              chunkIndex: 1,
              chunkRole: "body",
              chunkType: "paragraph",
              documentId: "92",
              embeddingText: "正文: 冷库安全规程适用于冷库设计与评审。",
              fileName: "a.pdf",
              headingPath: ["范围"],
              orderInSection: 0,
              pageNo: 6,
              pictureDescription: null,
              qualityScore: 1,
              retrievableByDefault: true,
              sectionId: "s1",
              sourceType: "pdf",
              text: "冷库安全规程适用于冷库设计与评审。",
            },
            score: 0.6,
          },
        ];
      }
    }

    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      new CoverRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.search({
      documentId: "92",
      query: "冷库安全规程适用于什么",
      topK: 5,
    });

    expect(result.items.map((item) => item.chunkId)).toEqual(["body"]);
  });

  test("applies retrievalDefaultSimilarityThreshold when request omits similarityThreshold", async () => {
    const service = new RetrievalService(
      makeMockAppConfig({ retrievalDefaultSimilarityThreshold: 0.5 }),
      new FakeEmbeddingProvider(),
      new FakeQdrantVectorRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.search({
      documentId: "12",
      query: "hello world",
      topK: 5,
    });

    expect(result.items.every((item) => (item.score ?? 0) > 0.5)).toBe(true);
    expect(result.items[0]?.chunkId).toBe("chunk-1");
  });

  test("W2.2-H1: search / by-directory / multi-doc each call model rerank exactly once", async () => {
    const config = makeMockAppConfig({ retrievalModelRerankEnabled: true });

    const searchPort = new CountingRerankPort();
    const searchService = new RetrievalService(
      config,
      new FakeEmbeddingProvider(),
      new FakeQdrantVectorRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
      undefined,
      searchPort,
    );
    await searchService.search({ documentId: "12", query: "hello world", topK: 2 });
    expect(searchPort.calls).toBe(1);

    const dirPort = new CountingRerankPort();
    const dirService = new RetrievalService(
      config,
      new FakeEmbeddingProvider(),
      new FakeQdrantVectorRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
      undefined,
      dirPort,
    );
    await dirService.searchByDirectory({ directoryId: "999", query: "hello world", topK: 2 });
    expect(dirPort.calls).toBe(1);

    const multiPort = new CountingRerankPort();
    const multiService = new RetrievalService(
      config,
      new FakeEmbeddingProvider(),
      new FakeQdrantVectorRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
      undefined,
      multiPort,
    );
    await multiService.searchMultiByDocuments({
      documents: [
        { documentId: "1", topK: 2 },
        { documentId: "2", topK: 2 },
      ],
      query: "hello world",
    });
    expect(multiPort.calls).toBe(1);
  });

  test("W2.2-H9: by-documents logs rerank success and disabled skip without query or chunk content", async () => {
    const logLines: string[] = [];
    const infoSpy = spyOn(console, "info").mockImplementation((message) => logLines.push(String(message)));
    const createService = (enabled: boolean, port?: RerankPort): RetrievalService =>
      new RetrievalService(
        makeMockAppConfig({ retrievalModelRerankEnabled: enabled }),
        new FakeEmbeddingProvider(),
        new FakeQdrantVectorRepository() as unknown as QdrantVectorRepository,
        new FakeDocumentRepository() as unknown as never,
        new FakeDocumentChunkRepository() as unknown as never,
        undefined,
        port,
      );

    try {
      await createService(true, new CountingRerankPort()).searchMultiByDocuments({
        documents: [{ documentId: "1", topK: 2 }],
        query: "sensitive query content",
      });
      await createService(false).searchMultiByDocuments({
        documents: [{ documentId: "1", topK: 2 }],
        query: "sensitive query content",
      });
    } finally {
      infoSpy.mockRestore();
    }

    const events = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toContainEqual(
      expect.objectContaining({ event: "started", modelCode: "qwen3-rerank", route: "/kb/search/by-documents" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ event: "succeeded", modelCode: "qwen3-rerank", route: "/kb/search/by-documents" }),
    );
    expect(events).toContainEqual(expect.objectContaining({ event: "skipped", reason: "disabled", route: "/kb/search/by-documents" }));
    expect(logLines.join("\n")).not.toContain("sensitive query content");
    expect(logLines.join("\n")).not.toContain("Dir1 heading body");
  });

  test("W2.2-H10: rerank uses the fixed embedding catalog tenant instead of request tenant context", async () => {
    const port = new CountingRerankPort();
    const rawCatalogTenant = Bun.env.KB_EMBEDDING_TENANT ?? process.env.KB_EMBEDDING_TENANT ?? "1";
    const parsedCatalogTenant = Number(rawCatalogTenant);
    const expectedCatalogTenant = Number.isFinite(parsedCatalogTenant) && parsedCatalogTenant >= 0 ? Math.floor(parsedCatalogTenant) : 1;
    const service = new RetrievalService(
      makeMockAppConfig({ retrievalModelRerankEnabled: true }),
      new FakeEmbeddingProvider(),
      new FakeQdrantVectorRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
      undefined,
      port,
    );

    await tenantContextAls.run({ tenantId: "432109876" }, () =>
      service.searchMultiByDocuments({
        documents: [{ documentId: "1", topK: 2 }],
        query: "hello world",
      }),
    );

    expect(port.lastRequest?.tenant).toBe(expectedCatalogTenant);
  });

  test("multi-doc rerank budget does not starve later requested documents", async () => {
    const rerank = new CountingRerankPort();
    const service = new RetrievalService(
      makeMockAppConfig({ retrievalModelRerankEnabled: true, retrievalRerankInputTopN: 2 }),
      new FakeEmbeddingProvider(),
      new FakeQdrantVectorRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
      undefined,
      rerank,
    );

    await service.searchMultiByDocuments({
      documents: [
        { documentId: "1", topK: 2 },
        { documentId: "2", topK: 2 },
      ],
      query: "hello world",
    });

    expect(rerank.lastRequest?.documents.some((document) => document.includes("Dir1 heading body"))).toBe(true);
    expect(rerank.lastRequest?.documents.some((document) => document.includes("Dir2 heading body"))).toBe(true);
    expect(rerank.lastRequest?.documents).toHaveLength(2);
  });

  test("W2.2-H2: RerankPort failure degrades to rule order and stays non-empty", async () => {
    resetRetrievalOperationalMetricsForTests();
    const failingPort: RerankPort = {
      async rerank(): Promise<RerankResultItem[]> {
        throw new Error("upstream unavailable");
      },
    };
    const service = new RetrievalService(
      makeMockAppConfig({ retrievalModelRerankEnabled: true }),
      new FakeEmbeddingProvider(),
      new FakeQdrantVectorRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
      undefined,
      failingPort,
    );

    const withModelOff = new RetrievalService(
      makeMockAppConfig({ retrievalModelRerankEnabled: false }),
      new FakeEmbeddingProvider(),
      new FakeQdrantVectorRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const degraded = await service.search({ documentId: "12", query: "hello world", topK: 2 });
    const baseline = await withModelOff.search({ documentId: "12", query: "hello world", topK: 2 });

    expect(degraded.items.length).toBeGreaterThan(0);
    expect(degraded.items.map((item) => item.chunkId)).toEqual(baseline.items.map((item) => item.chunkId));
    expect(getRetrievalOperationalMetrics()).toMatchObject({
      modelRerankAttempts: 1,
      modelRerankFallbacks: 1,
      modelRerankSuccesses: 0,
    });
  });

  test("W2.2: model rerank reorders by port scores and clamps score/rankScore", async () => {
    const port = new CountingRerankPort(async (req) =>
      req.documents.map((_, index) => ({
        index,
        // reverse preference vs recall order
        relevanceScore: index === 0 ? 0.1 : 0.99,
      })),
    );
    const service = new RetrievalService(
      makeMockAppConfig({ retrievalModelRerankEnabled: true }),
      new FakeEmbeddingProvider(),
      new FakeQdrantVectorRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
      undefined,
      port,
    );

    const result = await service.search({ documentId: "12", query: "hello world", topK: 2 });
    expect(port.calls).toBe(1);
    expect(result.items[0]?.chunkId).toBe("chunk-2");
    expect(result.items[0]?.score).toBe(0.99);
    expect(result.items[0]?.rankScore).toBe(0.99);
    expect(result.items[0]?.vectorScore).toBe(0.71);
  });

  test("W4.3-H1: KB performs one deterministic query embed and no rewrite leg", async () => {
    const embeddingProvider = new FakeEmbeddingProvider();
    const service = new RetrievalService(
      makeMockAppConfig(),
      embeddingProvider,
      new FakeQdrantVectorRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
      undefined,
      undefined,
    );

    await service.search({ documentId: "12", query: "如何降低园区误报", topK: 1 });
    expect(embeddingProvider.inputs).toEqual([["如何降低园区误报"]]);
  });

  test("W3.1: staging and obsolete Qdrant generations are rejected by active MySQL manifest", async () => {
    class GenerationQdrant extends FakeQdrantVectorRepository {
      public override async search(): Promise<QdrantSearchResult[]> {
        return [
          {
            id: "old",
            payload: {
              captionText: null,
              chunkId: "old-chunk",
              chunkIndex: 0,
              chunkType: "paragraph",
              documentId: "12",
              embeddingText: "hello world obsolete",
              fileName: "old.txt",
              generationId: "gen-old",
              headingPath: [],
              orderInSection: 0,
              pageNo: null,
              pictureDescription: null,
              sectionId: "old",
              sourceType: "txt",
              text: "hello world obsolete",
            },
            score: 0.99,
          },
          {
            id: "active",
            payload: {
              captionText: null,
              chunkId: "active-chunk",
              chunkIndex: 0,
              chunkType: "paragraph",
              documentId: "12",
              embeddingText: "hello world active",
              fileName: "active.txt",
              generationId: "gen-active",
              headingPath: [],
              orderInSection: 0,
              pageNo: null,
              pictureDescription: null,
              sectionId: "active",
              sourceType: "txt",
              text: "hello world active",
            },
            score: 0.8,
          },
        ];
      }
    }
    class GenerationChunks extends FakeDocumentChunkRepository {
      public async findActiveChunkReferenceKeys() {
        return new Set(["12\u0001active-chunk\u0001gen-active"]);
      }
    }
    const service = new RetrievalService(
      makeMockAppConfig({ retrievalDefaultSimilarityThreshold: 0 }),
      new FakeEmbeddingProvider(),
      new GenerationQdrant() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new GenerationChunks() as unknown as never,
    );
    const result = await service.search({ documentId: "12", query: "hello world", topK: 5 });
    expect(result.items.map((item) => item.chunkId)).toEqual(["active-chunk"]);
  });

  test("W2.3: diversification loads candidate dense vectors in one batch", async () => {
    class VectorAwareRepository extends FakeQdrantVectorRepository {
      public vectorCalls: string[][] = [];

      public async getVectorsByPointIds(pointIds: string[]) {
        this.vectorCalls.push(pointIds);
        return new Map(pointIds.map((id, index) => [id, { dense: index === 0 ? [1, 0] : [0, 1], sparse: null }]));
      }
    }
    const repository = new VectorAwareRepository();
    const service = new RetrievalService(
      makeMockAppConfig({ retrievalDefaultSimilarityThreshold: 0, retrievalDiversificationEnabled: true }),
      new FakeEmbeddingProvider(),
      repository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    );

    const result = await service.search({ documentId: "2", query: "Dir2", topK: 2 });
    expect(result.items).toHaveLength(2);
    expect(repository.vectorCalls).toHaveLength(1);
    expect(repository.vectorCalls[0]).toEqual(["chunk-A", "chunk-C"]);
  });

  test("W2.3: vector retrieval failure degrades without failing search", async () => {
    class FailingVectorRepository extends FakeQdrantVectorRepository {
      public async getVectorsByPointIds(): Promise<never> {
        throw new Error("qdrant retrieve unavailable");
      }
    }
    const warnings: string[] = [];
    const warnSpy = spyOn(console, "warn").mockImplementation((message) => warnings.push(String(message)));
    try {
      const service = new RetrievalService(
        makeMockAppConfig({ retrievalDefaultSimilarityThreshold: 0, retrievalDiversificationEnabled: true }),
        new FakeEmbeddingProvider(),
        new FailingVectorRepository() as unknown as QdrantVectorRepository,
        new FakeDocumentRepository() as unknown as never,
        new FakeDocumentChunkRepository() as unknown as never,
      );
      const result = await service.search({ documentId: "2", query: "Dir2", topK: 2 });
      expect(result.items).toHaveLength(2);
    } finally {
      warnSpy.mockRestore();
    }
    expect(warnings.some((line) => line.includes('"reason":"vector-retrieve-failed"'))).toBe(true);
  });
});
