import { describe, expect, test } from 'bun:test'
import { BadRequestException, NotFoundException } from '@dangao/bun-server'
import { DocumentDirectoryService } from './document-directory.service'

function makeService(
  directoryRepo: Record<string, unknown>,
  documentRepo: Record<string, unknown> = {
    aggregateDocumentStatsByDirectoryIds: async () => new Map(),
  },
  documentService: Record<string, unknown> = {
    deleteDocument: async () => {},
  },
): DocumentDirectoryService {
  return new DocumentDirectoryService(
    directoryRepo as never,
    documentRepo as never,
    documentService as never,
  )
}

describe('DocumentDirectoryService', () => {
  test('createDirectory validates name and trims', async () => {
    const repo = {
      createDirectory: async (payload: { name: string; description?: string | null; icon?: string | null }) => ({
        id: '123',
        ...payload,
      }),
      findAll: async () => [],
    }

    const svc = makeService(repo)

    await expect(svc.createDirectory({ name: '' })).rejects.toBeInstanceOf(BadRequestException)
    const id = await svc.createDirectory({ name: '  dir-1  ' })
    expect(id).toBe('123')
  })

  test('listDirectories maps id, name, description, icon', async () => {
    const repo = {
      createDirectory: async () => ({ id: '1' }),
      findAll: async () => [
        { id: '10', name: 'a', description: 'da', icon: 'i1' },
        { id: '20', name: 'b', description: null, icon: null },
      ],
    }

    const svc = makeService(repo)
    const list = await svc.listDirectories()
    expect(list).toEqual([
      { id: '10', name: 'a', description: 'da', icon: 'i1' },
      { id: '20', name: 'b', description: null, icon: null },
    ])
  })

  test('searchDirectories supports pagination, keyword and aggregates stats', async () => {
    const repo = {
      searchDirectories: async ({
        pageNumber,
        pageSize,
        keyword,
      }: {
        pageNumber: number
        pageSize: number
        keyword: string | null
      }) => {
        expect(pageNumber).toBe(2)
        expect(pageSize).toBe(10)
        expect(keyword).toBe('abc')
        return {
          items: [
            {
              id: '1',
              name: 'd1',
              description: 'desc1',
              icon: 'https://x/icon.png',
              update_time: new Date('2024-06-01T00:00:00.000Z'),
            },
            {
              id: '2',
              name: 'd2',
              description: null,
              icon: null,
              update_time: new Date('2024-06-02T00:00:00.000Z'),
            },
          ],
          total: 25,
        }
      },
    }

    const statsMap = new Map([
      ['1', { documentCount: 3, totalSizeBytes: 1024 }],
      ['2', { documentCount: 0, totalSizeBytes: 0 }],
    ])

    const documentRepo = {
      aggregateDocumentStatsByDirectoryIds: async (ids: string[]) => {
        expect(ids).toEqual(['1', '2'])
        return statsMap
      },
    }

    const svc = makeService(repo, documentRepo)
    const result = await svc.searchDirectories({
      pageNumber: 2,
      pageSize: 10,
      keyword: 'abc',
      period: undefined,
    })

    expect(result.items).toEqual([
      {
        id: '1',
        name: 'd1',
        description: 'desc1',
        icon: 'https://x/icon.png',
        documentCount: 3,
        totalSizeBytes: 1024,
        updateTime: new Date('2024-06-01T00:00:00.000Z'),
      },
      {
        id: '2',
        name: 'd2',
        description: null,
        icon: null,
        documentCount: 0,
        totalSizeBytes: 0,
        updateTime: new Date('2024-06-02T00:00:00.000Z'),
      },
    ])
    expect(result.total).toBe(25)
    expect(result.pages).toBe(3)
  })

  test('updateDirectory requires at least one field and returns list-shaped row', async () => {
    const directoryRepo = {
      findById: async (id: string) =>
        id === '7'
          ? {
              id: '7',
              name: 'old',
              description: null,
              icon: null,
              update_time: new Date('2024-01-01T00:00:00.000Z'),
            }
          : null,
      updateDirectory: async (
        id: string,
        patch: { name?: string; description?: string | null; icon?: string | null },
      ) => {
        expect(id).toBe('7')
        expect(patch).toEqual({ name: 'new' })
        return {
          id: '7',
          name: 'new',
          description: null,
          icon: null,
          update_time: new Date('2024-01-02T00:00:00.000Z'),
        }
      },
    }
    const documentRepo = {
      aggregateDocumentStatsByDirectoryIds: async () =>
        new Map([['7', { documentCount: 2, totalSizeBytes: 99 }]]),
    }
    const svc = makeService(directoryRepo, documentRepo)
    await expect(svc.updateDirectory('7', {})).rejects.toBeInstanceOf(BadRequestException)
    const row = await svc.updateDirectory('7', { name: 'new' })
    expect(row).toEqual({
      id: '7',
      name: 'new',
      description: null,
      icon: null,
      documentCount: 2,
      totalSizeBytes: 99,
      updateTime: new Date('2024-01-02T00:00:00.000Z'),
    })
  })

  test('deleteDirectory removes documents then soft-deletes directory', async () => {
    const deletedDocs: string[] = []
    const directoryRepo = {
      findById: async (id: string) => (id === '9' ? { id: '9', name: 'x' } : null),
      logicalDelete: async (id: string) => {
        expect(id).toBe('9')
        return true
      },
    }
    const documentRepo = {
      aggregateDocumentStatsByDirectoryIds: async () => new Map(),
      findIdsByDirectoryId: async (dirId: string) => {
        expect(dirId).toBe('9')
        return ['101', '102']
      },
    }
    const documentService = {
      deleteDocument: async (docId: string) => {
        deletedDocs.push(docId)
      },
    }

    const svc = makeService(directoryRepo, documentRepo, documentService)
    const out = await svc.deleteDirectory('9')
    expect(out).toEqual({ ok: true })
    expect(deletedDocs).toEqual(['101', '102'])
  })

  test('deleteDirectory throws when directory missing', async () => {
    const directoryRepo = {
      findById: async () => null,
    }
    const svc = makeService(directoryRepo)
    await expect(svc.deleteDirectory('missing')).rejects.toBeInstanceOf(NotFoundException)
  })
})
