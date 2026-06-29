import { describe, expect, test } from "bun:test";

import {
  DENSE_VECTOR_NAME,
  QdrantCollectionService,
  QdrantVectorIndex,
  SPARSE_VECTOR_NAME,
  buildStableQdrantPointId,
  hasHybridVectorSchema,
} from "./index";

class FakeQdrantRestClient {
  public readonly upsertCalls: { collectionName: string; payload: Record<string, unknown> }[] = [];
  public readonly queryCalls: { collectionName: string; payload: Record<string, unknown> }[] = [];
  public readonly deleteCalls: { collectionName: string; payload: Record<string, unknown> }[] = [];
  public readonly getCollectionCalls: string[] = [];
  public readonly countCalls: { collectionName: string; payload: Record<string, unknown> }[] = [];
  public readonly createCollectionCalls: { name: string; payload: Record<string, unknown> }[] = [];
  public countResult = 1;
  public getCollectionError: Error | null = null;
  public existingCollection: Record<string, unknown> | null = null;

  async upsert(collectionName: string, payload: Record<string, unknown>): Promise<void> {
    this.upsertCalls.push({ collectionName, payload });
  }

  async getCollection(collectionName: string): Promise<Record<string, unknown>> {
    this.getCollectionCalls.push(collectionName);
    if (this.getCollectionError) {
      throw this.getCollectionError;
    }
    if (this.existingCollection) {
      return this.existingCollection;
    }
    throw new Error("404 collection not found");
  }

  async count(collectionName: string, payload: Record<string, unknown>): Promise<{ count: number }> {
    this.countCalls.push({ collectionName, payload });
    return { count: this.countResult };
  }

  async delete(collectionName: string, payload: Record<string, unknown>): Promise<void> {
    this.deleteCalls.push({ collectionName, payload });
  }

  async query(collectionName: string, payload: Record<string, unknown>) {
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

  async createCollection(name: string, payload: Record<string, unknown>): Promise<void> {
    this.createCollectionCalls.push({ name, payload });
  }
}

class FakeQdrantClient {
  constructor(public readonly restClient = new FakeQdrantRestClient()) {}

