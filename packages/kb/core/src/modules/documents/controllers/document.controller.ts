import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  BadRequestException,
  Body,
  Controller,
  ContextParam,
  type Context,
  DELETE,
  GET,
  Param,
  POST,
  PUT,
} from '@dangao/bun-server'
import { MockableEndpoint } from '@/infra/mock-endpoint'
import { DocumentService } from '../services/document.service'
import type { ChunkingOptions, TableChunkMode, TextChunkMode } from '../../common/document-types'
import { PlatformSourceImportService } from '../../ingestion/platform-source-import.service'
import { parsePlatformDocumentSyncContext } from '../../../port/document-platform-sync.port'

function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequestException(`invalid ${fieldName}`)
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new BadRequestException(`invalid ${fieldName}`)
  }
  return parsed
}

function parseOptionalNonNegativeInteger(value: unknown, fieldName: string): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequestException(`invalid ${fieldName}`)
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new BadRequestException(`invalid ${fieldName}`)
  }
  return parsed
}

function parseOptionalEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[],
): T | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(`invalid ${fieldName}`)
  }
  if (!allowedValues.includes(value as T)) {
    throw new BadRequestException(`invalid ${fieldName}`)
  }
  return value as T
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined || value === null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new BadRequestException(`invalid ${fieldName}: expected array of strings`)
  }
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new BadRequestException(`invalid ${fieldName}: expected array of strings`)
    }
    out.push(item)
  }
  return out
}

function parseChunkingOptions(payload: {
  separator?: unknown
  chunkSize?: unknown
  chunkOverlap?: unknown
  tableChunkMode?: unknown
  textChunkMode?: unknown
}): ChunkingOptions | undefined {
  const separator = typeof payload.separator === 'string' && payload.separator.trim() !== '' ? payload.separator : undefined
  const chunkSize = parseOptionalPositiveInteger(payload.chunkSize, 'chunkSize')
  const chunkOverlap = parseOptionalNonNegativeInteger(payload.chunkOverlap, 'chunkOverlap')
  const tableChunkMode = parseOptionalEnum<TableChunkMode>(payload.tableChunkMode, 'tableChunkMode', ['auto', 'row', 'window'])
  const textChunkMode = parseOptionalEnum<TextChunkMode>(payload.textChunkMode, 'textChunkMode', ['auto', 'block', 'merge'])

  return separator !== undefined
    || chunkSize !== undefined
    || chunkOverlap !== undefined
    || tableChunkMode !== undefined
    || textChunkMode !== undefined
    ? { separator, chunkSize, chunkOverlap, tableChunkMode, textChunkMode }
    : undefined
}

/** OpenAPI：表格分段模式（与 ChunkingOptions.tableChunkMode 一致），便于前端展示枚举中文含义 */
export const openApiTableChunkModeProperty = {
  type: 'string',
  enum: ['auto', 'row', 'window'],
  description:
    '表格分段模式（主要影响 Excel .xlsx / .xls、.csv 等表格类文件）。'
    + 'auto：自动（默认）— 按表结构疏密在「按行」与「按窗口」之间自动选择；'
    + 'row：按行— 每条数据行尽量单独成一段；'
    + 'window：按窗口— 多行合并为一段。'
    + '对 PDF/Word/PPT 等由解析服务产出的表格块影响有限。',
} as const

/** OpenAPI：文本二次分段模式（与 ChunkingOptions.textChunkMode 一致） */
export const openApiTextChunkModeProperty = {
  type: 'string',
  enum: ['auto', 'block', 'merge'],
  description:
    '文本二次分段策略（在解析得到的段落上再切分；未传时服务端默认 auto）。'
    + 'auto：自动（默认）— 检测到多标题/多列表等结构时按「块」策略切分；'
    + 'block：按块— 标题与其后段落尽量保持在同一段；'
    + 'merge：合并— 与 auto 在非块场景下行为一致，尽量合并相邻短段。',
} as const

const chunkSemanticMetadataOpenApiProperties = {
  sheetName: { type: 'string', nullable: true, description: '工作表名（表格类）' },
  tableId: { type: 'string', nullable: true, description: '表格标识' },
  rowStart: { type: 'number', nullable: true, description: '起始行' },
  rowEnd: { type: 'number', nullable: true, description: '结束行' },
  headers: { type: 'array', items: { type: 'string' }, description: '表头' },
  keywords: { type: 'array', items: { type: 'string' }, description: '关键词' },
  startTime: { type: 'string', nullable: true, description: '起始时间（字幕等）' },
  endTime: { type: 'string', nullable: true, description: '结束时间' },
  cueIndex: { type: 'number', nullable: true, description: '字幕 cue 序号' },
  propertyNamespace: { type: 'string', nullable: true, description: '属性命名空间' },
} as const

