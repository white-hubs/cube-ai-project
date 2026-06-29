import { ApiBody, ApiOperation, ApiResponse, BadRequestException, Body, Controller, POST } from "@dangao/bun-server";

import { parsePlatformDocumentSyncContext } from "../../../port/document-platform-sync.port";
import { RetrievalService } from "../services/retrieval.service";

function parseSimilarityThreshold(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new BadRequestException("similarityThreshold must be a finite number in [0, 1]");
  }
  if (raw < 0 || raw > 1) {
    throw new BadRequestException("similarityThreshold must be within [0, 1]");
  }
  return raw;
}

@Controller("/search")
export class SearchController {
  public constructor(private readonly retrievalService: RetrievalService) {}

  /**
   * 向量检索（支持可选 documentId 过滤）。
   *
   * @param body.query 检索问题/关键词（必填）
   * @param body.topK 返回候选数量（默认 5）
   * @param body.documentId 可选：限制在指定文档内检索
   * @param body.similarityThreshold 可选：相似度阈值 [0,1]，滑块语义；仅返回 score 大于该值的分段（与响应 `score` 一致）；0 或未传表示不过滤
   */
  @ApiOperation({
    description:
      "根据 query 进行向量相似度检索；可选 documentId 将范围限制到单个文档。可选 similarityThreshold：仅保留最终得分 score 大于阈值的分段（典型 UI 为 0~1 滑块）。",
    operationId: "search",
    summary: "向量检索",
  })
  @ApiBody({
    description: "检索参数",
    required: true,
    schema: {
      properties: {
        documentId: { description: "可选：限制在指定文档内检索", type: "string" },
        query: { description: "检索问题/关键词（必填）", type: "string" },
        similarityThreshold: {
          description:
            "可选，[0,1]。滑块型参数：与响应中 score（最终相关性，0~1）比较，仅返回 score > similarityThreshold 的分段；为 0 或未传时不做该层过滤。",
          maximum: 1,
          minimum: 0,
          type: "number",
        },
        topK: { description: "返回候选数量（默认 5）", type: "number" },
      },
      required: ["query"],
      type: "object",
    },
  })
  @ApiResponse({
    description: "检索结果",
    schema: {
      properties: {
        items: {
          items: {
            properties: {
              chunkId: { description: "chunk 主键", type: "string" },
              chunkIndex: { description: "chunk 索引（序号）", type: "number" },
              chunkType: { description: "chunk 类型", type: "string" },
              cueIndex: { description: "字幕 cue", nullable: true, type: "number" },
              documentId: { description: "所属文档主键", type: "string" },
              endTime: { description: "结束时间", nullable: true, type: "string" },
              fileName: { description: "源文件名", type: "string" },
              headers: { description: "表头", items: { type: "string" }, type: "array" },
              headingPath: { description: "命中标题路径", items: { type: "string" }, type: "array" },
              keywords: { description: "关键词", items: { type: "string" }, type: "array" },
              pageNo: { description: "页码", nullable: true, type: "number" },
              propertyNamespace: { description: "属性命名空间", nullable: true, type: "string" },
              rankScore: { description: "规则重排后的最终得分", type: "number" },
              retrievalProfile: { description: "检索画像", type: "string" },
              rowEnd: { description: "结束行", nullable: true, type: "number" },
              rowStart: { description: "起始行", nullable: true, type: "number" },
              score: { description: "最终排序得分（可能包含规则重排加权）", type: "number" },
              sectionId: { description: "逻辑章节标识", type: "string" },
              sheetName: { description: "工作表名", nullable: true, type: "string" },
              sourceType: { description: "数据来源类型", type: "string" },
              startTime: { description: "起始时间", nullable: true, type: "string" },
              tableId: { description: "表格 id", nullable: true, type: "string" },
              text: { description: "chunk 文本内容", type: "string" },
              vectorScore: { description: "原始向量召回得分", type: "number" },
            },
            type: "object",
          },
          type: "array",
        },
      },
      type: "object",
    },
    status: 200,
  })
  @POST("/")
  public async search(@Body() body: { query?: string; topK?: number; documentId?: string; similarityThreshold?: number }) {
    if (!body?.query || typeof body.query !== "string") {
      throw new BadRequestException("query is required");
    }
    if (body.topK !== undefined && (!Number.isFinite(body.topK) || body.topK <= 0)) {
      throw new BadRequestException("topK must be a positive number");
    }
    if (body.documentId !== undefined) {
      const id = String(body.documentId).trim();
      if (!id || id === "0") {
        throw new BadRequestException("documentId must be a non-empty non-zero id when provided");
      }
    }
    const similarityThreshold = parseSimilarityThreshold(body.similarityThreshold);

    const documentId = body.documentId !== undefined ? String(body.documentId).trim() : undefined;

    return this.retrievalService.search({
      documentId,
      query: body.query,
      similarityThreshold,
      topK: typeof body.topK === "number" ? body.topK : 5,
    });
  }

