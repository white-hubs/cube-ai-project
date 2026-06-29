import { type QdrantClientLike } from "./client";
import { type CollectionSpec, DENSE_VECTOR_NAME, type QdrantCollectionService, SPARSE_VECTOR_NAME } from "./collection";
import { buildPointId } from "./point-id";

export interface SparseVector {
  indices: number[];
  values: number[];
}

export type QdrantFilter = Record<string, unknown>;

export interface VectorUpsertPoint {
  id: string | number;
  vectors: {
    dense: number[];
    sparse?: SparseVector | null;
  };
  payload: Record<string, unknown>;
}

export interface VectorQueryParams {
  collectionName: string;
  dense: number[];
  sparse?: SparseVector | null;
  filter?: QdrantFilter;
  topK: number;
  fusion?: "rrf";
  scoreThreshold?: number;
  denseVectorName?: string;
  sparseVectorName?: string;
}

export interface VectorQueryHit {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFoundError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("404") || message.includes("not found");
}

export class QdrantVectorIndex {
  constructor(
    private readonly qdrantClient: QdrantClientLike,
    private readonly collectionService: QdrantCollectionService,
  ) {}

  async ensureCollection(spec: CollectionSpec): Promise<void> {
    await this.collectionService.ensureCollection(spec);
  }

  buildPointId(key: string): string {
    return buildPointId(key);
  }

  async upsert(collectionName: string, points: VectorUpsertPoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }
    const client = await this.qdrantClient.getClient();
    await client.upsert(collectionName, {
      points: points.map((point) => ({
        id: point.id,
        payload: point.payload,
        vector: {
          [DENSE_VECTOR_NAME]: point.vectors.dense,
          ...(point.vectors.sparse ? { [SPARSE_VECTOR_NAME]: point.vectors.sparse } : {}),
        },
      })),
    });
  }

  async query(params: VectorQueryParams): Promise<VectorQueryHit[]> {
    const denseName = params.denseVectorName ?? DENSE_VECTOR_NAME;
    const sparseName = params.sparseVectorName ?? SPARSE_VECTOR_NAME;
    const client = await this.qdrantClient.getClient();
    const prefetch = [
      {
        filter: params.filter,
        limit: params.topK,
        query: params.dense,
        score_threshold: params.scoreThreshold,
        using: denseName,
      },
      ...(params.sparse
        ? [
            {
              filter: params.filter,
              limit: params.topK,
              query: params.sparse,
              using: sparseName,
            },
          ]
        : []),
    ];
    const queryPayload = {
      limit: params.topK,
      prefetch,
      query: {
        fusion: params.fusion ?? "rrf",
      },
      with_payload: true,
    };

    let result;
    try {
      result = await client.query(params.collectionName, queryPayload);
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }
      throw error;
    }

    return result.points.map((item) => ({
      id: String(item.id),
      payload: (item.payload ?? {}) as Record<string, unknown>,
      score: item.score,
    }));
  }

  async delete(collectionName: string, filter: QdrantFilter): Promise<void> {
    const client = await this.qdrantClient.getClient();

    try {
      await client.getCollection(collectionName);
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      throw error;
    }

    const countResult = await client.count(collectionName, {
      exact: false,
      filter,
    });
    if ((countResult.count ?? 0) === 0) {
      return;
    }

    await client.delete(collectionName, { filter });
  }
}

export * from "./client";
export type { QdrantClientLike, QdrantRestClientLike } from "./client";
export {
  DENSE_VECTOR_NAME,
  hasDenseOnlySchema,
  hasHybridVectorSchema,
  QdrantCollectionService,
  SPARSE_VECTOR_NAME,
  type CollectionSpec,
} from "./collection";
export { buildPointId, buildStableQdrantPointId } from "./point-id";
