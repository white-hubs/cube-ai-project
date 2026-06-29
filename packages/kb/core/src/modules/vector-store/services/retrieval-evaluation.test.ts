import { describe, expect, test } from "bun:test";

import { makeMockAppConfig } from "../../../test-helpers/mock-app-config";
import { type EmbeddingContext, type EmbeddingProvider, type EmbeddingVector } from "../infrastructure/embeddings/embedding-provider";
import { type QdrantSearchResult, type QdrantVectorRepository } from "../infrastructure/qdrant/qdrant-vector.repository";
import { RetrievalService } from "./retrieval.service";

class EvaluationEmbeddingProvider implements EmbeddingProvider {
  public readonly calls: { input: string[]; contexts: EmbeddingContext[] | undefined }[] = [];

  public async embed(input: string[], _purpose?: never, contexts?: EmbeddingContext[]): Promise<EmbeddingVector[]> {
    this.calls.push({ contexts, input });
    return input.map(() => ({
      dense: [0.1, 0.2, 0.3],
      sparse: { indices: [1, 2], values: [0.7, 0.5] },
    }));
  }
}

class EvaluationQdrantRepository {
  public async search(params: {
    documentId?: number;
    topK: number;
    denseVector?: number[];
    sparseVector?: { indices: number[]; values: number[] } | null;
  }): Promise<QdrantSearchResult[]> {
    const documentIdKey = params.documentId === undefined || params.documentId === null ? undefined : String(params.documentId);
    switch (documentIdKey) {
      case "401": {
        return [
          {
            id: "generic-entity",
            score: 0.66,
            payload: {
              documentId: "401",
              chunkId: "generic-entity",
              chunkIndex: 0,
              text: "设备全生命周期管理方案说明",
              embeddingText: "说明\n设备全生命周期管理方案说明",
              fileName: "entity.md",
              sourceType: "md",
              sectionId: "heading:entity",
              headingPath: ["说明"],
              pageNo: null,
              chunkType: "paragraph",
              orderInSection: 0,
              captionText: null,
              pictureDescription: null,
            },
          },
          {
            id: "entity-hit",
            score: 0.42,
            payload: {
              documentId: "401",
              chunkId: "entity-hit",
              chunkIndex: 1,
              text: "工作表: Assets\n行范围: 1-1\n\n第1行: 设备编码=A-102; 设备名称=研发中心3号265CBRS",
              embeddingText: "第1行: 设备编码=A-102; 设备名称=研发中心3号265CBRS\n关键词: 设备编码=A-102; 设备名称=研发中心3号265CBRS",
              fileName: "entity.xlsx",
              sourceType: "xlsx",
              sectionId: "sheet:assets",
              headingPath: ["Assets"],
              pageNo: null,
              chunkType: "table-row-window",
              orderInSection: 0,
              captionText: null,
              pictureDescription: null,
              headers: ["设备编码", "设备名称"],
              keywords: ["A-102", "研发中心3号265CBRS"],
              sheetName: "Assets",
              tableId: "xlsx-table-0",
              rowStart: 1,
              rowEnd: 1,
            },
          },
        ];
      }
      case "402": {
        return [
          {
            id: "semantic-hit",
            score: 0.61,
            payload: {
              documentId: "402",
              chunkId: "semantic-hit",
              chunkIndex: 0,
              text: "系统通过规则引擎与多模型协同降低误报并减少人工复核成本。",
              embeddingText: "标题路径: 行业痛点\n正文: 系统通过规则引擎与多模型协同降低误报并减少人工复核成本。",
              fileName: "semantic.pdf",
              sourceType: "pdf",
              sectionId: "heading:semantic",
              headingPath: ["行业痛点"],
              pageNo: 1,
              chunkType: "paragraph",
              orderInSection: 0,
              captionText: null,
              pictureDescription: null,
            },
          },
          {
            id: "semantic-generic",
            score: 0.48,
            payload: {
              documentId: "402",
              chunkId: "semantic-generic",
              chunkIndex: 1,
              text: "系统整体方案介绍",
              embeddingText: "标题路径: 方案介绍\n正文: 系统整体方案介绍",
              fileName: "semantic.pdf",
              sourceType: "pdf",
              sectionId: "heading:semantic-generic",
              headingPath: ["方案介绍"],
              pageNo: 1,
              chunkType: "paragraph",
              orderInSection: 0,
              captionText: null,
              pictureDescription: null,
            },
          },
        ];
      }
      case "403": {
        return [
          {
            id: "navigation-hit",
            score: 0.39,
            payload: {
              documentId: "403",
              chunkId: "navigation-hit",
              chunkIndex: 0,
              text: "部署架构概览",
              embeddingText: "标题路径: 系统设计 > 部署架构\n导航内容: 部署架构概览",
              fileName: "nav.md",
              sourceType: "md",
              sectionId: "heading:navigation",
              headingPath: ["系统设计", "部署架构"],
              pageNo: null,
              chunkType: "paragraph",
              orderInSection: 0,
              captionText: null,
              pictureDescription: null,
            },
          },
          {
            id: "navigation-generic",
            score: 0.52,
            payload: {
              documentId: "403",
              chunkId: "navigation-generic",
              chunkIndex: 1,
              text: "部署时需要准备数据库与对象存储。",
              embeddingText: "标题路径: 部署准备\n正文: 部署时需要准备数据库与对象存储。",
              fileName: "nav.md",
              sourceType: "md",
              sectionId: "heading:navigation-generic",
              headingPath: ["部署准备"],
              pageNo: null,
              chunkType: "paragraph",
              orderInSection: 0,
              captionText: null,
              pictureDescription: null,
            },
          },
        ];
      }
      case "404": {
        return [
          {
            id: "timeline-hit",
            score: 0.44,
            payload: {
              documentId: "404",
              chunkId: "timeline-hit",
              chunkIndex: 0,
              text: "[00:02:10.000 --> 00:02:12.000]\n系统恢复完成",
              embeddingText: "文件: meeting.vtt\n时间: 00:02:10.000 --> 00:02:12.000\n内容: 系统恢复完成",
              fileName: "meeting.vtt",
              sourceType: "vtt",
              sectionId: "vtt:meeting",
              headingPath: ["meeting.vtt"],
              pageNo: null,
              chunkType: "vtt-cue-window",
              orderInSection: 0,
              captionText: null,
              pictureDescription: null,
              startTime: "00:02:10.000",
              endTime: "00:02:12.000",
              cueIndex: 12,
            },
          },
          {
            id: "timeline-generic",
            score: 0.55,
            payload: {
              documentId: "404",
              chunkId: "timeline-generic",
              chunkIndex: 1,
              text: "会议讨论了恢复流程",
              embeddingText: "meeting.vtt\n会议讨论了恢复流程",
              fileName: "meeting.vtt",
              sourceType: "vtt",
              sectionId: "vtt:meeting-generic",
              headingPath: ["meeting.vtt"],
              pageNo: null,
              chunkType: "paragraph",
              orderInSection: 0,
              captionText: null,
              pictureDescription: null,
            },
          },
        ];
      }
      default: {
        return [];
      }
    }
  }
}