  /**
   * 向量检索（多文档）：同一 query 只嵌入一次；每个文档独立 topK 与 similarityThreshold（score 语义同 `/search`）。
   *
   * @param body.query 检索问题/关键词（必填）
   * @param body.documents 文档列表（必填，每项含 documentId；topK 默认 5；similarityThreshold 可选）
   */
  @ApiOperation({
    description:
      "对多个 documentId 分别检索：共享同一 query 向量；每个文档可指定独立的 topK 与 similarityThreshold（仅保留 score > 阈值的分段）。返回 items 按请求中 documents 顺序拼接。",
    operationId: "searchByDocuments",
    summary: "多文档向量检索",
  })
  @ApiBody({
    description: "检索参数",
    required: true,
    schema: {
      properties: {
        documents: {
          description: "文档检索规格列表（顺序保留至响应 items 拼接顺序）",
          items: {
            properties: {
              documentId: { description: "文档主键", type: "string" },
              similarityThreshold: {
                description: "可选，[0,1]。仅该文档：保留 score > similarityThreshold；为 0 或未传则不做该层过滤。",
                maximum: 1,
                minimum: 0,
                type: "number",
              },
              topK: { description: "该文档返回条数上限（默认 5）", type: "number" },
            },
            required: ["documentId"],
            type: "object",
          },
          type: "array",
        },
        query: { description: "检索问题/关键词（必填）", type: "string" },
      },
      required: ["query", "documents"],
      type: "object",
    },
  })
  @ApiResponse({
    description: "检索结果",
    schema: {
      properties: {
        items: {
          items: {
            properties: {
              chunkId: { description: "chunk 主键", type: "string" },
              chunkIndex: { description: "chunk 索引（序号）", type: "number" },
              chunkType: { description: "chunk 类型", type: "string" },
              cueIndex: { description: "字幕 cue", nullable: true, type: "number" },
              documentId: { description: "所属文档主键", type: "string" },
              endTime: { description: "结束时间", nullable: true, type: "string" },
              fileName: { description: "源文件名", type: "string" },
              headers: { description: "表头", items: { type: "string" }, type: "array" },
              headingPath: { description: "命中标题路径", items: { type: "string" }, type: "array" },
              keywords: { description: "关键词", items: { type: "string" }, type: "array" },
              pageNo: { description: "页码", nullable: true, type: "number" },
              propertyNamespace: { description: "属性命名空间", nullable: true, type: "string" },
              rankScore: { description: "规则重排后的最终得分", type: "number" },
              retrievalProfile: { description: "检索画像", type: "string" },
              rowEnd: { description: "结束行", nullable: true, type: "number" },
              rowStart: { description: "起始行", nullable: true, type: "number" },
              score: { description: "最终排序得分（可能包含规则重排加权）", type: "number" },
              sectionId: { description: "逻辑章节标识", type: "string" },
              sheetName: { description: "工作表名", nullable: true, type: "string" },
              sourceType: { description: "数据来源类型", type: "string" },
              startTime: { description: "起始时间", nullable: true, type: "string" },
              tableId: { description: "表格 id", nullable: true, type: "string" },
              text: { description: "chunk 文本内容", type: "string" },
              vectorScore: { description: "原始向量召回得分", type: "number" },
            },
            type: "object",
          },
          type: "array",
        },
      },
      type: "object",
    },
    status: 200,
  })
  @POST("/by-documents")
  public async searchByDocuments(
    @Body()
    body: {
      query?: string;
      documents?: { documentId?: string; topK?: number; similarityThreshold?: number }[];
      platformKbId?: string;
      directoryId?: string;
    },
  ) {
    if (!body?.query || typeof body.query !== "string") {
      throw new BadRequestException("query is required");
    }
    if (!Array.isArray(body.documents) || body.documents.length === 0) {
      throw new BadRequestException("documents must be a non-empty array");
    }

    const seen = new Set<string>();
    const documents: { documentId: string; topK?: number; similarityThreshold?: number }[] = [];
    for (const entry of body.documents) {
      if (!entry || typeof entry !== "object") {
        throw new BadRequestException("each documents entry must be an object");
      }
      const documentId = typeof entry.documentId === "string" ? entry.documentId.trim() : "";
      if (!documentId || documentId === "0") {
        throw new BadRequestException("each documentId must be a non-empty non-zero id");
      }
      if (seen.has(documentId)) {
        throw new BadRequestException(`duplicate documentId in documents: ${documentId}`);
      }
      seen.add(documentId);

      if (entry.topK !== undefined && (!Number.isFinite(entry.topK) || entry.topK <= 0)) {
        throw new BadRequestException("each topK must be a positive number when provided");
      }
      const similarityThreshold = parseSimilarityThreshold(entry.similarityThreshold);
      documents.push({
        documentId,
        ...(typeof entry.topK === "number" ? { topK: entry.topK } : {}),
        ...(similarityThreshold !== undefined ? { similarityThreshold } : {}),
      });
    }

    return this.retrievalService.searchMultiByDocuments({
      documents,
      platformSync: parsePlatformDocumentSyncContext(body),
      query: body.query,
    });
  }

