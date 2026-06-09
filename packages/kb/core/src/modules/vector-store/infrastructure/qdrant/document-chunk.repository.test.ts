import { describe, expect, test } from 'bun:test'
import type { Logger } from '@dangao/bun-server'
import { DocumentChunkRepositoryOrm } from './document-chunk.repository'
import type { TextChunkRecord } from '../../../common/document-types'

class FakeDatabaseService {
  public readonly calls: Array<{ sql: string; params?: unknown[] }> = []
  public nextResult: unknown[] = []

  public query<T = unknown>(sql: string, params?: unknown[]): T[] {
    this.calls.push({ sql, params })

    for (const value of params ?? []) {
      if (value === null) {
        continue
      }
      if (value instanceof Date) {
        continue
      }
      if (Array.isArray(value)) {
        throw new Error(`array parameter is not SQL-safe: ${JSON.stringify(value)}`)
      }
      if (typeof value === 'bigint') {
        throw new Error(`bigint parameter is not SQL-safe: ${String(value)}`)
      }
      if (typeof value === 'undefined') {
        throw new Error('undefined parameter is not SQL-safe')
      }
      if (typeof value === 'object') {
        throw new Error(`object parameter is not SQL-safe: ${JSON.stringify(value)}`)
      }
    }

    return this.nextResult as T[]
  }
}

const fakeLogger: Logger = {
  log() {},
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
} as unknown as Logger

describe('DocumentChunkRepositoryOrm', () => {
  test('normalizes insert params to SQL-safe scalar values', async () => {
    const databaseService = new FakeDatabaseService()
    const repository = new DocumentChunkRepositoryOrm(databaseService as never, fakeLogger)

    const chunks: TextChunkRecord[] = [
      {
        chunkId: '12-0',
        documentId: "12",
        chunkIndex: 0,
        text: 'display text',
        embeddingText: 'embedding text',
        tenantId: null,
        sourceType: 'pdf',
        fileName: 'demo.pdf',
        sectionId: 'section-1',
        headingPath: ['Title'],
        pageNo: 1,
        chunkType: 'paragraph',
        orderInSection: 0,
        captionText: null,
        pictureDescription: { detail: 'object should be normalized' } as never,
        sheetName: 'SheetA',
        tableId: 'table-0',
        rowStart: 1,
        rowEnd: 1,
        headers: ['Title'],
        keywords: ['Title', 'display'],
        startTime: null,
        endTime: null,
        cueIndex: null,
        propertyNamespace: null,
      },
    ]

    await repository.replaceDocumentChunks("12", chunks)

    const insertCall = databaseService.calls.find((call) => call.sql.startsWith('INSERT INTO document_chunk'))
    expect(insertCall).toBeDefined()
    expect(insertCall?.params).toBeArray()
    expect(insertCall?.sql).toContain('sheet_name')
    expect(insertCall?.params?.some((value) => typeof value === 'bigint')).toBe(false)
    expect(insertCall?.params?.some((value) => typeof value === 'undefined')).toBe(false)
    expect(insertCall?.params?.some((value) => typeof value === 'object' && value !== null && !(value instanceof Date))).toBe(false)
  })

  test('finds chunks by document id and updates a single chunk safely', async () => {
    const databaseService = new FakeDatabaseService()
    databaseService.nextResult = [
      {
        document_id: "12",
        chunk_id: '12-0',
        chunk_index: 0,
        text_content: 'text',
        embedding_text: 'heading\ntext',
        section_id: 'section-1',
        heading_path: '["heading"]',
        page_no: 1,
        chunk_type: 'paragraph',
        order_in_section: 0,
        caption_text: null,
        picture_description: null,
      },
    ]
    const repository = new DocumentChunkRepositoryOrm(databaseService as never, fakeLogger)

    const rows = await repository.findByDocumentId("12")
    await repository.updateDocumentChunk({
      chunkId: '12-0',
      documentId: "12",
      chunkIndex: 0,
      text: 'edited',
      embeddingText: 'heading\nedited',
      tenantId: null,
      sourceType: 'pdf',
      fileName: 'demo.pdf',
      sectionId: 'section-1',
      headingPath: ['heading'],
      pageNo: 1,
      chunkType: 'paragraph',
      orderInSection: 0,
      captionText: null,
      pictureDescription: null,
      sheetName: null,
      tableId: null,
      rowStart: null,
      rowEnd: null,
      headers: undefined,
      keywords: undefined,
      startTime: null,
      endTime: null,
      cueIndex: null,
      propertyNamespace: null,
    })

    expect(rows).toHaveLength(1)
    expect(databaseService.calls.some((call) => call.sql.includes('WHERE document_id = ?'))).toBe(true)
    expect(databaseService.calls.some((call) => call.sql.startsWith('UPDATE document_chunk SET text_content = ?'))).toBe(true)
  })
})
