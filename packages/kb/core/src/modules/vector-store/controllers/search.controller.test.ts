import { describe, expect, test } from 'bun:test'
import { BadRequestException } from '@dangao/bun-server'
import { SearchController } from './search.controller'

class FakeRetrievalService {
  public async search(params: { query: string; topK: number; documentId?: number }) {
    return { items: [{ ...params }] }
  }

  public async searchMultiByDocuments(params: { query: string; documents: unknown[] }) {
    return { items: [{ ...params }] }
  }

  public async searchByDirectory(params: { query: string; topK: number; directoryId: number }) {
    return { items: [{ ...params }] }
  }
}

describe('SearchController', () => {
  test('rejects invalid topK and documentId for search', async () => {
    const controller = new SearchController(new FakeRetrievalService() as never)

    await expect(controller.search({ query: 'hello', topK: Number.NaN })).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.search({ query: 'hello', documentId: "0" })).rejects.toBeInstanceOf(BadRequestException)
  })

  test('rejects invalid topK for directory search', async () => {
    const controller = new SearchController(new FakeRetrievalService() as never)

    await expect(controller.searchByDirectory({ query: 'hello', topK: -1, directoryId: "1" })).rejects.toBeInstanceOf(BadRequestException)
  })

  test('rejects invalid similarityThreshold', async () => {
    const controller = new SearchController(new FakeRetrievalService() as never)

    await expect(controller.search({ query: 'hello', similarityThreshold: 1.01 })).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.search({ query: 'hello', similarityThreshold: -0.01 })).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.searchByDirectory({ query: 'hello', directoryId: '1', similarityThreshold: Number.NaN })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  test('rejects invalid documents payload for searchByDocuments', async () => {
    const controller = new SearchController(new FakeRetrievalService() as never)

    await expect(controller.searchByDocuments({ query: 'hello' })).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.searchByDocuments({ query: 'hello', documents: [] })).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      controller.searchByDocuments({
        query: 'hello',
        documents: [{ documentId: 'a' }, { documentId: 'a' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.searchByDocuments({ query: 'hello', documents: [{ documentId: '0' }] })).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.searchByDocuments({ query: 'hello', documents: [{ documentId: 'x', topK: 0 }] })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })
})
