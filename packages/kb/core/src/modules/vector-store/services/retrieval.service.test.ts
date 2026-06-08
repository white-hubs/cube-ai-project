import { describe, expect, test } from 'bun:test'

import { RetrievalService } from './retrieval.service'
import type { EmbeddingProvider, EmbeddingVector } from '../infrastructure/embeddings/embedding-provider'
import type { QdrantSearchResult } from '../infrastructure/qdrant/qdrant-vector.repository'
import { QdrantVectorRepository } from '../infrastructure/qdrant/qdrant-vector.repository'
import { makeMockAppConfig } from '../../../test-helpers/mock-app-config'

class FakeEmbeddingProvider implements EmbeddingProvider {
  public readonly dimension = 3
  public readonly inputs: string[][] = []

  public async embed(input: string[]): Promise<EmbeddingVector[]> {
    this.inputs.push(input)
    return input.map(() => ({
      dense: [0.1, 0.2, 0.3],
      sparse: { indices: [1, 2], values: [0.8, 0.6] },
    }))
  }
}

class EmptyEmbeddingProvider implements EmbeddingProvider {
  public readonly dimension = 3

  public async embed(): Promise<EmbeddingVector[]> {
    return [{ dense: [], sparse: null }]
  }
}

class FakeQdrantVectorRepository {
  public readonly searchCalls: Array<Record<string, unknown>> = []
  public async ensureCollection(): Promise<void> {}

  public async upsert(): Promise<void> {}

