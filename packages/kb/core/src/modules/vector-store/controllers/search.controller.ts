import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  BadRequestException,
  Body,
  Controller,
  POST,
} from '@dangao/bun-server'
import { MockableEndpoint } from '@/infrastructure/mock-endpoint'
import { parsePlatformDocumentSyncContext } from '../../../port/document-platform-sync.port'
import { RetrievalService } from '../services/retrieval.service'

function parseSimilarityThreshold(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new BadRequestException('similarityThreshold must be a finite number in [0, 1]')
  }
  if (raw < 0 || raw > 1) {
    throw new BadRequestException('similarityThreshold must be within [0, 1]')
  }
  return raw
}

@Controller('/search')
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
    summary: '向量检索',
    description:
      '根据 query 进行向量相似度检索；可选 documentId 将范围限制到单个文档。可选 similarityThreshold：仅保留最终得分 score 大于阈值的分段（典型 UI 为 0~1 滑块）。',
    operationId: 'search',
  })
  @ApiBody({
    description: '检索参数',
    required: true,
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索问题/关键词（必填）' },
        topK: { type: 'number', description: '返回候选数量（默认 5）' },
        documentId: { type: 'string', description: '可选：限制在指定文档内检索' },
        similarityThreshold: {
          type: 'number',
          description:
            '可选，[0,1]。滑块型参数：与响应中 score（最终相关性，0~1）比较，仅返回 score > similarityThreshold 的分段；为 0 或未传时不做该层过滤。',
          minimum: 0,
          maximum: 1,
        },
      },
      required: ['query'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '检索结果',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              chunkId: { type: 'string', description: 'chunk 主键' },
              documentId: { type: 'string', description: '所属文档主键' },
              chunkIndex: { type: 'number', description: 'chunk 索引（序号）' },
              text: { type: 'string', description: 'chunk 文本内容' },
              fileName: { type: 'string', description: '源文件名' },
              sourceType: { type: 'string', description: '数据来源类型' },
              score: { type: 'number', description: '最终排序得分（可能包含规则重排加权）' },
              vectorScore: { type: 'number', description: '原始向量召回得分' },
              rankScore: { type: 'number', description: '规则重排后的最终得分' },
              sectionId: { type: 'string', description: '逻辑章节标识' },
              headingPath: { type: 'array', items: { type: 'string' }, description: '命中标题路径' },
              pageNo: { type: 'number', nullable: true, description: '页码' },
              chunkType: { type: 'string', description: 'chunk 类型' },
              sheetName: { type: 'string', nullable: true, description: '工作表名' },
              tableId: { type: 'string', nullable: true, description: '表格 id' },
              rowStart: { type: 'number', nullable: true, description: '起始行' },
              rowEnd: { type: 'number', nullable: true, description: '结束行' },
              headers: { type: 'array', items: { type: 'string' }, description: '表头' },
              keywords: { type: 'array', items: { type: 'string' }, description: '关键词' },
              startTime: { type: 'string', nullable: true, description: '起始时间' },
              endTime: { type: 'string', nullable: true, description: '结束时间' },
              cueIndex: { type: 'number', nullable: true, description: '字幕 cue' },
              propertyNamespace: { type: 'string', nullable: true, description: '属性命名空间' },
              retrievalProfile: { type: 'string', description: '检索画像' },
            },
          },
        },
      },
    },
  })
  @POST('/')
  public async search(@Body() body: { query?: string; topK?: number; documentId?: string; similarityThreshold?: number }) {
    if (!body?.query || typeof body.query !== 'string') {
      throw new BadRequestException('query is required')
    }
    if (body.topK !== undefined && (!Number.isFinite(body.topK) || body.topK <= 0)) {
      throw new BadRequestException('topK must be a positive number')
    }
    if (body.documentId !== undefined) {
      const id = String(body.documentId).trim()
      if (!id || id === '0') {
        throw new BadRequestException('documentId must be a non-empty non-zero id when provided')
      }
    }
    const similarityThreshold = parseSimilarityThreshold(body.similarityThreshold)

    const documentId = body.documentId !== undefined ? String(body.documentId).trim() : undefined

    return this.retrievalService.search({
      query: body.query,
      topK: typeof body.topK === 'number' ? body.topK : 5,
      documentId,
      similarityThreshold,
    })
  }

  /**
   * 向量检索（多文档）：同一 query 只嵌入一次；每个文档独立 topK 与 similarityThreshold（score 语义同 `/search`）。
   *
   * @param body.query 检索问题/关键词（必填）
   * @param body.documents 文档列表（必填，每项含 documentId；topK 默认 5；similarityThreshold 可选）
   */
  @ApiOperation({
    summary: '多文档向量检索',
    description:
      '对多个 documentId 分别检索：共享同一 query 向量；每个文档可指定独立的 topK 与 similarityThreshold（仅保留 score > 阈值的分段）。返回 items 按请求中 documents 顺序拼接。',
    operationId: 'searchByDocuments',
  })
  @ApiBody({
    description: '检索参数',
    required: true,
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索问题/关键词（必填）' },
        documents: {
          type: 'array',
          description: '文档检索规格列表（顺序保留至响应 items 拼接顺序）',
          items: {
            type: 'object',
            properties: {
              documentId: { type: 'string', description: '文档主键' },
              topK: { type: 'number', description: '该文档返回条数上限（默认 5）' },
              similarityThreshold: {
                type: 'number',
                description:
                  '可选，[0,1]。仅该文档：保留 score > similarityThreshold；为 0 或未传则不做该层过滤。',
                minimum: 0,
                maximum: 1,
              },
            },
            required: ['documentId'],
          },
        },
      },
      required: ['query', 'documents'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '检索结果',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              chunkId: { type: 'string', description: 'chunk 主键' },
              documentId: { type: 'string', description: '所属文档主键' },
              chunkIndex: { type: 'number', description: 'chunk 索引（序号）' },
              text: { type: 'string', description: 'chunk 文本内容' },
              fileName: { type: 'string', description: '源文件名' },
              sourceType: { type: 'string', description: '数据来源类型' },
              score: { type: 'number', description: '最终排序得分（可能包含规则重排加权）' },
              vectorScore: { type: 'number', description: '原始向量召回得分' },
              rankScore: { type: 'number', description: '规则重排后的最终得分' },
              sectionId: { type: 'string', description: '逻辑章节标识' },
              headingPath: { type: 'array', items: { type: 'string' }, description: '命中标题路径' },
              pageNo: { type: 'number', nullable: true, description: '页码' },
              chunkType: { type: 'string', description: 'chunk 类型' },
              sheetName: { type: 'string', nullable: true, description: '工作表名' },
              tableId: { type: 'string', nullable: true, description: '表格 id' },
              rowStart: { type: 'number', nullable: true, description: '起始行' },
              rowEnd: { type: 'number', nullable: true, description: '结束行' },
              headers: { type: 'array', items: { type: 'string' }, description: '表头' },
              keywords: { type: 'array', items: { type: 'string' }, description: '关键词' },
              startTime: { type: 'string', nullable: true, description: '起始时间' },
              endTime: { type: 'string', nullable: true, description: '结束时间' },
              cueIndex: { type: 'number', nullable: true, description: '字幕 cue' },
              propertyNamespace: { type: 'string', nullable: true, description: '属性命名空间' },
              retrievalProfile: { type: 'string', description: '检索画像' },
            },
          },
        },
      },
    },
  })
  @POST('/by-documents')
  public async searchByDocuments(
    @Body()
    body: {
      query?: string
      documents?: Array<{ documentId?: string; topK?: number; similarityThreshold?: number }>
      platformKbId?: string
      directoryId?: string
    },
  ) {
    if (!body?.query || typeof body.query !== 'string') {
      throw new BadRequestException('query is required')
    }
    if (!Array.isArray(body.documents) || body.documents.length === 0) {
      throw new BadRequestException('documents must be a non-empty array')
    }

    const seen = new Set<string>()
    const documents: Array<{ documentId: string; topK?: number; similarityThreshold?: number }> = []
    for (const entry of body.documents) {
      if (!entry || typeof entry !== 'object') {
        throw new BadRequestException('each documents entry must be an object')
      }
      const documentId = typeof entry.documentId === 'string' ? entry.documentId.trim() : ''
      if (!documentId || documentId === '0') {
        throw new BadRequestException('each documentId must be a non-empty non-zero id')
      }
      if (seen.has(documentId)) {
        throw new BadRequestException(`duplicate documentId in documents: ${documentId}`)
      }
      seen.add(documentId)

      if (entry.topK !== undefined && (!Number.isFinite(entry.topK) || entry.topK <= 0)) {
        throw new BadRequestException('each topK must be a positive number when provided')
      }
      const similarityThreshold = parseSimilarityThreshold(entry.similarityThreshold)
      documents.push({
        documentId,
        ...(typeof entry.topK === 'number' ? { topK: entry.topK } : {}),
        ...(similarityThreshold !== undefined ? { similarityThreshold } : {}),
      })
    }

    return this.retrievalService.searchMultiByDocuments({
      query: body.query,
      documents,
      platformSync: parsePlatformDocumentSyncContext(body),
    })
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
    summary: '目录检索',
    description:
      '先根据 directoryId 查询目录下的文档集合，再进行向量检索并合并候选。可选 similarityThreshold：仅保留 score 大于阈值的分段。',
    operationId: 'searchByDirectory',
  })
  @ApiBody({
    description: '检索参数',
    required: true,
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索问题/关键词（必填）' },
        topK: { type: 'number', description: '返回候选数量（默认 5）' },
        directoryId: { type: 'string', description: '目录主键（必填）' },
        similarityThreshold: {
          type: 'number',
          description:
            '可选，[0,1]。滑块型参数：与响应中 score 比较，仅返回 score > similarityThreshold 的分段；为 0 或未传时不做该层过滤。',
          minimum: 0,
          maximum: 1,
        },
      },
      required: ['query', 'directoryId'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '检索结果',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              chunkId: { type: 'string', description: 'chunk 主键' },
              documentId: { type: 'string', description: '所属文档主键' },
              chunkIndex: { type: 'number', description: 'chunk 索引（序号）' },
              text: { type: 'string', description: 'chunk 文本内容' },
              fileName: { type: 'string', description: '源文件名' },
              sourceType: { type: 'string', description: '数据来源类型' },
              score: { type: 'number', description: '最终排序得分（可能包含规则重排加权）' },
              vectorScore: { type: 'number', description: '原始向量召回得分' },
              rankScore: { type: 'number', description: '规则重排后的最终得分' },
              sectionId: { type: 'string', description: '逻辑章节标识' },
              headingPath: { type: 'array', items: { type: 'string' }, description: '命中标题路径' },
              pageNo: { type: 'number', nullable: true, description: '页码' },
              chunkType: { type: 'string', description: 'chunk 类型' },
              sheetName: { type: 'string', nullable: true, description: '工作表名' },
              tableId: { type: 'string', nullable: true, description: '表格 id' },
              rowStart: { type: 'number', nullable: true, description: '起始行' },
              rowEnd: { type: 'number', nullable: true, description: '结束行' },
              headers: { type: 'array', items: { type: 'string' }, description: '表头' },
              keywords: { type: 'array', items: { type: 'string' }, description: '关键词' },
              startTime: { type: 'string', nullable: true, description: '起始时间' },
              endTime: { type: 'string', nullable: true, description: '结束时间' },
              cueIndex: { type: 'number', nullable: true, description: '字幕 cue' },
              propertyNamespace: { type: 'string', nullable: true, description: '属性命名空间' },
              retrievalProfile: { type: 'string', description: '检索画像' },
            },
          },
        },
      },
    },
  })
  @POST('/by-directory')
  public async searchByDirectory(@Body() body: { query?: string; topK?: number; directoryId?: string; similarityThreshold?: number }) {
    if (!body?.query || typeof body.query !== 'string') {
      throw new BadRequestException('query is required')
    }
    if (body.topK !== undefined && (!Number.isFinite(body.topK) || body.topK <= 0)) {
      throw new BadRequestException('topK must be a positive number')
    }
    const similarityThreshold = parseSimilarityThreshold(body.similarityThreshold)
    return this.retrievalService.searchByDirectory({
      query: body.query,
      topK: typeof body.topK === 'number' ? body.topK : 5,
      directoryId: body.directoryId ?? '0',
      similarityThreshold,
    })
  }
}
