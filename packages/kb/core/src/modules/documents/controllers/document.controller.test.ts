import { describe, expect, test } from 'bun:test'
import { DocumentController } from './document.controller'

class FakeDocumentService {
  public uploadCalls: Array<unknown[]> = []
  public reindexCalls: Array<unknown[]> = []
  public previewUploadCalls: Array<unknown[]> = []
  public previewDocumentCalls: Array<unknown[]> = []
  public listChunkCalls: Array<unknown[]> = []
  public updateChunkCalls: Array<unknown[]> = []

  public async uploadDocument(...args: unknown[]) {
    this.uploadCalls.push(args)
    return { ok: true }
  }

  public async reindexDocument(...args: unknown[]) {
    this.reindexCalls.push(args)
    return { ok: true }
  }

  public async previewDocumentChunks(...args: unknown[]) {
    this.previewUploadCalls.push(args)
    return { items: [] }
  }

  public async previewDocumentChunksById(...args: unknown[]) {
    this.previewDocumentCalls.push(args)
    return { items: [] }
  }

  public async listDocumentChunks(...args: unknown[]) {
    this.listChunkCalls.push(args)
    return { items: [] }
  }

  public async updateDocumentChunk(...args: unknown[]) {
    this.updateChunkCalls.push(args)
    return { chunkId: '1-0', text: 'updated' }
  }
}

describe('DocumentController', () => {
  test('parses optional chunking options from upload form data', async () => {
    const documentService = new FakeDocumentService()
    const controller = new DocumentController(documentService as never, null as never)
    const formData = new FormData()
    formData.set('file', new File(['hello'], 'note.txt', { type: 'text/plain' }))
    formData.set('directoryId', '12')
    formData.set('separator', '###')
    formData.set('chunkSize', '256')
    formData.set('chunkOverlap', '32')
    formData.set('tableChunkMode', 'row')
    formData.set('textChunkMode', 'block')

    await controller.upload({
      getBody: async () => formData,
    } as never)

    expect(documentService.uploadCalls[0]?.[1]).toBe('12')
    expect(documentService.uploadCalls[0]?.[2]).toEqual({
      separator: '###',
      chunkSize: 256,
      chunkOverlap: 32,
      tableChunkMode: 'row',
      textChunkMode: 'block',
    })
  })

  test('parses optional chunking options from reindex body', async () => {
    const documentService = new FakeDocumentService()
    const controller = new DocumentController(documentService as never, null as never)

    await controller.reindex({
      getBody: async () => ({
        separator: '***',
        chunkSize: 300,
        chunkOverlap: 20,
        tableChunkMode: 'window',
        textChunkMode: 'merge',
      }),
    } as never, '42')

    expect(documentService.reindexCalls[0]).toEqual([
      '42',
      {
        separator: '***',
        chunkSize: 300,
        chunkOverlap: 20,
        tableChunkMode: 'window',
        textChunkMode: 'merge',
      },
    ])
  })

  test('parses upload preview request from multipart form data', async () => {
    const documentService = new FakeDocumentService()
    const controller = new DocumentController(documentService as never, null as never)
    const formData = new FormData()
    formData.set('file', new File(['hello'], 'preview.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    formData.set('separator', '\\n\\n')
    formData.set('chunkSize', '128')
    formData.set('chunkOverlap', '8')
    formData.set('textChunkMode', 'block')

    await controller.preview({
      getBody: async () => formData,
    } as never)

    expect(documentService.previewUploadCalls[0]?.[1]).toEqual({
      separator: '\\n\\n',
      chunkSize: 128,
      chunkOverlap: 8,
      textChunkMode: 'block',
    })
  })

  test('previews existing document by id without chunking body', async () => {
    const documentService = new FakeDocumentService()
    const controller = new DocumentController(documentService as never, null as never)

    await controller.previewById('77')

    expect(documentService.previewDocumentCalls[0]).toEqual(['77'])
  })

  test('lists document chunks and updates a chunk text', async () => {
    const documentService = new FakeDocumentService()
    const controller = new DocumentController(documentService as never, null as never)

    await controller.listChunks('13')
    await controller.updateChunk('13', '13-2', {
      text: 'new body',
    } as never)

    expect(documentService.listChunkCalls[0]).toEqual(['13'])
    expect(documentService.updateChunkCalls[0]).toEqual(['13', '13-2', 'new body', undefined])
  })

  test('updates chunk with keyword add/remove payload', async () => {
    const documentService = new FakeDocumentService()
    const controller = new DocumentController(documentService as never, null as never)

    await controller.updateChunk('14', '14-1', {
      text: 'body',
      keywordsAdd: ['a', 'b'],
      keywordsRemove: ['old'],
    } as never)

    expect(documentService.updateChunkCalls[0]).toEqual([
      '14',
      '14-1',
      'body',
      { keywordsAdd: ['a', 'b'], keywordsRemove: ['old'] },
    ])
  })
})
