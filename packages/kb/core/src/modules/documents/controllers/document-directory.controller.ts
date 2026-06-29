import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  BadRequestException,
  Body,
  Controller,
  DELETE,
  POST,
  PUT,
  Param,
} from "@dangao/bun-server";

import { DocumentDirectoryService } from "../services/document-directory.service";
import { DocumentService } from "../services/document.service";
import { type PeriodRange, parsePeriodRange } from "../services/period-range";
import { openApiTableChunkModeProperty, openApiTextChunkModeProperty } from "./document.controller";

@Controller("/documents/directories")
export class DocumentDirectoryController {
  public constructor(
    private readonly directoryService: DocumentDirectoryService,
    private readonly documentService: DocumentService,
  ) {}

  /**
   * 创建知识库目录。
   *
   * @param body.name 目录名称（必填）
   */
  @POST("/")
  @ApiOperation({
    description: "在当前租户下创建一个知识库目录。",
    operationId: "createDirectory",
    summary: "创建目录",
  })
  @ApiBody({
    description: "创建目录参数",
    required: true,
    schema: {
      properties: {
        description: { description: "目录描述（可选，最长 2000 字符）", nullable: true, type: "string" },
        icon: { description: "图标 URL 或标识（可选，最长 512 字符）", nullable: true, type: "string" },
        name: { description: "目录名称（必填）", type: "string" },
      },
      required: ["name"],
      type: "object",
    },
  })
  @ApiResponse({
    description: "创建结果",
    schema: {
      properties: {
        id: { description: "目录主键", type: "string" },
      },
      type: "object",
    },
    status: 200,
  })
  public async create(@Body() body: { name?: string; description?: string | null; icon?: string | null }) {
    const name = body?.name;
    if (!name || typeof name !== "string") {
      throw new BadRequestException("name is required");
    }
    const id = await this.directoryService.createDirectory({
      description: body.description,
      icon: body.icon,
      name,
    });
    return { id };
  }

  /**
   * 目录列表（分页 + 关键字 + 时间范围）。
   *
   * @param body.period.startTime 格式：yyyy-MM-dd HH:mm:ss
   * @param body.period.endTime 格式：yyyy-MM-dd HH:mm:ss
   * @param body.pageNumber 页码（默认 1）
   * @param body.pageSize 每页数量（默认 20，最大 200）
   * @param body.keyword 关键字（按目录 name / description 模糊匹配，可不传）
   */
  @POST("/list")
  @ApiOperation({
    description: "支持分页、keyword（按 name / description LIKE）和 period（按 create_time 过滤）。",
    operationId: "listDirectories",
    summary: "目录列表",
  })
  @ApiBody({
    description: "筛选条件",
    required: true,
    schema: {
      properties: {
        keyword: { description: "关键字（按目录 name、description 模糊匹配）", type: "string" },
        pageNumber: { description: "页码（默认 1，>=1）", type: "number" },
        pageSize: { description: "每页数量（默认 20，<=200）", type: "number" },
        period: {
          description: "时间范围（yyyy-MM-dd HH:mm:ss）",
          properties: {
            endTime: { description: "结束时间（yyyy-MM-dd HH:mm:ss）", type: "string" },
            startTime: { description: "开始时间（yyyy-MM-dd HH:mm:ss）", type: "string" },
          },
          required: ["startTime", "endTime"],
          type: "object",
        },
      },
      type: "object",
    },
  })
  @ApiResponse({
    description: "目录列表结果",
    schema: {
      properties: {
        items: {
          items: {
            properties: {
              description: { description: "目录描述", nullable: true, type: "string" },
              documentCount: { description: "目录下未删除文档数量", type: "number" },
              icon: { description: "图标 URL 或标识", nullable: true, type: "string" },
              id: { description: "目录主键", type: "string" },
              name: { description: "目录名称", type: "string" },
              totalSizeBytes: { description: "目录下未删除文档文件大小合计（字节）", type: "number" },
              updateTime: { description: "目录记录更新时间", format: "date-time", type: "string" },
            },
            type: "object",
          },
          type: "array",
        },
        pages: { description: "总页数", type: "number" },
        total: { description: "总数", type: "number" },
      },
      type: "object",
    },
    status: 200,
  })
  public async list(
    @Body()
    body: { pageNumber?: number; pageSize?: number; keyword?: string | null; period?: Partial<PeriodRange> },
  ) {
    const pageNumber = body?.pageNumber ?? 1;
    const pageSize = body?.pageSize ?? 20;
    const keyword = typeof body?.keyword === "string" ? body?.keyword : null;
    const period = parsePeriodRange(body?.period);

    if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
      throw new BadRequestException("invalid pageNumber");
    }
    if (!Number.isFinite(pageSize) || pageSize <= 0 || pageSize > 200) {
      throw new BadRequestException("invalid pageSize");
    }