  public async search(
    params: {
      topK: number
      denseVector?: number[]
      sparseVector?: { indices: number[]; values: number[] } | null
      documentId?: string
      documentIds?: string[]
      scoreThreshold?: number
    },
  ): Promise<QdrantSearchResult[]> {
    this.searchCalls.push({ ...params })
    const docId = params.documentId === undefined ? undefined : String(params.documentId)
    if (Array.isArray(params.documentIds)) {
      return [
        {
          id: 'chunk-A',
          score: 0.9,
          payload: {
            documentId: '2',
            chunkId: 'chunk-A',
            chunkIndex: 0,
            text: 'Dir2 heading body',
            embeddingText: 'Dir2 title\nDir2 heading body',
            fileName: 'a.md',
            sourceType: 'md',
            sectionId: 'section-b',
            headingPath: ['Dir2 title'],
            pageNo: 2,
            chunkType: 'paragraph',
            orderInSection: 0,
            captionText: null,
            pictureDescription: null,
          },
        },
        {
          id: 'chunk-C',
          score: 0.5,
          payload: {
            documentId: '2',
            chunkId: 'chunk-C',
            chunkIndex: 2,
            text: 'Dir2 later body',
            embeddingText: 'Dir2 title\nDir2 later body',
            fileName: 'c.md',
            sourceType: 'md',
            sectionId: 'section-c',
            headingPath: ['Dir2 appendix'],
            pageNo: 3,
            chunkType: 'paragraph',
            orderInSection: 2,
            captionText: null,
            pictureDescription: null,
          },
        },
        {
          id: 'chunk-B',
          score: 0.29,
          payload: {
            documentId: '1',
            chunkId: 'chunk-B',
            chunkIndex: 1,
            text: 'Dir1 supporting body',
            embeddingText: 'Dir1 title\nDir1 supporting body',
            fileName: 'b.md',
            sourceType: 'md',
            sectionId: 'section-a',
            headingPath: ['Dir1 title'],
            pageNo: 1,
            chunkType: 'paragraph',
            orderInSection: 1,
            captionText: null,
            pictureDescription: null,
          },
        },
      ]
    }
    if (docId === '1') {
      return [
        {
          id: 'chunk-A',
          score: 0.4,
          payload: {
            documentId: '1',
            chunkId: 'chunk-A',
            chunkIndex: 0,
            text: 'Dir1 heading body',
            embeddingText: 'Dir1 title\nDir1 heading body',
            fileName: 'a.md',
            sourceType: 'md',
            sectionId: 'section-a',
            headingPath: ['Dir1 title'],
            pageNo: 1,
            chunkType: 'paragraph',
            orderInSection: 0,
            captionText: null,
            pictureDescription: null,
          },
        },
        {
          id: 'chunk-B',
          score: 0.3,
          payload: {
            documentId: '1',
            chunkId: 'chunk-B',
            chunkIndex: 1,
            text: 'Dir1 supporting body',
            embeddingText: 'Dir1 title\nDir1 supporting body',
            fileName: 'b.md',
            sourceType: 'md',
            sectionId: 'section-a',
            headingPath: ['Dir1 title'],
            pageNo: 1,
            chunkType: 'paragraph',
            orderInSection: 1,
            captionText: null,
            pictureDescription: null,
          },
        },
      ].slice(0, params.topK)
    }

    if (docId === '2') {
      return [
        {
          id: 'chunk-A',
          score: 0.9,
          payload: {
            documentId: '2',
            chunkId: 'chunk-A',
            chunkIndex: 0,
            text: 'Dir2 heading body',
            embeddingText: 'Dir2 title\nDir2 heading body',
            fileName: 'a.md',
            sourceType: 'md',
            sectionId: 'section-b',
            headingPath: ['Dir2 title'],
            pageNo: 2,
            chunkType: 'paragraph',
            orderInSection: 0,
            captionText: null,
            pictureDescription: null,
          },
        },
        {
          id: 'chunk-C',
          score: 0.5,
          payload: {
            documentId: '2',
            chunkId: 'chunk-C',
            chunkIndex: 2,
            text: 'Dir2 later body',
            embeddingText: 'Dir2 title\nDir2 later body',
            fileName: 'c.md',
            sourceType: 'md',
            sectionId: 'section-c',
            headingPath: ['Dir2 appendix'],
            pageNo: 3,
            chunkType: 'paragraph',
            orderInSection: 2,
            captionText: null,
            pictureDescription: null,
          },
        },
      ].slice(0, params.topK)
    }

    // default for documentId search test
    return [
      {
        id: 'chunk-1',
        score: 0.98,
        payload: {
          documentId: '12',
          chunkId: 'chunk-1',
          chunkIndex: 0,
          text: 'first result',
          embeddingText: 'Section one\nfirst result',
          fileName: 'note.md',
          sourceType: 'md',
          sectionId: 'section-1',
          headingPath: ['Section one'],
          pageNo: 1,
          chunkType: 'paragraph',
          orderInSection: 0,
            captionText: null,
            pictureDescription: null,
        },
      },
      {
        id: 'chunk-2',
        score: 0.71,
        payload: {
          documentId: '12',
          chunkId: 'chunk-2',
          chunkIndex: 1,
          text: 'second result',
          embeddingText: 'Section one\nsecond result',
          fileName: 'note.md',
          sourceType: 'md',
          sectionId: 'section-1',
          headingPath: ['Section one'],
          pageNo: 1,
          chunkType: 'paragraph',
          orderInSection: 1,
            captionText: null,
            pictureDescription: null,
        },
      },
    ].slice(0, params.topK)
  }

  public async deleteByDocument(): Promise<void> {}
}

class FakeDocumentRepository {
  public async findIdsByDirectoryId(): Promise<string[]> {
    return ['1', '2']
  }
}

class FakeDocumentChunkRepository {
  public readonly lexicalCalls: Array<Record<string, unknown>> = []