const chunkPreviewItemOpenApiProperties = {
  chunkId: { type: 'string', description: '分段主键' },
  chunkIndex: { type: 'number', description: '分段序号（从 0 起）' },
  text: { type: 'string', description: '分段正文（展示用）' },
  headingPath: { type: 'array', items: { type: 'string' }, description: '标题路径' },
  sectionId: { type: 'string', description: '逻辑章节标识' },
  pageNo: { type: 'number', nullable: true, description: '页码' },
  chunkType: { type: 'string', description: '分段类型（paragraph/table/…）' },
  orderInSection: { type: 'number', description: '章节内顺序' },
  charCount: { type: 'number', description: '正文字符数' },
  recallCount: { type: 'number', description: '该分段被检索命中次数（本地上传预览为 0）' },
  ...chunkSemanticMetadataOpenApiProperties,
} as const

const documentChunkListItemOpenApiProperties = {
  chunkId: { type: 'string', description: '分段主键' },
  chunkIndex: { type: 'number', description: '分段序号（从 0 起）' },
  text: { type: 'string', description: '分段正文（展示用）' },
  charCount: { type: 'number', description: '分段正文字符数' },
  recallCount: { type: 'number', description: '该分段被检索命中次数（累计）' },
  embeddingText: { type: 'string', description: '用于向量嵌入的文本' },
  headingPath: { type: 'array', items: { type: 'string' }, description: '标题路径' },
  sectionId: { type: 'string', description: '逻辑章节标识' },
  pageNo: { type: 'number', nullable: true, description: '页码' },
  chunkType: { type: 'string', description: '分段类型' },
  orderInSection: { type: 'number', description: '章节内顺序' },
  captionText: { type: 'string', nullable: true, description: '图片说明' },
  pictureDescription: { type: 'string', nullable: true, description: '图片描述' },
  ...chunkSemanticMetadataOpenApiProperties,
} as const

@Controller('/documents')
export class DocumentController {
  public constructor(
    private readonly documentService: DocumentService,
    private readonly platformSourceImportService: PlatformSourceImportService,
  ) {}

