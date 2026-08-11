import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  BadRequestException,
  Body,
  type Context,
  ContextParam,
  Controller,
  DELETE,
  GET,
  POST,
  PUT,
  Param,
} from "@dangao/bun-server";

import { parsePlatformDocumentSyncContext } from "../../../port/document-platform-sync.port";
import { type ChunkingOptions, type TableChunkMode, type TextChunkMode } from "../../common/document-types";
import { PlatformSourceImportService } from "../../ingestion/platform-source-import.service";
import { type DocumentMetadataInput, DocumentService } from "../services/document.service";

function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new BadRequestException(`invalid ${fieldName}`);
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new BadRequestException(`invalid ${fieldName}`);
  }
  return parsed;
}

function parseOptionalNonNegativeInteger(value: unknown, fieldName: string): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new BadRequestException(`invalid ${fieldName}`);
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestException(`invalid ${fieldName}`);
  }
  return parsed;
}

function parseOptionalEnum<T extends string>(value: unknown, fieldName: string, allowedValues: readonly T[]): T | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`invalid ${fieldName}`);
  }
  if (!allowedValues.includes(value as T)) {
    throw new BadRequestException(`invalid ${fieldName}`);
  }
  return value as T;
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadRequestException(`invalid ${fieldName}: expected array of strings`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new BadRequestException(`invalid ${fieldName}: expected array of strings`);
    }
    out.push(item);
  }
  return out;
}

function parseJsonStringArrayField(raw: unknown, fieldName: string): string[] | undefined {
  if (raw === null || raw === undefined || raw === "") {
    return undefined;
  }
  if (typeof raw !== "string") {
    throw new BadRequestException(`${fieldName} must be a JSON string array when provided`);
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new BadRequestException(`${fieldName} must be a JSON string array`);
    }
    return parsed.map((item) => (item as string).trim()).filter((item) => item !== "");
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException(`${fieldName} must be valid JSON`);
  }
}