  public async findByDocumentIdAndSectionId(documentId: string, sectionId: string) {
    if (documentId === '12' && sectionId === 'section-1') {
      return [
        {
          chunk_id: 'chunk-1',
          chunk_index: 0,
          text_content: 'first result',
          heading_path: '["Section one"]',
          section_id: 'section-1',
          chunk_type: 'paragraph',
          page_no: 1,
          order_in_section: 0,
        },
        {
          chunk_id: 'chunk-2',
          chunk_index: 1,
          text_content: 'second result',
          heading_path: '["Section one"]',
          section_id: 'section-1',
          chunk_type: 'paragraph',
          page_no: 1,
          order_in_section: 1,
        },
        {
          chunk_id: 'chunk-3',
          chunk_index: 2,
          text_content: 'third result',
          heading_path: '["Section one"]',
          section_id: 'section-1',
          chunk_type: 'paragraph',
          page_no: 1,
          order_in_section: 2,
        },
        {
          chunk_id: 'chunk-4',
          chunk_index: 3,
          text_content: 'fourth result',
          heading_path: '["Section one"]',
          section_id: 'section-1',
          chunk_type: 'paragraph',
          page_no: 1,
          order_in_section: 3,
        },
      ]
    }
    if (documentId === '2' && sectionId === 'section-b') {
      return [
        {
          chunk_id: 'chunk-A',
          chunk_index: 0,
          text_content: 'Dir2 heading body',
          heading_path: '["Dir2 title"]',
          section_id: 'section-b',
          chunk_type: 'paragraph',
          page_no: 2,
          order_in_section: 0,
        },
      ]
    }
    if (documentId === '2' && sectionId === 'section-c') {
      return [
        {
          chunk_id: 'chunk-C',
          chunk_index: 2,
          text_content: 'Dir2 later body',
          heading_path: '["Dir2 appendix"]',
          section_id: 'section-c',
          chunk_type: 'paragraph',
          page_no: 3,
          order_in_section: 2,
        },
      ]
    }
    if (documentId === '1' && sectionId === 'section-a') {
      return [
        {
          chunk_id: 'chunk-A',
          chunk_index: 0,
          text_content: 'Dir1 heading body',
          heading_path: '["Dir1 title"]',
          section_id: 'section-a',
          chunk_type: 'paragraph',
          page_no: 1,
          order_in_section: 0,
        },
        {
          chunk_id: 'chunk-B',
          chunk_index: 1,
          text_content: 'Dir1 supporting body',
          heading_path: '["Dir1 title"]',
          section_id: 'section-a',
          chunk_type: 'paragraph',
          page_no: 1,
          order_in_section: 1,
        },
      ]
    }
    if (documentId === '77' && sectionId === 'sheet:sheeta') {
      return [
        {
          chunk_id: 'table-prev',
          chunk_index: 0,
          text_content: '工作表: SheetA\n行范围: 1-1\n\n第1行: 设备编码=prev-1; 设备名称=前一条设备',
          heading_path: '["SheetA"]',
          section_id: 'sheet:sheeta',
          chunk_type: 'table-row-window',
          page_no: null,
          order_in_section: 0,
        },
        {
          chunk_id: 'table-hit',
          chunk_index: 1,
          text_content: '工作表: SheetA\n行范围: 2-2\n\n第2行: 设备编码=5d10--35; 设备名称=研发中心6号265VBRS',
          heading_path: '["SheetA"]',
          section_id: 'sheet:sheeta',
          chunk_type: 'table-row-window',
          page_no: null,
          order_in_section: 1,
        },
        {
          chunk_id: 'table-next',
          chunk_index: 2,
          text_content: '工作表: SheetA\n行范围: 3-3\n\n第3行: 设备编码=next-1; 设备名称=后一条设备',
          heading_path: '["SheetA"]',
          section_id: 'sheet:sheeta',
          chunk_type: 'table-row-window',
          page_no: null,
          order_in_section: 2,
        },
      ]
    }
    return []
  }

  public async searchLexicalChunks(params: {
    query: string
    terms: string[]
    topK: number
    documentId?: string
    documentIds?: string[]
  }) {
    this.lexicalCalls.push(params)
    if (params.documentId === '77') {
      return [
        {
          document_id: '77',
          file_name: 'demo.xlsx',
          source_type: 'xlsx',
          chunk_id: 'table-hit',
          chunk_index: 0,
          text_content: '工作表: SheetA\n行范围: 1-1',
          embedding_text: '文件: demo.xlsx\n工作表: SheetA\n表头: 设备编码, 设备名称\n第1行: 设备编码=5d10--35; 设备名称=研发中心6号265VBRS',
          section_id: 'sheet:sheeta',
          heading_path: '["SheetA"]',
          page_no: null,
          chunk_type: 'table-row-window',
          order_in_section: 0,
          caption_text: null,
          picture_description: null,
          sheet_name: 'SheetA',
          table_id: 'xlsx-table-0',
          row_start: 1,
          row_end: 1,
          headers_text: '["设备编码","设备名称"]',
          keywords_text: '["5d10--35","研发中心6号265VBRS"]',
          start_time: null,
          end_time: null,
          cue_index: null,
          property_namespace: null,
          lexical_score: 5,
        },
      ]
    }
    return []
  }
}