  @POST('/preview')
  @ApiOperation({
    summary: '预览文档分段',
    description: '上传文件但不入库，返回只读分段预览结果。',
    operationId: 'previewDocumentChunks',
  })
  @ApiBody({
    description: 'multipart 表单：file 必填，其余分块参数可选',
    required: true,
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: '要预览的文档文件' },
        separator: { type: 'string', description: '可选：分段标识符，如 \\n\\n' },
        chunkSize: { type: 'number', description: '可选：分段最大长度' },
        chunkOverlap: { type: 'number', description: '可选：分段重叠长度' },
        tableChunkMode: { ...openApiTableChunkModeProperty, description: `可选。${openApiTableChunkModeProperty.description}` },
        textChunkMode: { ...openApiTextChunkModeProperty, description: `可选。${openApiTextChunkModeProperty.description}` },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '分段预览结果',
    schema: {
      type: 'object',
      properties: {
        chunkCount: { type: 'number', description: '分段总数' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: chunkPreviewItemOpenApiProperties,
          },
        },
      },
    },
  })
  public async preview(@ContextParam() context: Context) {
    const body = await context.getBody()
    if (!(body instanceof FormData)) {
      throw new BadRequestException('multipart/form-data is required')
    }
    const formData = body as FormData
    const file = formData.get('file')
    if (!(file instanceof File)) {
      throw new BadRequestException('file field is required')
    }
    return this.documentService.previewDocumentChunks(file, parseChunkingOptions({
      separator: formData.get('separator'),
      chunkSize: formData.get('chunkSize'),
      chunkOverlap: formData.get('chunkOverlap'),
      tableChunkMode: formData.get('tableChunkMode'),
      textChunkMode: formData.get('textChunkMode'),
    }))
  }

  /**
   * 上传文档到指定目录。
   *
   * @description
   * 使用 `multipart/form-data` 上传文件，并要求携带 `directoryId`（知识库目录主键）。
   * @param context 请求上下文，用于读取 `FormData`。
   */
  @POST('/upload')
  @ApiOperation({
    summary: '上传文档',
    description: '将文件上传到指定知识库目录（directoryId 必填）。',
    operationId: 'uploadDocument',
  })
  @ApiBody({
    description: '上传表单数据',
    required: true,
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: '要上传的文档文件' },
        directoryId: { type: 'string', description: '目录主键（必填）' },
        separator: { type: 'string', description: '可选：分段标识符，如 \\n\\n' },
        chunkSize: { type: 'number', description: '可选：分段最大长度' },
        chunkOverlap: { type: 'number', description: '可选：分段重叠长度' },
        tableChunkMode: { ...openApiTableChunkModeProperty, description: `可选。${openApiTableChunkModeProperty.description}` },
        textChunkMode: { ...openApiTextChunkModeProperty, description: `可选。${openApiTextChunkModeProperty.description}` },
      },
      required: ['file', 'directoryId'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '上传结果',
    schema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: '文档主键' },
        importJobId: { type: 'string', description: '导入任务主键' },
        status: {
          type: 'string',
          description: '文档状态（uploaded/parsing/indexed/failed/unsupported）',
        },
        supportedForParsing: { type: 'boolean', description: '是否支持解析（上传文件类型是否已实现）' },
      },
    },
  })
  public async upload(@ContextParam() context: Context) {
    const body = await context.getBody()
    if (!(body instanceof FormData)) {
      throw new BadRequestException('multipart/form-data is required')
    }

    const formData = body as FormData
    const file = formData.get('file')
    if (!(file instanceof File)) {
      throw new BadRequestException('file field is required')
    }

    const directoryId = formData.get('directoryId')
    if (typeof directoryId !== 'string' || directoryId.trim() === '') {
      throw new BadRequestException('directoryId is required')
    }

    return this.documentService.uploadDocument(file, directoryId, parseChunkingOptions({
      separator: formData.get('separator'),
      chunkSize: formData.get('chunkSize'),
      chunkOverlap: formData.get('chunkOverlap'),
      tableChunkMode: formData.get('tableChunkMode'),
      textChunkMode: formData.get('textChunkMode'),
    }))
  }

  /**
   * 列出所有文档（不包含目录维度过滤）。
   */
  @GET('/')
  @ApiOperation({
    summary: '文档列表',
    description: '查询所有文档（未提供目录/关键词/时间范围过滤）。',
    operationId: 'listDocuments',
  })
  @ApiResponse({
    status: 200,
    description: '文档列表',
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
              charCount: { type: 'number', description: '正文总字符数（各分段正文长度之和，索引成功后更新）' },
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
      },
    },
  })
  public async list() {
    return {
      items: await this.documentService.listDocuments(),
    }
  }

  @POST('/:id/preview')
  @ApiOperation({
    summary: '预览已上传文档分段',
    description: '根据 documentId 从数据库读取已入库的分段，返回只读预览结果（与解析/索引时入库的数据一致）。',
    operationId: 'previewDocumentChunksById',
  })
  @ApiResponse({
    status: 200,
    description: '已入库分段预览结果',
    schema: {
      type: 'object',
      properties: {
        chunkCount: { type: 'number', description: '分段总数' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: chunkPreviewItemOpenApiProperties,
          },
        },
      },
    },
  })
  public async previewById(
    @ContextParam() context: Context,
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '文档主键',
      schema: { type: 'string' },
    })
    id: string,
  ) {
    const body = await context.getBody()
    const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
    return this.documentService.previewDocumentChunksById(id, parsePlatformDocumentSyncContext(payload))
  }

  /**
   * 删除文档（逻辑删除 + 向量索引删除 + 文件关联删除）。
   * @param id 文档主键
   */
  @DELETE('/:id')
  @ApiOperation({
    summary: '删除文档',
    description: '根据 documentId 删除文档记录及其索引/文件关联关系。',
    operationId: 'deleteDocument',
  })
  @ApiResponse({
    status: 200,
    description: '删除成功',
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', description: '删除结果' },
      },
    },
  })
  public async remove(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '文档主键',
      schema: { type: 'string' },
    })
    id: string,
  ) {
    await this.documentService.deleteDocument(id)
    return { ok: true }
  }

  @GET('/:id/chunks')
  @ApiOperation({
    summary: '文档分段列表',
    description: '按 documentId 查询当前已保存的分段列表。',
    operationId: 'listDocumentChunks',
  })
  @ApiResponse({
    status: 200,
    description: '分段列表',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: documentChunkListItemOpenApiProperties,
          },
        },
      },
    },
  })
  public async listChunks(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '文档主键',
      schema: { type: 'string' },
    })
    id: string,
  ) {
    return this.documentService.listDocumentChunks(id)
  }

  @PUT('/:documentId/chunks/:chunkId')
  @ApiOperation({
    summary: '更新分段正文',
    description:
      '更新指定 chunk 的正文。可选通过 keywordsAdd / keywordsRemove 对关键词集合做增量调整（追加前去重，移除时按字符串精确匹配已有关键词）。',
    operationId: 'updateDocumentChunk',
  })
  @ApiBody({
    description: '更新分段正文与可选关键词变更',
    required: true,
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '新的 chunk 正文' },
        keywordsAdd: {
          type: 'array',
          items: { type: 'string' },
          description: '要追加的关键词（与已有去重后追加到末尾）',
        },
        keywordsRemove: {
          type: 'array',
          items: { type: 'string' },
          description: '要移除的关键词（与现有关键词 trim 后精确匹配则移除）',
        },
      },
      required: ['text'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '更新后的分段',
    schema: {
      type: 'object',
      properties: documentChunkListItemOpenApiProperties,
    },
  })
  public async updateChunk(
    @Param('documentId')
    @ApiParam({
      name: 'documentId',
      in: 'path',
      required: true,
      description: '文档主键',
      schema: { type: 'string' },
    })
    documentIdRaw: string,
    @Param('chunkId')
    @ApiParam({
      name: 'chunkId',
      in: 'path',
      required: true,
      description: '分段主键',
      schema: { type: 'string' },
    })
    chunkId: string,
    @Body() body: { text?: string; keywordsAdd?: unknown; keywordsRemove?: unknown },
  ) {
    if (!body?.text || typeof body.text !== 'string') {
      throw new BadRequestException('text is required')
    }
    const keywordMutations =
      body.keywordsAdd !== undefined || body.keywordsRemove !== undefined
        ? {
            keywordsAdd: body.keywordsAdd !== undefined ? parseStringArray(body.keywordsAdd, 'keywordsAdd') : [],
            keywordsRemove: body.keywordsRemove !== undefined ? parseStringArray(body.keywordsRemove, 'keywordsRemove') : [],
          }
        : undefined
    return this.documentService.updateDocumentChunk(documentIdRaw, chunkId, body.text, keywordMutations)
  }

  /**
   * 触发文档重索引（重新解析/重分块/重向量化）。
   * @param id 文档主键
   */
  @POST('/:id/reindex')
  @ApiOperation({
    summary: '文档重建索引',
    description: '对指定文档触发重新解析与向量索引。',
    operationId: 'reindexDocument',
  })
  @ApiResponse({
    status: 200,
    description: '重索引结果',
    schema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: '文档主键' },
        importJobId: { type: 'string', description: '导入任务主键' },
        status: { type: 'string', description: '文档状态' },
        supportedForParsing: { type: 'boolean', description: '是否支持解析（上传文件类型是否已实现）' },
      },
    },
  })
  @ApiBody({
    description: '可选重建索引参数',
    required: false,
    schema: {
      type: 'object',
      properties: {
        separator: { type: 'string', description: '可选：分段标识符，如 \\n\\n' },
        chunkSize: { type: 'number', description: '可选：分段最大长度' },
        chunkOverlap: { type: 'number', description: '可选：分段重叠长度' },
        tableChunkMode: { ...openApiTableChunkModeProperty, description: `可选。${openApiTableChunkModeProperty.description}` },
        textChunkMode: { ...openApiTextChunkModeProperty, description: `可选。${openApiTextChunkModeProperty.description}` },
      },
    },
  })
  public async reindex(
    @ContextParam() context: Context,
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '文档主键',
      schema: { type: 'string' },
    })
    id: string,
  ) {
    const body = await context.getBody()
    const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
    const chunkingOptions = parseChunkingOptions({
      separator: payload.separator,
      chunkSize: payload.chunkSize,
      chunkOverlap: payload.chunkOverlap,
      tableChunkMode: payload.tableChunkMode,
      textChunkMode: payload.textChunkMode,
    })
    return this.documentService.reindexDocument(
      id,
      chunkingOptions,
      parsePlatformDocumentSyncContext(payload, chunkingOptions),
    )
  }

  @POST('/import-from-platform')
  @ApiOperation({
    summary: '从平台知识库导入源文档',
    description: '从 cube2 平台知识库（by platformKbId）拉取源文档并摄入到指定目录（directoryId）。',
    operationId: 'importDocumentsFromPlatform',
  })
  @ApiBody({
    description: '平台导入参数',
    required: true,
    schema: {
      type: 'object',
      properties: {
        platformKbId: { type: 'string', description: '平台知识库外部 ID' },
        directoryId: { type: 'string', description: '本地知识库目录主键（目标目录）' },
      },
      required: ['platformKbId', 'directoryId'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '导入结果',
    schema: {
      type: 'object',
      properties: {
        imported: { type: 'number', description: '成功导入数量' },
        errors: { type: 'number', description: '失败数量' },
        errorDetails: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              externalId: { type: 'string' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
  })
  public async importFromPlatform(
    @Body() body: { platformKbId?: string; directoryId?: string },
  ) {
    if (!body?.platformKbId || typeof body.platformKbId !== 'string') {
      throw new BadRequestException('platformKbId is required')
    }
    if (!body?.directoryId || typeof body.directoryId !== 'string') {
      throw new BadRequestException('directoryId is required')
    }
    return this.platformSourceImportService.importFromPlatformKb(body.platformKbId, body.directoryId)
  }
}