  async getClient(): Promise<FakeQdrantRestClient> {
    return this.restClient;
  }
}

const SPARSE_VECTOR = {
  indices: [1, 7, 13],
  values: [0.8, 0.5, 0.3],
};

describe("buildStableQdrantPointId", () => {
  test("is deterministic sha256→UUIDv4", () => {
    const id = buildStableQdrantPointId("doc-1-0");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(buildStableQdrantPointId("doc-1-0")).toBe(id);
  });
});

describe("QdrantCollectionService", () => {
  test("creates hybrid collection with named dense and sparse vectors", async () => {
    const qdrantClient = new FakeQdrantClient();
    const service = new QdrantCollectionService(qdrantClient);

    await service.ensureCollection({
      collectionName: "ai_server_documents",
      dense: { size: 1024 },
      sparse: {},
    });

    expect(qdrantClient.restClient.createCollectionCalls).toEqual([
      {
        name: "ai_server_documents",
        payload: {
          sparse_vectors: { sparse: {} },
          vectors: {
            dense: { distance: "Cosine", size: 1024 },
          },
        },
      },
    ]);
  });

  test("creates dense-only collection when sparse omitted", async () => {
    const qdrantClient = new FakeQdrantClient();
    const service = new QdrantCollectionService(qdrantClient);

    await service.ensureCollection({
      collectionName: "agent_memory",
      dense: { size: 1536 },
      sparse: null,
    });

    expect(qdrantClient.restClient.createCollectionCalls[0]?.payload).toEqual({
      vectors: {
        dense: { distance: "Cosine", size: 1536 },
      },
    });
  });

  test("throws when existing collection lacks hybrid schema", async () => {
    const qdrantClient = new FakeQdrantClient();
    qdrantClient.restClient.existingCollection = {
      config: {
        params: {
          vectors: { distance: "Cosine", size: 1024 },
        },
      },
    };
    const service = new QdrantCollectionService(qdrantClient);

    await expect(
      service.ensureCollection({
        collectionName: "ai_server_documents",
        dense: { size: 1024 },
        sparse: {},
      }),
    ).rejects.toThrow("requires hybrid dense+sparse schema");
  });
});

describe("QdrantVectorIndex", () => {
  test("upserts named dense and sparse vectors together", async () => {
    const qdrantClient = new FakeQdrantClient();
    const index = new QdrantVectorIndex(qdrantClient, new QdrantCollectionService(qdrantClient));

    await index.upsert("ai_server_documents", [
      {
        id: "point-1",
        payload: { chunkId: "chunk-1" },
        vectors: { dense: [0.1, 0.2, 0.3], sparse: SPARSE_VECTOR },
      },
    ]);

    expect(qdrantClient.restClient.upsertCalls[0]?.payload).toEqual({
      points: [
        {
          id: "point-1",
          payload: { chunkId: "chunk-1" },
          vector: {
            [DENSE_VECTOR_NAME]: [0.1, 0.2, 0.3],
            [SPARSE_VECTOR_NAME]: SPARSE_VECTOR,
          },
        },
      ],
    });
  });

  test("runs hybrid fusion query with dense and sparse prefetches", async () => {
    const qdrantClient = new FakeQdrantClient();
    const index = new QdrantVectorIndex(qdrantClient, new QdrantCollectionService(qdrantClient));
    const filter = {
      should: [{ key: "documentId", match: { value: "1" } }],
    };

    const results = await index.query({
      collectionName: "ai_server_documents",
      dense: [0.1, 0.2, 0.3],
      filter,
      fusion: "rrf",
      scoreThreshold: 0.3,
      sparse: SPARSE_VECTOR,
      topK: 5,
    });

    expect(qdrantClient.restClient.queryCalls[0]?.payload).toEqual({
      limit: 5,
      prefetch: [
        {
          query: [0.1, 0.2, 0.3],
          using: "dense",
          limit: 5,
          filter,
          score_threshold: 0.3,
        },
        {
          query: SPARSE_VECTOR,
          using: "sparse",
          limit: 5,
          filter,
        },
      ],
      query: { fusion: "rrf" },
      with_payload: true,
    });
    expect(results[0]?.score).toBe(0.91);
  });

  test("skips delete when count is zero", async () => {
    const qdrantClient = new FakeQdrantClient();
    qdrantClient.restClient.countResult = 0;
    const index = new QdrantVectorIndex(qdrantClient, new QdrantCollectionService(qdrantClient));

    await index.delete("ai_server_documents", {
      must: [{ key: "documentId", match: { value: "missing-doc" } }],
    });

    expect(qdrantClient.restClient.deleteCalls).toHaveLength(0);
  });

  test("returns empty hits when collection query responds Not Found", async () => {
    const qdrantClient = new FakeQdrantClient();
    qdrantClient.restClient.query = async () => {
      throw new Error("Not Found");
    };
    const index = new QdrantVectorIndex(qdrantClient, new QdrantCollectionService(qdrantClient));

    const results = await index.query({
      collectionName: "missing-collection",
      dense: [0.1, 0.2, 0.3],
      topK: 5,
    });

    expect(results).toEqual([]);
  });

  test("treats missing collection as no-op when deleting", async () => {
    const qdrantClient = new FakeQdrantClient();
    qdrantClient.restClient.getCollectionError = new Error("404 Not Found");
    const index = new QdrantVectorIndex(qdrantClient, new QdrantCollectionService(qdrantClient));

    await index.delete("ai_server_documents", {
      must: [{ key: "documentId", match: { value: "missing-doc" } }],
    });

    expect(qdrantClient.restClient.countCalls).toHaveLength(0);
    expect(qdrantClient.restClient.deleteCalls).toHaveLength(0);
  });
});

describe("hasHybridVectorSchema", () => {
  test("detects named dense and sparse vectors", () => {
    expect(
      hasHybridVectorSchema({
        config: {
          params: {
            sparse_vectors: { sparse: {} },
            vectors: { dense: { size: 1024 } },
          },
        },
      }),
    ).toBe(true);
  });
});
