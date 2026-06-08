import type {
  AdapterCallContext,
  VectorHit,
  VectorIndexAdapter,
  VectorPayloadFilter,
  VectorPoint,
} from '@tachu/core';
import {
  QdrantClient,
  QdrantCollectionService,
  QdrantVectorIndex,
  type QdrantFilter,
} from '@cube-ai/vector-qdrant';
import {
  AGENTIC_ENGINE_MEMORY_COLLECTION,
  PAYLOAD_AGENTIC_SFID_KEY,
  toQdrantPointId,
  vectorHitIdFromPayload,
} from './qdrant-point-id';

export interface CubeQdrantMemoryIndexConfig {
  url: string;
  apiKey?: string;
  collectionName?: string;
  vectorSize?: number;
  searchTenant?: number;
}

function vectorPayloadFilterToQdrant(filter: VectorPayloadFilter): QdrantFilter | undefined {
  const must = filter.must;
  if (!must || Object.keys(must).length === 0) {
    return undefined;
  }
  return {
    must: Object.entries(must).map(([key, value]) => ({
      key,
      match: { value: value as string | number | boolean },
    })),
  };
}

/**
 * Production {@link VectorIndexAdapter} for memory projection + recall.
 * Dense-only Qdrant collection (ADR-0005 engine memory @1536) on {@link @cube-ai/vector-qdrant}.
 */
export class CubeQdrantMemoryIndex implements VectorIndexAdapter {
  private readonly collectionName: string;
  private readonly vectorSize: number;
  private readonly searchTenant: number;
  private readonly qdrantClient: QdrantClient;
  private readonly vectorIndex: QdrantVectorIndex;
  private collectionReady = false;

  constructor(config: CubeQdrantMemoryIndexConfig) {
    this.collectionName = config.collectionName ?? AGENTIC_ENGINE_MEMORY_COLLECTION;
    this.vectorSize = config.vectorSize ?? 1536;
    this.searchTenant =
      config.searchTenant ??
      Number(process.env['AGENTIC_ENGINE_MEMORY_TENANT_ID'] ?? '1');
    this.qdrantClient = new QdrantClient({
      url: config.url,
      ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
    });
    const collectionService = new QdrantCollectionService(this.qdrantClient);
    this.vectorIndex = new QdrantVectorIndex(this.qdrantClient, collectionService);
  }

  private resolveTenant(ctx: AdapterCallContext): number {
    if (typeof ctx.tenant === 'number') return ctx.tenant;
    return this.searchTenant;
  }

  private async ensureCollectionReady(): Promise<void> {
    if (this.collectionReady) return;
    await this.vectorIndex.ensureCollection({
      collectionName: this.collectionName,
      dense: { size: this.vectorSize },
      sparse: null,
    });
    this.collectionReady = true;
  }

  async upsert(
    points: readonly VectorPoint[],
    ctx: AdapterCallContext,
    signal?: AbortSignal,
  ): Promise<void> {
    void signal;
    await this.ensureCollectionReady();
    const tenant = this.resolveTenant(ctx);
    const userId = ctx.subject?.userId;
    await this.vectorIndex.upsert(
      this.collectionName,
      points.map((point) => ({
        id: String(toQdrantPointId(point.id)),
        vectors: { dense: point.vector },
        payload: {
          ...point.payload,
          tenant,
          ...(userId !== undefined ? { userId } : {}),
          [PAYLOAD_AGENTIC_SFID_KEY]: point.id,
        },
      })),
    );
  }

  async searchVector(
    query: number[],
    topK: number,
    filters: VectorPayloadFilter,
    ctx: AdapterCallContext,
    signal?: AbortSignal,
  ): Promise<VectorHit[]> {
    void signal;
    await this.ensureCollectionReady();
    const tenant =
      typeof filters.must?.['tenant'] === 'number'
        ? (filters.must['tenant'] as number)
        : this.resolveTenant(ctx);
    const merged: VectorPayloadFilter = {
      must: {
        tenant,
        ...(filters.must ?? {}),
      },
    };
    const hits = await this.vectorIndex.query({
      collectionName: this.collectionName,
      dense: query,
      filter: vectorPayloadFilterToQdrant(merged),
      topK,
    });
    return hits.map((h) => ({
      id: vectorHitIdFromPayload(h.payload, h.id),
      score: h.score,
      metadata: h.payload,
    }));
  }

  async delete(
    ids: readonly string[],
    ctx: AdapterCallContext,
    signal?: AbortSignal,
  ): Promise<void> {
    void ctx;
    void signal;
    if (ids.length === 0) return;
    await this.ensureCollectionReady();
    const qdrantIds = ids.map((id) => toQdrantPointId(id));
    const client = await this.qdrantClient.getClient();
    await client.delete(this.collectionName, { points: qdrantIds });
  }

  async healthCheck(): Promise<void> {
    await this.ensureCollectionReady();
  }
}