    return await this.directoryService.searchDirectories({
      keyword,
      pageNumber,
      pageSize,
      period,
    });
  }

  /**
   * 删除知识库目录（先删除目录下全部文档，再软删除目录）。
   *
   * @param id 目录主键
   */
  @DELETE("/:id")
  @ApiOperation({
    description: "删除目录下全部文档（含向量与文件关联）后，软删除目录记录。",
    operationId: "deleteDirectory",
    summary: "删除目录",
  })
  @ApiResponse({
    description: "删除成功",
    schema: {
      properties: {
        ok: { description: "是否成功", type: "boolean" },
      },
      type: "object",
    },
    status: 200,
  })
  public async remove(
    @Param("id")
    @ApiParam({
      description: "目录主键",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
  ) {
    return this.directoryService.deleteDirectory(id);
  }

  /**
   * 修改知识库目录（名称、描述、图标至少传一项）。
   * 与 `POST /:id/update` 行为一致，按项目习惯任选其一即可。
   */
  @PUT("/:id")
  @ApiOperation({
    description: "更新目录名称、描述或图标；至少提供其中一项。请求体与响应字段均为小驼峰。",
    operationId: "updateDirectory",
    summary: "修改目录",
  })
  @ApiBody({
    description: "更新字段（至少一项）",
    required: true,
    schema: {
      properties: {
        description: { description: "目录描述（可传 null 清空）", nullable: true, type: "string" },
        icon: { description: "图标（可传 null 清空）", nullable: true, type: "string" },
        name: { description: "目录名称", type: "string" },
      },
      type: "object",
    },
  })
  @ApiResponse({
    description: "更新后的目录（含统计与更新时间）",
    schema: {
      properties: {
        description: { description: "目录描述", nullable: true, type: "string" },
        documentCount: { description: "目录下未删除文档数量", type: "number" },
        icon: { description: "图标", nullable: true, type: "string" },
        id: { description: "目录主键", type: "string" },
        name: { description: "目录名称", type: "string" },
        totalSizeBytes: { description: "目录下未删除文档大小合计（字节）", type: "number" },
        updateTime: { description: "目录记录更新时间", format: "date-time", type: "string" },
      },
      type: "object",
    },
    status: 200,
  })
  public async update(
    @Param("id")
    @ApiParam({
      description: "目录主键",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
    @Body() body: { name?: string; description?: string | null; icon?: string | null },
  ) {
    return this.directoryService.updateDirectory(id, body);
  }

  /**
   * 修改知识库目录（POST，与 `PUT /:id` 等价，便于仅开放 POST 的网关或前端统一用 POST）。
   */
  @POST("/:id/update")
  @ApiOperation({
    description: "与 `PUT /documents/directories/:id` 相同：更新名称、描述或图标，至少一项。",
    operationId: "updateDirectoryPost",
    summary: "修改目录（POST）",
  })
  @ApiBody({
    description: "更新字段（至少一项）",
    required: true,
    schema: {
      properties: {
        description: { description: "目录描述（可传 null 清空）", nullable: true, type: "string" },
        icon: { description: "图标（可传 null 清空）", nullable: true, type: "string" },
        name: { description: "目录名称", type: "string" },
      },
      type: "object",
    },
  })
  @ApiResponse({
    description: "更新后的目录（含统计与更新时间）",
    schema: {
      properties: {
        description: { description: "目录描述", nullable: true, type: "string" },
        documentCount: { description: "目录下未删除文档数量", type: "number" },
        icon: { description: "图标", nullable: true, type: "string" },
        id: { description: "目录主键", type: "string" },
        name: { description: "目录名称", type: "string" },
        totalSizeBytes: { description: "目录下未删除文档大小合计（字节）", type: "number" },
        updateTime: { description: "目录记录更新时间", format: "date-time", type: "string" },
      },
      type: "object",
    },
    status: 200,
  })
  public async updateByPost(
    @Param("id")
    @ApiParam({
      description: "目录主键",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
    @Body() body: { name?: string; description?: string | null; icon?: string | null },
  ) {
    return this.directoryService.updateDirectory(id, body);
  }

  /**
   * 查询指定目录下的文档列表（分页 + 关键字 + 时间范围）。
   *
   * @param id 目录主键（directoryId）
   * @param body.pageNumber 页码（默认 1）
   * @param body.pageSize 每页数量（默认 20，最大 200）
   * @param body.keyword 关键字（按文档 name 模糊匹配，可不传）
   */
  @POST("/:id/documents/list")
  @ApiOperation({
    description: "按 directoryId 查询文档（支持分页、keyword 和 period）。",
    operationId: "listDocumentsByDirectory",
    summary: "目录下文档列表",
  })
  @ApiBody({
    description: "筛选条件",
    required: true,
    schema: {
      properties: {
        keyword: { description: "关键字（按 document name 模糊匹配）", type: "string" },
        pageNumber: { description: "页码（默认 1，>=1）", type: "number" },
        pageSize: { description: "每页数量（默认 20，<=200）", type: "number" },
        period: {
          description: "时间范围（yyyy-MM-dd HH:mm:ss）",
          properties: {
            endTime: { description: "结束时间（yyyy-MM-dd HH:mm:ss）", type: "string" },
            startTime: { description: "开始时间（yyyy-MM-dd HH:mm:ss）", type: "string" },
          },
          required: ["startTime", "endTime"],
          type: "object",
        },
      },
      type: "object",
    },
  })
  @ApiResponse({
    description: "文档列表结果",
    schema: {
      properties: {
        items: {
          items: {
            properties: {
              charCount: { description: "正文总字符数（各分段正文长度之和）", type: "number" },
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
        pages: { description: "总页数", type: "number" },
        total: { description: "总数", type: "number" },
      },
      type: "object",
    },
    status: 200,
  })
  public async listDocuments(
    @Param("id")
    @ApiParam({
      description: "目录主键（directoryId）",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
    @Body()
    body: {
      pageNumber?: number;
      pageSize?: number;
      keyword?: string | null;
      period?: Partial<PeriodRange>;
    },
  ) {
    const pageNumber = body?.pageNumber ?? 1;
    const pageSize = body?.pageSize ?? 20;
    const keyword = typeof body?.keyword === "string" ? body?.keyword : null;
    const period = parsePeriodRange(body?.period);

    if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
      throw new BadRequestException("invalid pageNumber");
    }
    if (!Number.isFinite(pageSize) || pageSize <= 0 || pageSize > 200) {
      throw new BadRequestException("invalid pageSize");
    }

    return await this.documentService.searchDocumentsByDirectory({
      directoryId: id,
      keyword,
      pageNumber,
      pageSize,
      period,
    });
  }
}
