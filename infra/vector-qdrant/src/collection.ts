import type { QdrantClientLike } from "./client";

export const DENSE_VECTOR_NAME = "dense";
export const SPARSE_VECTOR_NAME = "sparse";

export interface DenseVectorSpec {
  name?: string;
  size: number;
  distance?: "Cosine" | "Euclid" | "Dot" | "Manhattan";
}

export interface SparseVectorSpec {
  name?: string;
}

export interface CollectionSpec {
  collectionName: string;
  dense: DenseVectorSpec;
  sparse?: SparseVectorSpec | null;
  /** When true (default if sparse configured), validate existing collection has hybrid schema. */
  requireHybridSchema?: boolean;
  /** Payload fields used in filters and their required Qdrant index schema. */
  payloadIndexes?: Record<string, "keyword" | "integer" | "float" | "bool" | "geo" | "text" | "datetime">;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFoundError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("404") || message.includes("not found");
}

export function hasHybridVectorSchema(
  collection: Record<string, unknown>,
  denseName = DENSE_VECTOR_NAME,
  sparseName = SPARSE_VECTOR_NAME,
): boolean {
  const config = collection.config;
  if (!config || typeof config !== "object") {
    return false;
  }
  const params = (config as { params?: Record<string, unknown> }).params;
  if (!params || typeof params !== "object") {
    return false;
  }

  const vectors = (params as { vectors?: Record<string, unknown> }).vectors;
  const sparseVectors = (params as { sparse_vectors?: Record<string, unknown> }).sparse_vectors;
  const denseConfig = vectors && typeof vectors === "object" ? (vectors as Record<string, unknown>)[denseName] : undefined;
  const sparseConfig =
    sparseVectors && typeof sparseVectors === "object" ? (sparseVectors as Record<string, unknown>)[sparseName] : undefined;

  return Boolean(denseConfig && sparseConfig);
}

export function hasDenseOnlySchema(collection: Record<string, unknown>, denseName = DENSE_VECTOR_NAME): boolean {
  const config = collection.config;
  if (!config || typeof config !== "object") {
    return false;
  }
  const params = (config as { params?: Record<string, unknown> }).params;
  if (!params || typeof params !== "object") {
    return false;
  }
  const vectors = (params as { vectors?: Record<string, unknown> }).vectors;
  if (!vectors || typeof vectors !== "object") {
    return false;
  }
  const denseConfig = (vectors as Record<string, unknown>)[denseName];
  return Boolean(denseConfig);
}

export class QdrantCollectionService {
  constructor(private readonly qdrantClient: QdrantClientLike) {}

  async ensureCollection(spec: CollectionSpec): Promise<void> {
    const denseName = spec.dense.name ?? DENSE_VECTOR_NAME;
    const sparseName = spec.sparse?.name ?? SPARSE_VECTOR_NAME;
    const client = await this.qdrantClient.getClient();

    try {
      const collection = await client.getCollection(spec.collectionName);
      const record = collection as Record<string, unknown>;
      if (spec.sparse) {
        const requireHybrid = spec.requireHybridSchema !== false;
        if (requireHybrid && !hasHybridVectorSchema(record, denseName, sparseName)) {
          throw new Error(
            `Qdrant collection "${spec.collectionName}" requires hybrid dense+sparse schema. Recreate or migrate the collection before enabling hybrid retrieval.`,
          );
        }
      } else if (!hasDenseOnlySchema(record, denseName)) {
        throw new Error(
          `Qdrant collection "${spec.collectionName}" requires dense vector "${denseName}". Recreate or migrate the collection.`,
        );
      }
      await this.ensurePayloadIndexes(spec, record);
      return;
    } catch (error) {
      const message = getErrorMessage(error);
      if (!isNotFoundError(error)) {
        throw new Error(`Qdrant collection check failed: ${message}`, { cause: error });
      }
    }

    const createPayload: Record<string, unknown> = {
      vectors: {
        [denseName]: {
          distance: spec.dense.distance ?? "Cosine",
          size: spec.dense.size,
        },
      },
    };
    if (spec.sparse) {
      createPayload.sparse_vectors = {
        [sparseName]: {},
      };
    }

    await client.createCollection(spec.collectionName, createPayload as never);
    await this.ensurePayloadIndexes(spec, null);
  }

  private async ensurePayloadIndexes(spec: CollectionSpec, collection: Record<string, unknown> | null): Promise<void> {
    const required = Object.entries(spec.payloadIndexes ?? {});
    if (required.length === 0) {
      return;
    }
    const client = await this.qdrantClient.getClient();
    if (!client.createPayloadIndex) {
      throw new Error(`Qdrant client cannot ensure payload indexes for collection "${spec.collectionName}"`);
    }
    const rawSchema = collection?.payload_schema;
    const payloadSchema = rawSchema && typeof rawSchema === "object" ? (rawSchema as Record<string, unknown>) : {};
    for (const [fieldName, expectedType] of required) {
      const existing = payloadSchema[fieldName];
      const actualType =
        typeof existing === "string"
          ? existing
          : existing && typeof existing === "object"
            ? (existing as { data_type?: unknown }).data_type
            : undefined;
      if (typeof actualType === "string") {
        if (actualType.toLowerCase() !== expectedType) {
          throw new Error(
            `Qdrant payload index "${fieldName}" in collection "${spec.collectionName}" is ${actualType}; expected ${expectedType}`,
          );
        }
        continue;
      }
      await client.createPayloadIndex(spec.collectionName, {
        field_name: fieldName,
        field_schema: expectedType,
        wait: true,
      });
    }
  }
}