  /**
   * 向量检索（按目录过滤：先查目录下 documentId，再逐文档检索）。
   *
   * @param body.query 检索问题/关键词（必填）
   * @param body.topK 返回候选数量（默认 5）
   * @param body.directoryId 目录主键（必填）
   * @param body.similarityThreshold 可选：相似度阈值 [0,1]，滑块语义；仅返回 score 大于该值的分段
   */
  @ApiOperation({
    description:
      "先根据 directoryId 查询目录下的文档集合，再进行向量检索并合并候选。可选 similarityThreshold：仅保留 score 大于阈值的分段。",
    operationId: "searchByDirectory",
    summary: "目录检索",
  })
  @ApiBody({
    description: "检索参数",
    required: true,
    schema: {
      properties: {
        directoryId: { description: "目录主键（必填）", type: "string" },
        query: { description: "检索问题/关键词（必填）", type: "string" },
        similarityThreshold: {
          description:
            "可选，[0,1]。滑块型参数：与响应中 score 比较，仅返回 score > similarityThreshold 的分段；为 0 或未传时不做该层过滤。",
          maximum: 1,
          minimum: 0,
          type: "number",
        },
        topK: { description: "返回候选数量（默认 5）", type: "number" },
      },
      required: ["query", "directoryId"],
      type: "object",
    },
  })
  @ApiResponse({
    description: "检索结果",
    schema: {
      properties: {
        items: {
          items: {
            properties: {
              chunkId: { description: "chunk 主键", type: "string" },
              chunkIndex: { description: "chunk 索引（序号）", type: "number" },
              chunkType: { description: "chunk 类型", type: "string" },
              cueIndex: { description: "字幕 cue", nullable: true, type: "number" },
              documentId: { description: "所属文档主键", type: "string" },
              endTime: { description: "结束时间", nullable: true, type: "string" },
              fileName: { description: "源文件名", type: "string" },
              headers: { description: "表头", items: { type: "string" }, type: "array" },
              headingPath: { description: "命中标题路径", items: { type: "string" }, type: "array" },
              keywords: { description: "关键词", items: { type: "string" }, type: "array" },
              pageNo: { description: "页码", nullable: true, type: "number" },
              propertyNamespace: { description: "属性命名空间", nullable: true, type: "string" },
              rankScore: { description: "规则重排后的最终得分", type: "number" },
              retrievalProfile: { description: "检索画像", type: "string" },
              rowEnd: { description: "结束行", nullable: true, type: "number" },
              rowStart: { description: "起始行", nullable: true, type: "number" },
              score: { description: "最终排序得分（可能包含规则重排加权）", type: "number" },
              sectionId: { description: "逻辑章节标识", type: "string" },
              sheetName: { description: "工作表名", nullable: true, type: "string" },
              sourceType: { description: "数据来源类型", type: "string" },
              startTime: { description: "起始时间", nullable: true, type: "string" },
              tableId: { description: "表格 id", nullable: true, type: "string" },
              text: { description: "chunk 文本内容", type: "string" },
              vectorScore: { description: "原始向量召回得分", type: "number" },
            },
            type: "object",
          },
          type: "array",
        },
      },
      type: "object",
    },
    status: 200,
  })
  @POST("/by-directory")
  public async searchByDirectory(@Body() body: { query?: string; topK?: number; directoryId?: string; similarityThreshold?: number }) {
    if (!body?.query || typeof body.query !== "string") {
      throw new BadRequestException("query is required");
    }
    if (body.topK !== undefined && (!Number.isFinite(body.topK) || body.topK <= 0)) {
      throw new BadRequestException("topK must be a positive number");
    }
    const similarityThreshold = parseSimilarityThreshold(body.similarityThreshold);
    return this.retrievalService.searchByDirectory({
      directoryId: body.directoryId ?? "0",
      query: body.query,
      similarityThreshold,
      topK: typeof body.topK === "number" ? body.topK : 5,
    });
  }
}