describe('RetrievalService', () => {
  test('embeds query and returns section-aggregated search results', async () => {
    const embeddingProvider = new FakeEmbeddingProvider()
    const qdrantVectorRepository = new FakeQdrantVectorRepository()
    const service = new RetrievalService(
      makeMockAppConfig(),
      embeddingProvider,
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    )

    const result = await service.search({
      query: 'hello world',
      topK: 1,
      documentId: '12',
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual(expect.objectContaining({
      chunkId: 'chunk-1',
      documentId: '12',
      chunkIndex: 0,
      text: 'first result\n\nsecond result',
      fileName: 'note.md',
      sourceType: 'md',
      score: 1,
      rankScore: 1,
      vectorScore: 0.98,
      sectionId: 'section-1',
      headingPath: ['Section one'],
      pageNo: 1,
      chunkType: 'paragraph',
      sheetName: null,
      tableId: null,
      rowStart: null,
      rowEnd: null,
      startTime: null,
      endTime: null,
      cueIndex: null,
      propertyNamespace: null,
    }))
    expect(embeddingProvider.inputs).toEqual([['hello world']])
    expect(qdrantVectorRepository.searchCalls[0]?.topK).toBe(20)
  })

  test('limits aggregated text to a local section window around the hit chunk', async () => {
    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      new FakeQdrantVectorRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    )

    const result = await service.search({
      query: 'section one',
      topK: 2,
      documentId: '12',
    })

    expect(result.items[1]?.chunkId).toBe('chunk-2')
    expect(result.items[1]?.text).toBe('first result\n\nsecond result\n\nthird result')
  })

  test('searchMultiByDocuments keeps hits when qdrant payload documentId is numeric', async () => {
    class NumericPayloadRepository extends FakeQdrantVectorRepository {
      public override async search(
        params: { topK: number; documentId?: string },
      ): Promise<QdrantSearchResult[]> {
        const results = await super.search(params)
        return results.map((result) => ({
          ...result,
          payload: {
            ...result.payload,
            documentId: Number(result.payload.documentId) as unknown as string,
          },
        }))
      }
    }

    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      new NumericPayloadRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    )

    const result = await service.searchMultiByDocuments({
      query: 'hello world',
      documents: [{ documentId: '2', topK: 1 }],
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.documentId).toBe('2')
    expect(result.items[0]?.chunkId).toBe('chunk-A')
  })

  test('searchByDirectory and searchMultiByDocuments share per-document scores', async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository()
    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    )

    const byDocuments = await service.searchMultiByDocuments({
      query: 'hello world',
      documents: [{ documentId: '2', topK: 5 }],
    })
    const byDirectory = await service.searchByDirectory({
      query: 'hello world',
      topK: 5,
      directoryId: '999',
    })

    const fromDocuments = byDocuments.items.find((item) => item.documentId === '2' && item.chunkId === 'chunk-A')
    const fromDirectory = byDirectory.items.find((item) => item.documentId === '2' && item.chunkId === 'chunk-A')
    expect(fromDocuments).toBeDefined()
    expect(fromDirectory).toBeDefined()
    expect(fromDocuments?.score).toBe(fromDirectory?.score)
    expect(fromDocuments?.rankScore).toBe(fromDirectory?.rankScore)
    expect(fromDocuments?.vectorScore).toBe(fromDirectory?.vectorScore)
    expect(fromDocuments?.score).toBe(1)
  })

  test('searchByDirectory merges per-document results and keeps best-ranked chunks', async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository()
    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    )

    const result = await service.searchByDirectory({
      query: 'hello world',
      topK: 2,
      directoryId: '999',
    })

    expect(result.items).toHaveLength(2)
    expect(qdrantVectorRepository.searchCalls).toHaveLength(2)
    expect(qdrantVectorRepository.searchCalls.map((call) => call.documentId)).toEqual(['1', '2'])
    expect(result.items[0]?.chunkId).toBe('chunk-A')
    expect(result.items[0]?.vectorScore).toBe(0.9)
    expect(result.items[0]?.score).toBe(1)
    expect(result.items[0]?.text).toBe('Dir2 heading body')
    expect(result.items[1]?.chunkId).toBe('chunk-A')
    expect(result.items[1]?.documentId).toBe('1')
    expect(result.items[1]?.vectorScore).toBe(0.4)
  })

  test('uses prefetch and score threshold before trimming topK', async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository()
    const service = new RetrievalService(
      makeMockAppConfig({ retrievalScoreThreshold: 0.5, retrievalPrefetchTopK: 6 }),
      new FakeEmbeddingProvider(),
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    )

    const result = await service.search({
      query: 'hello world',
      topK: 1,
      documentId: '12',
    })

    expect(qdrantVectorRepository.searchCalls[0]?.topK).toBe(6)
    expect(qdrantVectorRepository.searchCalls[0]?.scoreThreshold).toBe(0.5)
    expect(result.items).toHaveLength(1)
  })

  test('searchByDirectory searches each document independently before global topK', async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository()
    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    )

    const result = await service.searchByDirectory({
      query: 'hello world',
      topK: 2,
      directoryId: '999',
    })

    expect(qdrantVectorRepository.searchCalls).toHaveLength(2)
    expect(qdrantVectorRepository.searchCalls.every((call) => call.documentId !== undefined)).toBe(true)
    expect(result.items.map((item) => `${item.documentId}:${item.chunkId}`)).toEqual(['2:chunk-A', '1:chunk-A'])
    expect(result.items[0]?.score).toBe(1)
    expect(result.items[1]?.score).toBe(1)
  })

  test('reranks short query hits using heading and keyword matches', async () => {
    process.env.RETRIEVAL_RERANK_ENABLED = 'true'
    process.env.RETRIEVAL_SCORE_THRESHOLD = '0'

    class RerankRepository extends FakeQdrantVectorRepository {
      public override async search(): Promise<QdrantSearchResult[]> {
        return [
          {
            id: 'generic',
            score: 0.41,
            payload: {
              documentId: '33',
              chunkId: 'generic',
              chunkIndex: 7,
              text: '适用于园区、医院、社区、学校、交通等行业。',
              embeddingText: '整体设计\n适用于园区、医院、社区、学校、交通等行业。',
              fileName: 'demo.docx',
              sourceType: 'docx',
              sectionId: 'heading:整体设计-适用行业',
              headingPath: ['整体设计', '适用行业'],
              pageNo: null,
              chunkType: 'paragraph',
              orderInSection: 0,
              captionText: null,
              pictureDescription: null,
            },
          },
          {
            id: 'pain-points',
            score: 0.31,
            payload: {
              documentId: '33',
              chunkId: 'pain-points',
              chunkIndex: 4,
              text: '当前安防监控行业存在以下痛点问题：误报泛滥，人工复核成本高。',
              embeddingText: '行业背景\n行业痛点\n当前安防监控行业存在以下痛点问题：误报泛滥，人工复核成本高。',
              fileName: 'demo.docx',
              sourceType: 'docx',
              sectionId: 'heading:行业背景-行业痛点',
              headingPath: ['行业背景', '行业痛点'],
              pageNo: null,
              chunkType: 'paragraph',
              orderInSection: 0,
              captionText: null,
              pictureDescription: null,
            },
          },
        ]
      }
    }

    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      new RerankRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    )

    const result = await service.search({
      query: '痛点问题',
      topK: 2,
      documentId: '33',
    })

    expect(result.items[0]?.chunkId).toBe('pain-points')
    expect((result.items[0]?.rankScore ?? 0)).toBeGreaterThan(result.items[0]?.vectorScore ?? 0)
    expect(result.items[0]?.vectorScore).toBe(0.31)
  })

  test('returns empty result without querying qdrant when query embedding is empty', async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository()
    const service = new RetrievalService(
      makeMockAppConfig(),
      new EmptyEmbeddingProvider(),
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    )

    const result = await service.search({
      query: 'empty vector',
      topK: 3,
    })

    expect(result.items).toEqual([])
    expect(qdrantVectorRepository.searchCalls).toHaveLength(0)
  })

  test('supplements vector recall with lexical table hits', async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository()
    const documentChunkRepository = new FakeDocumentChunkRepository()
    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      documentChunkRepository as unknown as never,
    )

    const result = await service.search({
      query: '5d10--35',
      topK: 1,
      documentId: '77',
    })

    expect(documentChunkRepository.lexicalCalls).toHaveLength(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual(expect.objectContaining({
      chunkId: 'table-hit',
      chunkType: 'table-row-window',
      sheetName: 'SheetA',
      tableId: 'xlsx-table-0',
      rowStart: 1,
      rowEnd: 1,
      headers: ['设备编码', '设备名称'],
      keywords: ['5d10--35', '研发中心6号265VBRS'],
    }))
    expect(result.items[0]?.text).toBe('工作表: SheetA\n行范围: 1-1')
  })

  test('does not aggregate neighboring structured table-row-window chunks into search item text', async () => {
    const qdrantVectorRepository = new FakeQdrantVectorRepository()
    const documentChunkRepository = new FakeDocumentChunkRepository()
    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      qdrantVectorRepository as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      documentChunkRepository as unknown as never,
    )

    const result = await service.search({
      query: '研发中心6号265VBRS',
      topK: 1,
      documentId: '77',
    })

    expect(result.items[0]?.chunkId).toBe('table-hit')
    expect(result.items[0]?.text).toBe('工作表: SheetA\n行范围: 1-1')
    expect(result.items[0]?.text).not.toContain('前一条设备')
    expect(result.items[0]?.text).not.toContain('后一条设备')
  })

  test('type-aware rerank boosts table header and keyword matches above generic dense hits', async () => {
    process.env.RETRIEVAL_RERANK_ENABLED = 'true'

    class TableAwareRepository extends FakeQdrantVectorRepository {
      public override async search(): Promise<QdrantSearchResult[]> {
        return [
          {
            id: 'generic',
            score: 0.72,
            payload: {
              documentId: '88',
              chunkId: 'generic',
              chunkIndex: 0,
              text: '设备整体运行分析说明',
              embeddingText: '说明\n设备整体运行分析说明',
              fileName: 'demo.docx',
              sourceType: 'docx',
              sectionId: 'heading:说明',
              headingPath: ['说明'],
              pageNo: null,
              chunkType: 'paragraph',
              orderInSection: 0,
              captionText: null,
              pictureDescription: null,
            },
          },
          {
            id: 'table-hit',
            score: 0.44,
            payload: {
              documentId: '88',
              chunkId: 'table-hit',
              chunkIndex: 1,
              text: '工作表: SheetA\n行范围: 1-1',
              embeddingText: '文件: demo.xlsx\n工作表: SheetA\n表头: 设备编码, 设备名称\n第1行: 设备编码=5d10--35; 设备名称=研发中心6号265VBRS',
              fileName: 'demo.xlsx',
              sourceType: 'xlsx',
              sectionId: 'sheet:sheeta',
              headingPath: ['SheetA'],
              pageNo: null,
              chunkType: 'table-row-window',
              orderInSection: 0,
              captionText: null,
              pictureDescription: null,
              sheetName: 'SheetA',
              tableId: 'xlsx-table-0',
              rowStart: 1,
              rowEnd: 1,
              headers: ['设备编码', '设备名称'],
              keywords: ['5d10--35', '研发中心6号265VBRS'],
            },
          },
        ]
      }
    }

    const service = new RetrievalService(
      makeMockAppConfig(),
      new FakeEmbeddingProvider(),
      new TableAwareRepository() as unknown as QdrantVectorRepository,
      new FakeDocumentRepository() as unknown as never,
      new FakeDocumentChunkRepository() as unknown as never,
    )

    const result = await service.search({
      query: '设备编码 5d10--35',
      topK: 2,
      documentId: '88',
    })

    expect(result.items[0]?.chunkId).toBe('table-hit')
    expect((result.items[0]?.rankScore ?? 0)).toBeGreaterThan(result.items[0]?.vectorScore ?? 0)
  })
})