function parseDocumentMetadataFromForm(formData: FormData): DocumentMetadataInput | undefined {
  const docTypeRaw = formData.get("docType");
  const langRaw = formData.get("lang");
  const tags = parseJsonStringArrayField(formData.get("tags"), "tags");
  const aclGroupIds = parseJsonStringArrayField(formData.get("aclGroupIds"), "aclGroupIds");
  const metadata: DocumentMetadataInput = {};
  if (typeof docTypeRaw === "string" && docTypeRaw.trim() !== "") {
    metadata.docType = docTypeRaw.trim();
  }
  if (typeof langRaw === "string" && langRaw.trim() !== "") {
    metadata.lang = langRaw.trim();
  }
  if (tags !== undefined) {
    metadata.tags = tags;
  }
  if (aclGroupIds !== undefined) {
    metadata.aclGroupIds = aclGroupIds;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function parseDocumentMetadataBody(body: {
  docType?: unknown;
  lang?: unknown;
  tags?: unknown;
  aclGroupIds?: unknown;
  metadata?: unknown;
}): DocumentMetadataInput {
  const out: DocumentMetadataInput = {};
  if (body.docType !== undefined) {
    if (body.docType !== null && typeof body.docType !== "string") {
      throw new BadRequestException("docType must be a string or null");
    }
    out.docType = body.docType === null ? null : body.docType.trim();
  }
  if (body.lang !== undefined) {
    if (body.lang !== null && typeof body.lang !== "string") {
      throw new BadRequestException("lang must be a string or null");
    }
    out.lang = body.lang === null ? null : body.lang.trim();
  }
  if (body.tags !== undefined) {
    out.tags = body.tags === null ? null : parseStringArray(body.tags, "tags");
  }
  if (body.aclGroupIds !== undefined) {
    out.aclGroupIds = body.aclGroupIds === null ? null : parseStringArray(body.aclGroupIds, "aclGroupIds");
  }
  if (body.metadata !== undefined) {
    if (body.metadata !== null && (typeof body.metadata !== "object" || Array.isArray(body.metadata))) {
      throw new BadRequestException("metadata must be an object or null");
    }
    out.metadata = body.metadata as Record<string, unknown> | null;
  }
  return out;
}

function parseChunkingOptions(payload: {
  separator?: unknown;
  chunkSize?: unknown;
  chunkOverlap?: unknown;
  tableChunkMode?: unknown;
  textChunkMode?: unknown;
}): ChunkingOptions | undefined {
  const separator = typeof payload.separator === "string" && payload.separator.trim() !== "" ? payload.separator : undefined;
  const chunkSize = parseOptionalPositiveInteger(payload.chunkSize, "chunkSize");
  const chunkOverlap = parseOptionalNonNegativeInteger(payload.chunkOverlap, "chunkOverlap");
  const tableChunkMode = parseOptionalEnum<TableChunkMode>(payload.tableChunkMode, "tableChunkMode", ["auto", "row", "window"]);
  const textChunkMode = parseOptionalEnum<TextChunkMode>(payload.textChunkMode, "textChunkMode", ["auto", "block", "merge"]);

  return separator !== undefined ||
    chunkSize !== undefined ||
    chunkOverlap !== undefined ||
    tableChunkMode !== undefined ||
    textChunkMode !== undefined
    ? { chunkOverlap, chunkSize, separator, tableChunkMode, textChunkMode }
    : undefined;
}

/** OpenAPI：表格分段模式（与 ChunkingOptions.tableChunkMode 一致），便于前端展示枚举中文含义 */
export const openApiTableChunkModeProperty = {
  description:
    "表格分段模式（主要影响 Excel .xlsx / .xls、.csv 等表格类文件）。" +
    "auto：自动（默认）— 按表结构疏密在「按行」与「按窗口」之间自动选择；" +
    "row：按行— 每条数据行尽量单独成一段；" +
    "window：按窗口— 多行合并为一段。" +
    "对 PDF/Word/PPT 等由解析服务产出的表格块影响有限。",
  enum: ["auto", "row", "window"],
  type: "string",
} as const;

/** OpenAPI：文本二次分段模式（与 ChunkingOptions.textChunkMode 一致） */
export const openApiTextChunkModeProperty = {
  description:
    "文本二次分段策略（在解析得到的段落上再切分；未传时服务端默认 auto）。" +
    "auto：自动（默认）— 检测到多标题/多列表等结构时按「块」策略切分；" +
    "block：按块— 标题与其后段落尽量保持在同一段；" +
    "merge：合并— 与 auto 在非块场景下行为一致，尽量合并相邻短段。",
  enum: ["auto", "block", "merge"],
  type: "string",
} as const;

const chunkSemanticMetadataOpenApiProperties = {
  cueIndex: { description: "字幕 cue 序号", nullable: true, type: "number" },
  endTime: { description: "结束时间", nullable: true, type: "string" },
  headers: { description: "表头", items: { type: "string" }, type: "array" },
  keywords: { description: "关键词", items: { type: "string" }, type: "array" },
  propertyNamespace: { description: "属性命名空间", nullable: true, type: "string" },
  rowEnd: { description: "结束行", nullable: true, type: "number" },
  rowStart: { description: "起始行", nullable: true, type: "number" },
  sheetName: { description: "工作表名（表格类）", nullable: true, type: "string" },
  startTime: { description: "起始时间（字幕等）", nullable: true, type: "string" },
  tableId: { description: "表格标识", nullable: true, type: "string" },
} as const;

const chunkPreviewItemOpenApiProperties = {
  charCount: { description: "正文字符数", type: "number" },
  chunkId: { description: "分段主键", type: "string" },
  chunkIndex: { description: "分段序号（从 0 起）", type: "number" },
  chunkType: { description: "分段类型（paragraph/table/…）", type: "string" },
  headingPath: { description: "标题路径", items: { type: "string" }, type: "array" },
  orderInSection: { description: "章节内顺序", type: "number" },
  pageNo: { description: "页码", nullable: true, type: "number" },
  recallCount: { description: "该分段被检索命中次数（本地上传预览为 0）", type: "number" },
  sectionId: { description: "逻辑章节标识", type: "string" },
  text: { description: "分段正文（展示用）", type: "string" },
  ...chunkSemanticMetadataOpenApiProperties,
} as const;

const documentChunkListItemOpenApiProperties = {
  captionText: { description: "图片说明", nullable: true, type: "string" },
  charCount: { description: "分段正文字符数", type: "number" },
  chunkId: { description: "分段主键", type: "string" },
  chunkIndex: { description: "分段序号（从 0 起）", type: "number" },
  chunkType: { description: "分段类型", type: "string" },
  embeddingText: { description: "用于向量嵌入的文本", type: "string" },
  headingPath: { description: "标题路径", items: { type: "string" }, type: "array" },
  orderInSection: { description: "章节内顺序", type: "number" },
  pageNo: { description: "页码", nullable: true, type: "number" },
  pictureDescription: { description: "图片描述", nullable: true, type: "string" },
  recallCount: { description: "该分段被检索命中次数（累计）", type: "number" },
  sectionId: { description: "逻辑章节标识", type: "string" },
  text: { description: "分段正文（展示用）", type: "string" },
  ...chunkSemanticMetadataOpenApiProperties,
} as const;

@Controller("/documents")
export class DocumentController {
  public constructor(
    private readonly documentService: DocumentService,
    private readonly platformSourceImportService: PlatformSourceImportService,
  ) {}

  @POST("/preview")
  @ApiOperation({
    description: "上传文件但不入库，返回只读分段预览结果。",
    operationId: "previewDocumentChunks",
    summary: "预览文档分段",
  })
  @ApiBody({
    description: "multipart 表单：file 必填，其余分块参数可选",
    required: true,
    schema: {
      properties: {
        chunkOverlap: { description: "可选：分段重叠长度", type: "number" },
        chunkSize: { description: "可选：分段最大长度", type: "number" },
        file: { description: "要预览的文档文件", format: "binary", type: "string" },
        separator: { description: "可选：分段标识符，如 \\n\\n", type: "string" },
        tableChunkMode: { ...openApiTableChunkModeProperty, description: `可选。${openApiTableChunkModeProperty.description}` },
        textChunkMode: { ...openApiTextChunkModeProperty, description: `可选。${openApiTextChunkModeProperty.description}` },
      },
      required: ["file"],
      type: "object",
    },
  })
  @ApiResponse({
    description: "分段预览结果",
    schema: {
      properties: {
        chunkCount: { description: "分段总数", type: "number" },
        items: {
          items: {
            properties: chunkPreviewItemOpenApiProperties,
            type: "object",
          },
          type: "array",
        },
      },
      type: "object",
    },
    status: 200,
  })
  public async preview(@ContextParam() context: Context) {
    const body = await context.getBody();
    if (!(body instanceof FormData)) {
      throw new BadRequestException("multipart/form-data is required");
    }
    const formData = body as FormData;
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new BadRequestException("file field is required");
    }
    return this.documentService.previewDocumentChunks(
      file,
      parseChunkingOptions({
        chunkOverlap: formData.get("chunkOverlap"),
        chunkSize: formData.get("chunkSize"),
        separator: formData.get("separator"),
        tableChunkMode: formData.get("tableChunkMode"),
        textChunkMode: formData.get("textChunkMode"),
      }),
    );
  }

  /**
   * 上传文档到指定目录。
   *
   * @description
   * 使用 `multipart/form-data` 上传文件，并要求携带 `directoryId`（知识库目录主键）。
   * @param context 请求上下文，用于读取 `FormData`。
   */
  @POST("/upload")
  @ApiOperation({
    description:
      "将文件上传到指定知识库目录（directoryId 必填）。当前默认同步等待解析、分段、向量化和索引完成；仅显式设置 INGESTION_ASYNC_ENABLED=true 时改为入队返回。",
    operationId: "uploadDocument",
    summary: "上传文档",
  })
  @ApiBody({
    description: "上传表单数据",
    required: true,
    schema: {
      properties: {
        chunkOverlap: { description: "可选：分段重叠长度", type: "number" },
        chunkSize: { description: "可选：分段最大长度", type: "number" },
        directoryId: { description: "目录主键（必填）", type: "string" },
        file: { description: "要上传的文档文件", format: "binary", type: "string" },
        separator: { description: "可选：分段标识符，如 \\n\\n", type: "string" },
        tableChunkMode: { ...openApiTableChunkModeProperty, description: `可选。${openApiTableChunkModeProperty.description}` },
        textChunkMode: { ...openApiTextChunkModeProperty, description: `可选。${openApiTextChunkModeProperty.description}` },
      },
      required: ["file", "directoryId"],
      type: "object",
    },
  })
  @ApiResponse({
    description: "上传结果",
    schema: {
      properties: {
        documentId: { description: "文档主键", type: "string" },
        importJobId: { description: "导入任务主键", type: "string" },
        status: {
          description: "文档状态（uploaded/parsing/indexed/failed/unsupported）",
          type: "string",
        },
        supportedForParsing: { description: "是否支持解析（上传文件类型是否已实现）", type: "boolean" },
      },
      type: "object",
    },
    status: 200,
  })
  public async upload(@ContextParam() context: Context) {
    const body = await context.getBody();
    if (!(body instanceof FormData)) {
      throw new BadRequestException("multipart/form-data is required");
    }

    const formData = body as FormData;
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new BadRequestException("file field is required");
    }

    const directoryId = formData.get("directoryId");
    if (typeof directoryId !== "string" || directoryId.trim() === "") {
      throw new BadRequestException("directoryId is required");
    }

    return this.documentService.uploadDocument(
      file,
      directoryId,
      parseChunkingOptions({
        chunkOverlap: formData.get("chunkOverlap"),
        chunkSize: formData.get("chunkSize"),
        separator: formData.get("separator"),
        tableChunkMode: formData.get("tableChunkMode"),
        textChunkMode: formData.get("textChunkMode"),
      }),
      undefined,
      parseDocumentMetadataFromForm(formData),
    );
  }

  @PUT("/:id/metadata")
  @ApiOperation({
    description:
      "更新文档元数据与 ACL（docType/lang/tags/aclGroupIds）。已索引文档通过 versioned generation 原子刷新 MySQL chunk 与 Qdrant payload；旧数据 aclGroupIds 为空时租户内仍可见。",
    operationId: "updateDocumentMetadata",
    summary: "更新文档元数据/ACL",
  })
  @ApiBody({
    description: "文档元数据与 ACL",
    required: true,
    schema: {
      properties: {
        aclGroupIds: { items: { type: "string" }, nullable: true, type: "array" },
        docType: { nullable: true, type: "string" },
        lang: { nullable: true, type: "string" },
        metadata: { additionalProperties: true, nullable: true, type: "object" },
        tags: { items: { type: "string" }, nullable: true, type: "array" },
      },
      type: "object",
    },
  })
  @ApiResponse({ description: "更新后的文档", status: 200 })
  public async updateMetadata(
    @Param("id")
    @ApiParam({
      description: "文档主键",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
    @Body() body: { docType?: unknown; lang?: unknown; tags?: unknown; aclGroupIds?: unknown; metadata?: unknown },
  ) {
    return this.documentService.updateDocumentMetadata(id, parseDocumentMetadataBody(body ?? {}));
  }

  /**
   * 列出所有文档（不包含目录维度过滤）。
   */
  @GET("/")
  @ApiOperation({
    description: "查询所有文档（未提供目录/关键词/时间范围过滤）。",
    operationId: "listDocuments",
    summary: "文档列表",
  })
  @ApiResponse({
    description: "文档列表",
    schema: {
      properties: {
        items: {
          items: {
            properties: {
              charCount: { description: "正文总字符数（各分段正文长度之和，索引成功后更新）", type: "number" },
              chunkingOptions: {
                description: "分段参数快照（上传/重建索引时记录）",
                properties: {
                  chunkOverlap: { description: "分段重叠长度", nullable: true, type: "number" },
                  chunkSize: { description: "分段最大长度", nullable: true, type: "number" },
                  separator: { description: "分段标识符", nullable: true, type: "string" },
                  tableChunkMode: { ...openApiTableChunkModeProperty, nullable: true },
                  textChunkMode: { ...openApiTextChunkModeProperty, nullable: true },
                },
                type: "object",
              },
              createBy: { description: "创建者名称", type: "string" },
              createTime: { description: "创建时间", format: "date-time", type: "string" },
              creatorId: { description: "创建者主体 id", nullable: true, type: "string" },
              creatorType: { description: "创建者主体类型", nullable: true, type: "string" },
              deleted: { description: "软删除标记", nullable: true, type: "string" },
              directoryId: { description: "目录主键", nullable: true, type: "string" },
              errorMessage: { description: "失败原因", nullable: true, type: "string" },
              extension: { description: "文件扩展名", type: "string" },
              id: { description: "文档主键", type: "string" },
              indexStatus: { description: "索引状态", type: "string" },
              mimeType: { description: "MIME 类型", type: "string" },
              name: { description: "文档文件名", type: "string" },
              parseStatus: { description: "解析状态", type: "string" },
              recallCount: { description: "召回次数（累计）", type: "number" },
              size: { description: "文件大小（字节）", type: "number" },
              status: { description: "文档状态", type: "string" },
              storageBucket: { description: "对象存储桶名", type: "string" },
              storageKey: { description: "对象存储 key", type: "string" },
              tenantId: { description: "租户标识", nullable: true, type: "string" },
              updateBy: { description: "更新者名称", type: "string" },
              updateTime: { description: "更新时间", format: "date-time", type: "string" },
              updaterId: { description: "更新者主体 id", nullable: true, type: "string" },
              updaterType: { description: "更新者主体类型", nullable: true, type: "string" },
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
  public async list() {
    return {
      items: await this.documentService.listDocuments(),
    };
  }

  @POST("/:id/preview")
  @ApiOperation({
    description:
      "根据 documentId 预览分段：已有持久化 chunks 时直接返回；普通未拆分文档从对象存储读取原文件并在当前请求内执行只读拆分，不写入 embedding/MySQL chunks/Qdrant。明确失败或不支持格式时返回对应终态。",
    operationId: "previewDocumentChunksById",
    summary: "预览已上传文档分段",
  })
  @ApiResponse({
    description: "已持久化或本次只读拆分得到的分段；明确失败/不支持时返回终态",
    schema: {
      properties: {
        chunkCount: { description: "分段总数", type: "number" },
        documentStatus: { description: "文档失败/不支持时的状态", nullable: true, type: "string" },
        errorMessage: { description: "摄入错误；无错误时为空", nullable: true, type: "string" },
        indexStatus: { description: "文档失败/不支持时的索引状态", nullable: true, type: "string" },
        items: {
          items: {
            properties: chunkPreviewItemOpenApiProperties,
            type: "object",
          },
          type: "array",
        },
        parseStatus: { description: "文档失败/不支持时的解析状态", nullable: true, type: "string" },
        previewStatus: {
          description: "同步预览结果：ready/failed/unsupported",
          type: "string",
        },
      },
      type: "object",
    },
    status: 200,
  })
  public async previewById(
    @ContextParam() context: Context,
    @Param("id")
    @ApiParam({
      description: "文档主键",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
  ) {
    const body = await context.getBody();
    const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    return this.documentService.previewDocumentChunksById(id, parsePlatformDocumentSyncContext(payload));
  }

  /**
   * 删除文档（逻辑删除 + 向量索引删除 + 文件关联删除）。
   * @param id 文档主键
   */
  @DELETE("/:id")
  @ApiOperation({
    description: "根据 documentId 删除文档记录及其索引/文件关联关系。",
    operationId: "deleteDocument",
    summary: "删除文档",
  })
  @ApiResponse({
    description: "删除成功",
    schema: {
      properties: {
        ok: { description: "删除结果", type: "boolean" },
      },
      type: "object",
    },
    status: 200,
  })
  public async remove(
    @Param("id")
    @ApiParam({
      description: "文档主键",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
  ) {
    await this.documentService.deleteDocument(id);
    return { ok: true };
  }

  @GET("/:id/chunks")
  @ApiOperation({
    description: "按 documentId 查询当前已保存的分段列表。",
    operationId: "listDocumentChunks",
    summary: "文档分段列表",
  })
  @ApiResponse({
    description: "分段列表",
    schema: {
      properties: {
        items: {
          items: {
            properties: documentChunkListItemOpenApiProperties,
            type: "object",
          },
          type: "array",
        },
      },
      type: "object",
    },
    status: 200,
  })
  public async listChunks(
    @Param("id")
    @ApiParam({
      description: "文档主键",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
  ) {
    return this.documentService.listDocumentChunks(id);
  }

  @GET("/chunks/:chunkId")
  @ApiOperation({
    description: "按 chunkId 查询当前租户内的只读来源详情；不存在与错租户统一返回 404，不返回 embeddingText。",
    operationId: "getDocumentChunkDetail",
    summary: "查询分段来源详情",
  })
  @ApiResponse({
    description: "分段来源详情",
    schema: {
      properties: {
        chunkId: { type: "string" },
        documentId: { type: "string" },
        fileName: { type: "string" },
        headingPath: { items: { type: "string" }, type: "array" },
        pageNo: { nullable: true, type: "number" },
        sectionId: { type: "string" },
        sourceType: { type: "string" },
        text: { type: "string" },
      },
      type: "object",
    },
    status: 200,
  })
  public async getChunkDetail(
    @Param("chunkId")
    @ApiParam({
      description: "分段主键",
      in: "path",
      name: "chunkId",
      required: true,
      schema: { type: "string" },
    })
    chunkId: string,
  ) {
    return this.documentService.getDocumentChunkDetail(chunkId);
  }

  @PUT("/:documentId/chunks/:chunkId")
  @ApiOperation({
    description:
      "更新指定 chunk 的正文。可选通过 keywordsAdd / keywordsRemove 对关键词集合做增量调整（追加前去重，移除时按字符串精确匹配已有关键词）。",
    operationId: "updateDocumentChunk",
    summary: "更新分段正文",
  })
  @ApiBody({
    description: "更新分段正文与可选关键词变更",
    required: true,
    schema: {
      properties: {
        keywordsAdd: {
          description: "要追加的关键词（与已有去重后追加到末尾）",
          items: { type: "string" },
          type: "array",
        },
        keywordsRemove: {
          description: "要移除的关键词（与现有关键词 trim 后精确匹配则移除）",
          items: { type: "string" },
          type: "array",
        },
        text: { description: "新的 chunk 正文", type: "string" },
      },
      required: ["text"],
      type: "object",
    },
  })
  @ApiResponse({
    description: "更新后的分段",
    schema: {
      properties: documentChunkListItemOpenApiProperties,
      type: "object",
    },
    status: 200,
  })
  public async updateChunk(
    @Param("documentId")
    @ApiParam({
      description: "文档主键",
      in: "path",
      name: "documentId",
      required: true,
      schema: { type: "string" },
    })
    documentIdRaw: string,
    @Param("chunkId")
    @ApiParam({
      description: "分段主键",
      in: "path",
      name: "chunkId",
      required: true,
      schema: { type: "string" },
    })
    chunkId: string,
    @Body() body: { text?: string; keywordsAdd?: unknown; keywordsRemove?: unknown },
  ) {
    if (!body?.text || typeof body.text !== "string") {
      throw new BadRequestException("text is required");
    }
    const keywordMutations =
      body.keywordsAdd !== undefined || body.keywordsRemove !== undefined
        ? {
            keywordsAdd: body.keywordsAdd !== undefined ? parseStringArray(body.keywordsAdd, "keywordsAdd") : [],
            keywordsRemove: body.keywordsRemove !== undefined ? parseStringArray(body.keywordsRemove, "keywordsRemove") : [],
          }
        : undefined;
    return this.documentService.updateDocumentChunk(documentIdRaw, chunkId, body.text, keywordMutations);
  }

  /**
   * 触发文档重索引（重新解析/重分块/重向量化）。
   * @param id 文档主键
   */
  @POST("/:id/reindex")
  @ApiOperation({
    description:
      "对指定文档重新解析、分段、向量化并重建索引。当前默认同步等待全部步骤完成；仅显式设置 INGESTION_ASYNC_ENABLED=true 时改为入队返回。",
    operationId: "reindexDocument",
    summary: "文档重建索引",
  })
  @ApiResponse({
    description: "重索引结果",
    schema: {
      properties: {
        documentId: { description: "文档主键", type: "string" },
        importJobId: { description: "导入任务主键", type: "string" },
        status: { description: "文档状态", type: "string" },
        supportedForParsing: { description: "是否支持解析（上传文件类型是否已实现）", type: "boolean" },
      },
      type: "object",
    },
    status: 200,
  })
  @ApiBody({
    description: "可选重建索引参数",
    required: false,
    schema: {
      properties: {
        chunkOverlap: { description: "可选：分段重叠长度", type: "number" },
        chunkSize: { description: "可选：分段最大长度", type: "number" },
        forceFull: {
          description: "可选：true 时全量 wipe + re-embed（W3.5；与 W3.3 队列字段兼容）",
          type: "boolean",
        },
        separator: { description: "可选：分段标识符，如 \\n\\n", type: "string" },
        tableChunkMode: { ...openApiTableChunkModeProperty, description: `可选。${openApiTableChunkModeProperty.description}` },
        textChunkMode: { ...openApiTextChunkModeProperty, description: `可选。${openApiTextChunkModeProperty.description}` },
      },
      type: "object",
    },
  })
  public async reindex(
    @ContextParam() context: Context,
    @Param("id")
    @ApiParam({
      description: "文档主键",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
  ) {
    const body = await context.getBody();
    const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const chunkingOptions = parseChunkingOptions({
      chunkOverlap: payload.chunkOverlap,
      chunkSize: payload.chunkSize,
      separator: payload.separator,
      tableChunkMode: payload.tableChunkMode,
      textChunkMode: payload.textChunkMode,
    });
    const forceFull = payload.forceFull === true || payload.forceFull === "true";
    return this.documentService.reindexDocument(id, chunkingOptions, parsePlatformDocumentSyncContext(payload, chunkingOptions), {
      forceFull,
    });
  }

  @POST("/import-from-platform")
  @ApiOperation({
    description: "从 cube2 平台知识库（by platformKbId）拉取源文档并摄入到指定目录（directoryId）。",
    operationId: "importDocumentsFromPlatform",
    summary: "从平台知识库导入源文档",
  })
  @ApiBody({
    description: "平台导入参数",
    required: true,
    schema: {
      properties: {
        directoryId: { description: "本地知识库目录主键（目标目录）", type: "string" },
        platformKbId: { description: "平台知识库外部 ID", type: "string" },
      },
      required: ["platformKbId", "directoryId"],
      type: "object",
    },
  })
  @ApiResponse({
    description: "导入结果",
    schema: {
      properties: {
        errorDetails: {
          items: {
            properties: {
              error: { type: "string" },
              externalId: { type: "string" },
            },
            type: "object",
          },
          type: "array",
        },
        errors: { description: "失败数量", type: "number" },
        imported: { description: "成功导入数量", type: "number" },
      },
      type: "object",
    },
    status: 200,
  })
  public async importFromPlatform(@Body() body: { platformKbId?: string; directoryId?: string }) {
    if (!body?.platformKbId || typeof body.platformKbId !== "string") {
      throw new BadRequestException("platformKbId is required");
    }
    if (!body?.directoryId || typeof body.directoryId !== "string") {
      throw new BadRequestException("directoryId is required");
    }
    return this.platformSourceImportService.importFromPlatformKb(body.platformKbId, body.directoryId);
  }
}
