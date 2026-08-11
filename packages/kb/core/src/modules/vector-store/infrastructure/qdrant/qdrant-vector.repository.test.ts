import { describe, expect, test } from "bun:test";

import { type QdrantClientLike, QdrantCollectionService } from "@cube-ai/vector-qdrant";

import { makeMockAppConfig } from "../../../../test-helpers/mock-app-config";
import { type SparseVector } from "../embeddings/embedding-provider";
import { QdrantVectorRepository } from "./qdrant-vector.repository";

class FakeQdrantRestClient {
  public readonly upsertCalls: { collectionName: string; payload: Record<string, unknown> }[] = [];
  public readonly queryCalls: { collectionName: string; payload: Record<string, unknown> }[] = [];
  public readonly deleteCalls: { collectionName: string; payload: Record<string, unknown> }[] = [];
  public readonly getCollectionCalls: string[] = [];
  public readonly createCollectionCalls: { name: string; payload: Record<string, unknown> }[] = [];
  public readonly createPayloadIndexCalls: {
    collectionName: string;
    payload: { field_name: string; field_schema: string; wait?: boolean };
  }[] = [];
  public readonly countCalls: { collectionName: string; payload: Record<string, unknown> }[] = [];
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
          sparse_vectors: { sparse: {} },
          vectors: { dense: { size: 1024 } },
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
          id: "chunk-1",
          payload: { chunkId: "chunk-1", documentId: "1" },
          score: 0.91,
        },
      ],
    };
  }

  public async createCollection(name: string, payload: Record<string, unknown>): Promise<void> {
    this.createCollectionCalls.push({ name, payload });
    this.getCollectionError = null;
  }

  public async createPayloadIndex(
    collectionName: string,
    payload: { field_name: string; field_schema: string; wait?: boolean },
  ): Promise<void> {
    this.createPayloadIndexCalls.push({ collectionName, payload });
  }

  public async scroll(collectionName: string, payload: Record<string, unknown>) {
    void collectionName;
    void payload;
    return { next_page_offset: null, points: [] as { id: unknown; payload?: Record<string, unknown> }[] };
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

describe("QdrantVectorRepository", () => {
  test("upserts named dense and sparse vectors together", async () => {
    const qdrantClient = new FakeQdrantClient();
    const repository = new QdrantVectorRepository(makeMockAppConfig(), qdrantClient, new QdrantCollectionService(qdrantClient));

    await repository.upsert([
      {
        id: "point-1",
        payload: {
          captionText: null,
          chunkId: "chunk-1",
          chunkIndex: 0,
          chunkType: "table-row-window",
          documentId: "1",
          embeddingText: "embedding text",
          fileName: "demo.xlsx",
          headingPath: ["Assets"],
          orderInSection: 0,
          pageNo: null,
          pictureDescription: null,
          sectionId: "sheet:assets",
          sourceType: "xlsx",
          text: "display text",
        },
        vectors: {
          dense: [0.1, 0.2, 0.3],
          sparse: SPARSE_VECTOR,
        },
      },
    ]);

    expect(qdrantClient.restClient.upsertCalls[0]?.payload).toEqual({
      points: [
        {
          id: "point-1",
          payload: expect.any(Object),
          vector: {
            dense: [0.1, 0.2, 0.3],
            sparse: SPARSE_VECTOR,
          },
        },
      ],
    });
  });

  test("runs hybrid fusion query with dense and sparse prefetches", async () => {
    const qdrantClient = new FakeQdrantClient();
    const repository = new QdrantVectorRepository(makeMockAppConfig(), qdrantClient, new QdrantCollectionService(qdrantClient));

    const results = await repository.search({
      denseVector: [0.1, 0.2, 0.3],
      documentId: "1",
      scoreThreshold: 0.3,
      sparseVector: SPARSE_VECTOR,
      topK: 5,
    });

    const expectedAclMust = {
      should: [{ is_null: { key: "aclGroupIds" } }, { is_empty: { key: "aclGroupIds" } }],
    };
    expect(qdrantClient.restClient.queryCalls[0]?.payload).toEqual({
      limit: 5,
      prefetch: [
        {
          query: [0.1, 0.2, 0.3],
          using: "dense",
          limit: 5,
          filter: {
            must: [expectedAclMust],
            should: [
              { key: "documentId", match: { value: "1" } },
              { key: "documentId", match: { value: 1 } },
            ],
          },
          score_threshold: 0.3,
        },
        {
          query: SPARSE_VECTOR,
          using: "sparse",
          limit: 5,
          filter: {
            must: [expectedAclMust],
            should: [
              { key: "documentId", match: { value: "1" } },
              { key: "documentId", match: { value: 1 } },
            ],
          },
        },
      ],
      query: { fusion: "rrf" },
      with_payload: true,
    });
    expect(results[0]?.score).toBe(0.91);
    expect(qdrantClient.restClient.getCollectionCalls.length).toBeGreaterThan(0);
  });

  test("W4.1-H1: vector search filter denies ACL-tagged docs without group overlap", async () => {
    const qdrantClient = new FakeQdrantClient();
    const repository = new QdrantVectorRepository(makeMockAppConfig(), qdrantClient, new QdrantCollectionService(qdrantClient));

    await repository.search({
      denseVector: [0.1, 0.2, 0.3],
      filters: { docType: "standard" },
      identity: { groupIds: ["eng"] },
      sparseVector: SPARSE_VECTOR,
      topK: 3,
    });

    const firstQuery = qdrantClient.restClient.queryCalls[0];
    expect(firstQuery).toBeDefined();
    const filter = (firstQuery!.payload as { prefetch: { filter: Record<string, unknown> }[] }).prefetch[0]?.filter;
    const must = filter?.must as Record<string, unknown>[];
    expect(Array.isArray(must)).toBe(true);
    const aclClause = must.find((item) => Array.isArray((item as { should?: unknown }).should));
    expect(aclClause).toBeDefined();
    const should = (aclClause as { should: Record<string, unknown>[] }).should;
    expect(should.some((item) => (item as { match?: { any?: string[] } }).match?.any?.includes("eng"))).toBe(true);
    expect(must.some((item) => (item as { key?: string }).key === "docType")).toBe(true);
  });

  test("creates missing collection before search instead of failing with Not Found", async () => {
    const qdrantClient = new FakeQdrantClient();
    qdrantClient.restClient.getCollectionError = new Error("404 Not Found");
    const repository = new QdrantVectorRepository(makeMockAppConfig(), qdrantClient, new QdrantCollectionService(qdrantClient));

    const results = await repository.search({
      denseVector: [0.1, 0.2, 0.3],
      documentId: "2063877629778944002",
      sparseVector: SPARSE_VECTOR,
      topK: 5,
    });

    expect(qdrantClient.restClient.createCollectionCalls.length).toBeGreaterThan(0);
    expect(qdrantClient.restClient.queryCalls).toHaveLength(1);
    expect(results[0]?.score).toBe(0.91);
  });

  test("skips delete when document does not exist in qdrant", async () => {
    const qdrantClient = new FakeQdrantClient();
    qdrantClient.restClient.countResult = 0;
    const repository = new QdrantVectorRepository(makeMockAppConfig(), qdrantClient, new QdrantCollectionService(qdrantClient));

    await repository.deleteByDocument("missing-doc");

    expect(qdrantClient.restClient.countCalls[0]?.payload).toEqual({
      exact: false,
      filter: {
        must: [{ key: "documentId", match: { value: "missing-doc" } }],
      },
    });
    expect(qdrantClient.restClient.deleteCalls).toHaveLength(0);
  });

  test("treats missing collection as no-op when deleting a document", async () => {
    const qdrantClient = new FakeQdrantClient();
    qdrantClient.restClient.getCollectionError = new Error("404 Not Found");
    const repository = new QdrantVectorRepository(makeMockAppConfig(), qdrantClient, new QdrantCollectionService(qdrantClient));

    await repository.deleteByDocument("missing-doc");

    expect(qdrantClient.restClient.countCalls).toHaveLength(0);
    expect(qdrantClient.restClient.deleteCalls).toHaveLength(0);
  });
});
