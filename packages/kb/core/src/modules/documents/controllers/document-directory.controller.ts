import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  BadRequestException,
  Body,
  Controller,
  DELETE,
  Param,
  POST,
  PUT,
} from '@dangao/bun-server'
import { MockableEndpoint } from '@/infrastructure/mock-endpoint'
import { openApiTableChunkModeProperty, openApiTextChunkModeProperty } from './document.controller'
import { DocumentDirectoryService } from '../services/document-directory.service'
import { DocumentService } from '../services/document.service'
import { parsePeriodRange, type PeriodRange } from '../services/period-range'

@Controller('/documents/directories')
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
  @POST('/')
  @ApiOperation({
    summary: '创建目录',
    description: '在当前租户下创建一个知识库目录。',
    operationId: 'createDirectory',
  })
  @ApiBody({
    description: '创建目录参数',
    required: true,
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '目录名称（必填）' },
        description: { type: 'string', nullable: true, description: '目录描述（可选，最长 2000 字符）' },
        icon: { type: 'string', nullable: true, description: '图标 URL 或标识（可选，最长 512 字符）' },
      },
      required: ['name'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '创建结果',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '目录主键' },
      },
    },
  })
  public async create(
    @Body() body: { name?: string; description?: string | null; icon?: string | null },
  ) {
    const name = body?.name
    if (!name || typeof name !== 'string') {
      throw new BadRequestException('name is required')
    }
    const id = await this.directoryService.createDirectory({
      name,
      description: body.description,
      icon: body.icon,
    })
    return { id }
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
  @POST('/list')
  @ApiOperation({
    summary: '目录列表',
    description: '支持分页、keyword（按 name / description LIKE）和 period（按 create_time 过滤）。',
    operationId: 'listDirectories',
  })
  @ApiBody({
    description: '筛选条件',
    required: true,
    schema: {
      type: 'object',
      properties: {
        pageNumber: { type: 'number', description: '页码（默认 1，>=1）' },
        pageSize: { type: 'number', description: '每页数量（默认 20，<=200）' },
        keyword: { type: 'string', description: '关键字（按目录 name、description 模糊匹配）' },
        period: {
          type: 'object',
          description: '时间范围（yyyy-MM-dd HH:mm:ss）',
          properties: {
            startTime: { type: 'string', description: '开始时间（yyyy-MM-dd HH:mm:ss）' },
            endTime: { type: 'string', description: '结束时间（yyyy-MM-dd HH:mm:ss）' },
          },
          required: ['startTime', 'endTime'],
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '目录列表结果',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '目录主键' },
              name: { type: 'string', description: '目录名称' },
              description: { type: 'string', nullable: true, description: '目录描述' },
              icon: { type: 'string', nullable: true, description: '图标 URL 或标识' },
              documentCount: { type: 'number', description: '目录下未删除文档数量' },
              totalSizeBytes: { type: 'number', description: '目录下未删除文档文件大小合计（字节）' },
              updateTime: { type: 'string', format: 'date-time', description: '目录记录更新时间' },
            },
          },
        },
        total: { type: 'number', description: '总数' },
        pages: { type: 'number', description: '总页数' },
      },
    },
  })
  public async list(
    @Body()
    body: {
      pageNumber?: number
      pageSize?: number
      keyword?: string | null
      period?: Partial<PeriodRange>
    },
  ) {
    const pageNumber = body?.pageNumber ?? 1
    const pageSize = body?.pageSize ?? 20
    const keyword = typeof body?.keyword === 'string' ? body?.keyword : null
    const period = parsePeriodRange(body?.period)

    if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
      throw new BadRequestException('invalid pageNumber')
    }
    if (!Number.isFinite(pageSize) || pageSize <= 0 || pageSize > 200) {
      throw new BadRequestException('invalid pageSize')
    }

    return await this.directoryService.searchDirectories({
      pageNumber,
      pageSize,
      keyword,
      period,
    })
  }

  /**
   * 删除知识库目录（先删除目录下全部文档，再软删除目录）。
   *
   * @param id 目录主键
   */
  @DELETE('/:id')
  @ApiOperation({
    summary: '删除目录',
    description: '删除目录下全部文档（含向量与文件关联）后，软删除目录记录。',
    operationId: 'deleteDirectory',
  })
  @ApiResponse({
    status: 200,
    description: '删除成功',
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', description: '是否成功' },
      },
    },
  })
  public async remove(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '目录主键',
      schema: { type: 'string' },
    })
    id: string,
  ) {
    return this.directoryService.deleteDirectory(id)
  }

  /**
   * 修改知识库目录（名称、描述、图标至少传一项）。
   * 与 `POST /:id/update` 行为一致，按项目习惯任选其一即可。
   */
  @PUT('/:id')
  @ApiOperation({
    summary: '修改目录',
    description: '更新目录名称、描述或图标；至少提供其中一项。请求体与响应字段均为小驼峰。',
    operationId: 'updateDirectory',
  })
  @ApiBody({
    description: '更新字段（至少一项）',
    required: true,
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '目录名称' },
        description: { type: 'string', nullable: true, description: '目录描述（可传 null 清空）' },
        icon: { type: 'string', nullable: true, description: '图标（可传 null 清空）' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '更新后的目录（含统计与更新时间）',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '目录主键' },
        name: { type: 'string', description: '目录名称' },
        description: { type: 'string', nullable: true, description: '目录描述' },
        icon: { type: 'string', nullable: true, description: '图标' },
        documentCount: { type: 'number', description: '目录下未删除文档数量' },
        totalSizeBytes: { type: 'number', description: '目录下未删除文档大小合计（字节）' },
        updateTime: { type: 'string', format: 'date-time', description: '目录记录更新时间' },
      },
    },
  })
  public async update(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '目录主键',
      schema: { type: 'string' },
    })
    id: string,
    @Body() body: { name?: string; description?: string | null; icon?: string | null },
  ) {
    return this.directoryService.updateDirectory(id, body)
  }

  /**
   * 修改知识库目录（POST，与 `PUT /:id` 等价，便于仅开放 POST 的网关或前端统一用 POST）。
   */
  @POST('/:id/update')
  @ApiOperation({
    summary: '修改目录（POST）',
    description: '与 `PUT /documents/directories/:id` 相同：更新名称、描述或图标，至少一项。',
    operationId: 'updateDirectoryPost',
  })
  @ApiBody({
    description: '更新字段（至少一项）',
    required: true,
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '目录名称' },
        description: { type: 'string', nullable: true, description: '目录描述（可传 null 清空）' },
        icon: { type: 'string', nullable: true, description: '图标（可传 null 清空）' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '更新后的目录（含统计与更新时间）',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '目录主键' },
        name: { type: 'string', description: '目录名称' },
        description: { type: 'string', nullable: true, description: '目录描述' },
        icon: { type: 'string', nullable: true, description: '图标' },
        documentCount: { type: 'number', description: '目录下未删除文档数量' },
        totalSizeBytes: { type: 'number', description: '目录下未删除文档大小合计（字节）' },
        updateTime: { type: 'string', format: 'date-time', description: '目录记录更新时间' },
      },
    },
  })
  public async updateByPost(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '目录主键',
      schema: { type: 'string' },
    })
    id: string,
    @Body() body: { name?: string; description?: string | null; icon?: string | null },
  ) {
    return this.directoryService.updateDirectory(id, body)
  }

  /**
   * 查询指定目录下的文档列表（分页 + 关键字 + 时间范围）。
   *
   * @param id 目录主键（directoryId）
   * @param body.pageNumber 页码（默认 1）
   * @param body.pageSize 每页数量（默认 20，最大 200）
   * @param body.keyword 关键字（按文档 name 模糊匹配，可不传）
   */
  @POST('/:id/documents/list')
  @ApiOperation({
    summary: '目录下文档列表',
    description: '按 directoryId 查询文档（支持分页、keyword 和 period）。',
    operationId: 'listDocumentsByDirectory',
  })
  @ApiBody({
    description: '筛选条件',
    required: true,
    schema: {
      type: 'object',
      properties: {
        pageNumber: { type: 'number', description: '页码（默认 1，>=1）' },
        pageSize: { type: 'number', description: '每页数量（默认 20，<=200）' },
        keyword: { type: 'string', description: '关键字（按 document name 模糊匹配）' },
        period: {
          type: 'object',
          description: '时间范围（yyyy-MM-dd HH:mm:ss）',
          properties: {
            startTime: { type: 'string', description: '开始时间（yyyy-MM-dd HH:mm:ss）' },
            endTime: { type: 'string', description: '结束时间（yyyy-MM-dd HH:mm:ss）' },
          },
          required: ['startTime', 'endTime'],
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '文档列表结果',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '文档主键' },
              tenantId: { type: 'string', nullable: true, description: '租户标识' },
              deleted: { type: 'string', nullable: true, description: '软删除标记' },
              createBy: { type: 'string', description: '创建者名称' },
              creatorId: { type: 'string', nullable: true, description: '创建者主体 id' },
              creatorType: { type: 'string', nullable: true, description: '创建者主体类型' },
              createTime: { type: 'string', format: 'date-time', description: '创建时间' },
              updateBy: { type: 'string', description: '更新者名称' },
              updaterId: { type: 'string', nullable: true, description: '更新者主体 id' },
              updaterType: { type: 'string', nullable: true, description: '更新者主体类型' },
              updateTime: { type: 'string', format: 'date-time', description: '更新时间' },
              name: { type: 'string', description: '文档文件名' },
              mimeType: { type: 'string', description: 'MIME 类型' },
              extension: { type: 'string', description: '文件扩展名' },
              size: { type: 'number', description: '文件大小（字节）' },
              storageBucket: { type: 'string', description: '对象存储桶名' },
              storageKey: { type: 'string', description: '对象存储 key' },
              directoryId: { type: 'string', nullable: true, description: '目录主键' },
              status: { type: 'string', description: '文档状态' },
              parseStatus: { type: 'string', description: '解析状态' },
              indexStatus: { type: 'string', description: '索引状态' },
              errorMessage: { type: 'string', nullable: true, description: '失败原因' },
              recallCount: { type: 'number', description: '召回次数（累计）' },
              charCount: { type: 'number', description: '正文总字符数（各分段正文长度之和）' },
              chunkingOptions: {
                type: 'object',
                description: '分段参数快照（上传/重建索引时记录）',
                properties: {
                  separator: { type: 'string', nullable: true, description: '分段标识符' },
                  chunkSize: { type: 'number', nullable: true, description: '分段最大长度' },
                  chunkOverlap: { type: 'number', nullable: true, description: '分段重叠长度' },
                  tableChunkMode: { ...openApiTableChunkModeProperty, nullable: true },
                  textChunkMode: { ...openApiTextChunkModeProperty, nullable: true },
                },
              },
            },
          },
        },
        total: { type: 'number', description: '总数' },
        pages: { type: 'number', description: '总页数' },
      },
    },
  })
  public async listDocuments(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '目录主键（directoryId）',
      schema: { type: 'string' },
    })
    id: string,
    @Body()
    body: {
      pageNumber?: number
      pageSize?: number
      keyword?: string | null
      period?: Partial<PeriodRange>
    },
  ) {
    const pageNumber = body?.pageNumber ?? 1
    const pageSize = body?.pageSize ?? 20
    const keyword = typeof body?.keyword === 'string' ? body?.keyword : null
    const period = parsePeriodRange(body?.period)

    if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
      throw new BadRequestException('invalid pageNumber')
    }
    if (!Number.isFinite(pageSize) || pageSize <= 0 || pageSize > 200) {
      throw new BadRequestException('invalid pageSize')
    }

    return await this.documentService.searchDocumentsByDirectory({
      directoryId: id,
      pageNumber,
      pageSize,
      keyword,
      period,
    })
  }
}