class EvaluationDocumentChunkRepository {
  public async findByDocumentIdAndSectionId(): Promise<never[]> {
    return [];
  }

  public async searchLexicalChunks(params: { documentId?: string }) {
    if (params.documentId === "401") {
      return [
        {
          caption_text: null,
          chunk_id: "entity-hit",
          chunk_index: 1,
          chunk_type: "table-row-window",
          cue_index: null,
          document_id: "401",
          embedding_text: "第1行: 设备编码=A-102; 设备名称=研发中心3号265CBRS\n关键词: 设备编码=A-102; 设备名称=研发中心3号265CBRS",
          end_time: null,
          file_name: "entity.xlsx",
          headers_text: '["设备编码","设备名称"]',
          heading_path: '["Assets"]',
          keywords_text: '["A-102","研发中心3号265CBRS"]',
          lexical_score: 8,
          order_in_section: 0,
          page_no: null,
          picture_description: null,
          property_namespace: null,
          row_end: 1,
          row_start: 1,
          section_id: "sheet:assets",
          sheet_name: "Assets",
          source_type: "xlsx",
          start_time: null,
          table_id: "xlsx-table-0",
          text_content: "工作表: Assets\n行范围: 1-1\n\n第1行: 设备编码=A-102; 设备名称=研发中心3号265CBRS",
        },
      ];
    }

    return [];
  }
}

class EvaluationDocumentRepository {
  public async findIdsByDirectoryId(): Promise<string[]> {
    return ["401", "402", "403", "404"];
  }
}

function evaluateRankingMetrics(rankings: string[][], expectedTopHits: string[]) {
  const top1 = rankings.filter((ranking, index) => ranking[0] === expectedTopHits[index]!).length / rankings.length;
  const top3 = rankings.filter((ranking, index) => ranking.slice(0, 3).includes(expectedTopHits[index]!)).length / rankings.length;
  const mrr =
    rankings.reduce((sum, ranking, index) => {
      const foundIndex = ranking.indexOf(expectedTopHits[index]!);
      return sum + (foundIndex === -1 ? 0 : 1 / (foundIndex + 1));
    }, 0) / rankings.length;

  return {
    mrr,
    top1,
    top3,
  };
}

describe("Retrieval evaluation baseline", () => {
  test("maintains top hits across entity, semantic, navigation and timeline scenarios", async () => {
    const embeddingProvider = new EvaluationEmbeddingProvider();
    const service = new RetrievalService(
      makeMockAppConfig(),
      embeddingProvider,
      new EvaluationQdrantRepository() as unknown as QdrantVectorRepository,
      new EvaluationDocumentRepository() as unknown as never,
      new EvaluationDocumentChunkRepository() as unknown as never,
    );

    const cases = [
      { documentId: "401", expectedProfile: "entity-lookup", expectedTopHit: "entity-hit", query: "研发中心3号265CBRS" },
      { documentId: "402", expectedProfile: "semantic-qa", expectedTopHit: "semantic-hit", query: "系统如何降低误报并减少人工复核成本" },
      { documentId: "403", expectedProfile: "navigation", expectedTopHit: "navigation-hit", query: "第3章 部署架构" },
      { documentId: "404", expectedProfile: "timeline", expectedTopHit: "timeline-hit", query: "00:02:10" },
    ] as const;

    const rankings: string[][] = [];

    for (const testCase of cases) {
      const result = await service.search({
        documentId: testCase.documentId,
        query: testCase.query,
        topK: 2,
      });
      rankings.push(result.items.map((item) => item.chunkId));
    }

    const metrics = evaluateRankingMetrics(
      rankings,
      cases.map((testCase) => testCase.expectedTopHit),
    );

    expect(metrics).toEqual({
      mrr: 1,
      top1: 1,
      top3: 1,
    });
    expect(embeddingProvider.calls.map((call) => call.contexts?.[0]?.retrievalProfile)).toEqual(
      cases.map((testCase) => testCase.expectedProfile),
    );
  });
});
