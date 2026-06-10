import { describe, expect, it, mock } from 'bun:test'
import { PlatformSourceImportService } from './platform-source-import.service'
import type { PlatformKbSourcePort } from '../../port/platform-source.port'
import type { DocumentService } from '../documents/services/document.service'

describe('PlatformSourceImportService', () => {
  it('fetches source docs and uploads each one via DocumentService', async () => {
    const listSourceDocs = mock(() =>
      Promise.resolve([
        {
          externalId: 'ext-1',
          fileName: 'report.pdf',
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: 'application/pdf',
        },
        {
          externalId: 'ext-2',
          fileName: 'notes.txt',
          bytes: new Uint8Array([4, 5]),
          mimeType: 'text/plain',
        },
      ]),
    )
    const port: PlatformKbSourcePort = {
      listSourceDocs,
      getSourceDocByExternalId: mock(() => Promise.resolve(null)),
      getSourceDocByFileId: mock(() => Promise.resolve(null)),
      getSourceDocByKnowledgeBaseId: mock(() => Promise.resolve(null)),
    }

    const uploadDocument = mock(() =>
      Promise.resolve({
        documentId: 'doc-uuid',
        importJobId: 'job-uuid',
        status: 'uploaded' as const,
        supportedForParsing: true,
      }),
    )
    const documentService = { uploadDocument } as unknown as DocumentService

    const service = new PlatformSourceImportService(port, documentService)
    const result = await service.importFromPlatformKb('kb-999', 'dir-abc')

    expect(listSourceDocs).toHaveBeenCalledTimes(1)
    expect(listSourceDocs).toHaveBeenCalledWith('kb-999', undefined)
    expect(uploadDocument).toHaveBeenCalledTimes(2)
    expect(result.imported).toBe(2)
    expect(result.errors).toBe(0)
  })

  it('counts errors without throwing when an upload fails', async () => {
    const port: PlatformKbSourcePort = {
      listSourceDocs: mock(() =>
        Promise.resolve([
          { externalId: 'e1', fileName: 'ok.pdf', bytes: new Uint8Array([1]), mimeType: 'application/pdf' },
          { externalId: 'e2', fileName: 'bad.pdf', bytes: new Uint8Array([2]), mimeType: 'application/pdf' },
        ]),
      ),
      getSourceDocByExternalId: mock(() => Promise.resolve(null)),
      getSourceDocByFileId: mock(() => Promise.resolve(null)),
      getSourceDocByKnowledgeBaseId: mock(() => Promise.resolve(null)),
    }
    let call = 0
    const documentService = {
      uploadDocument: mock(() => {
        call++
        if (call === 2) return Promise.reject(new Error('upload failed'))
        return Promise.resolve({ documentId: 'd1', importJobId: 'j1', status: 'uploaded' as const, supportedForParsing: true })
      }),
    } as unknown as DocumentService

    const service = new PlatformSourceImportService(port, documentService)
    const result = await service.importFromPlatformKb('kb-1', 'dir-1')

    expect(result.imported).toBe(1)
    expect(result.errors).toBe(1)
  })
})
