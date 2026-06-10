import { describe, expect, test } from 'bun:test';
import type { SparseVector } from '../embeddings/embedding-provider';
import { makeMockAppConfig } from '../../../../test-helpers/mock-app-config';
import { QdrantVectorRepository } from './qdrant-vector.repository';
import { QdrantCollectionService, type QdrantClientLike } from '@cube-ai/vector-qdrant';

class FakeQdrantRestClient {
  public readonly upsertCalls: Array<{ collectionName: string; payload: Record<string, unknown> }> = [];
  public readonly queryCalls: Array<{ collectionName: string; payload: Record<string, unknown> }> = [];
  public readonly deleteCalls: Array<{ collectionName: string; payload: Record<string, unknown> }> = [];
  public readonly getCollectionCalls: string[] = [];
  public readonly createCollectionCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  public readonly countCalls: Array<{ collectionName: string; payload: Record<string, unknown> }> = [];
  public countResult = 1;
  public getCollectionError: Error | null = null;

  public async upsert(collectionName: string, payload: Record<string, unknown>): Promise<void> {
    this.upsertCalls.push({ collectionName, payload });
  }

  public async getCollection(collectionName: string): Promise<Record<string, unknown>> {
    this.getCollectionCalls.push(collectionName);
    if (this.getCollectionError) {
      throw this.getCollectionError;
    }
    return {
      config: {
        params: {
          vectors: { dense: { size: 1024 } },
          sparse_vectors: { sparse: {} },
        },
      },
    };
  }

  public async count(collectionName: string, payload: Record<string, unknown>): Promise<{ count: number }> {
    this.countCalls.push({ collectionName, payload });
    return { count: this.countResult };
  }

  public async delete(collectionName: string, payload: Record<string, unknown>): Promise<void> {
    this.deleteCalls.push({ collectionName, payload });
  }

  public async query(collectionName: string, payload: Record<string, unknown>) {
    this.queryCalls.push({ collectionName, payload });
    return {
      points: [
        {
          id: 'chunk-1',
          score: 0.91,
          payload: { chunkId: 'chunk-1', documentId: '1' },
        },
      ],
    };
  }

  public async createCollection(name: string, payload: Record<string, unknown>): Promise<void> {
    this.createCollectionCalls.push({ name, payload });
    this.getCollectionError = null;
  }
}

class FakeQdrantClient implements QdrantClientLike {
  public readonly restClient = new FakeQdrantRestClient();

  async getClient(): Promise<FakeQdrantRestClient> {
    return this.restClient;
  }
}

const SPARSE_VECTOR: SparseVector = {
  indices: [1, 7, 13],
  values: [0.8, 0.5, 0.3],
};

describe('QdrantVectorRepository', () => {
  test('upserts named dense and sparse vectors together', async () => {
    const qdrantClient = new FakeQdrantClient();
    const repository = new QdrantVectorRepository(
      makeMockAppConfig(),
      qdrantClient,
      new QdrantCollectionService(qdrantClient),
    );

    await repository.upsert([
      {
        id: 'point-1',
        vectors: {
          dense: [0.1, 0.2, 0.3],
          sparse: SPARSE_VECTOR,
        },
        payload: {
          chunkId: 'chunk-1',
          documentId: '1',
          chunkIndex: 0,
          fileName: 'demo.xlsx',
          sourceType: 'xlsx',
          text: 'display text',
          embeddingText: 'embedding text',
          sectionId: 'sheet:assets',
          headingPath: ['Assets'],
          pageNo: null,
          chunkType: 'table-row-window',
          orderInSection: 0,
          captionText: null,
          pictureDescription: null,
        },
      },
    ]);

    expect(qdrantClient.restClient.upsertCalls[0]?.payload).toEqual({
      points: [
        {
          id: 'point-1',
          vector: {
            dense: [0.1, 0.2, 0.3],
            sparse: SPARSE_VECTOR,
          },
          payload: expect.any(Object),
        },
      ],
    });
  });

  test('runs hybrid fusion query with dense and sparse prefetches', async () => {
    const qdrantClient = new FakeQdrantClient();
    const repository = new QdrantVectorRepository(
      makeMockAppConfig(),
      qdrantClient,
      new QdrantCollectionService(qdrantClient),
    );

    const results = await repository.search({
      denseVector: [0.1, 0.2, 0.3],
      sparseVector: SPARSE_VECTOR,
      topK: 5,
      documentId: '1',
      scoreThreshold: 0.3,
    });

    expect(qdrantClient.restClient.queryCalls[0]?.payload).toEqual({
      prefetch: [
        {
          query: [0.1, 0.2, 0.3],
          using: 'dense',
          limit: 5,
          filter: {
            should: [
              { key: 'documentId', match: { value: '1' } },
              { key: 'documentId', match: { value: 1 } },
            ],
          },
          score_threshold: 0.3,
        },
        {
          query: SPARSE_VECTOR,
          using: 'sparse',
          limit: 5,
          filter: {
            should: [
              { key: 'documentId', match: { value: '1' } },
              { key: 'documentId', match: { value: 1 } },
            ],
          },
        },
      ],
      query: { fusion: 'rrf' },
      limit: 5,
      with_payload: true,
    });
    expect(results[0]?.score).toBe(0.91);
    expect(qdrantClient.restClient.getCollectionCalls.length).toBeGreaterThan(0);
  });

  test('creates missing collection before search instead of failing with Not Found', async () => {
    const qdrantClient = new FakeQdrantClient();
    qdrantClient.restClient.getCollectionError = new Error('404 Not Found');
    const repository = new QdrantVectorRepository(
      makeMockAppConfig(),
      qdrantClient,
      new QdrantCollectionService(qdrantClient),
    );

    const results = await repository.search({
      denseVector: [0.1, 0.2, 0.3],
      sparseVector: SPARSE_VECTOR,
      topK: 5,
      documentId: '2063877629778944002',
    });

    expect(qdrantClient.restClient.createCollectionCalls.length).toBeGreaterThan(0);
    expect(qdrantClient.restClient.queryCalls).toHaveLength(1);
    expect(results[0]?.score).toBe(0.91);
  });

  test('skips delete when document does not exist in qdrant', async () => {
    const qdrantClient = new FakeQdrantClient();
    qdrantClient.restClient.countResult = 0;
    const repository = new QdrantVectorRepository(
      makeMockAppConfig(),
      qdrantClient,
      new QdrantCollectionService(qdrantClient),
    );

    await repository.deleteByDocument('missing-doc');

    expect(qdrantClient.restClient.countCalls[0]?.payload).toEqual({
      filter: {
        must: [{ key: 'documentId', match: { value: 'missing-doc' } }],
      },
      exact: false,
    });
    expect(qdrantClient.restClient.deleteCalls).toHaveLength(0);
  });

  test('treats missing collection as no-op when deleting a document', async () => {
    const qdrantClient = new FakeQdrantClient();
    qdrantClient.restClient.getCollectionError = new Error('404 Not Found');
    const repository = new QdrantVectorRepository(
      makeMockAppConfig(),
      qdrantClient,
      new QdrantCollectionService(qdrantClient),
    );

    await repository.deleteByDocument('missing-doc');

    expect(qdrantClient.restClient.countCalls).toHaveLength(0);
    expect(qdrantClient.restClient.deleteCalls).toHaveLength(0);
  });
});
