import { Inject, Injectable } from '@dangao/bun-server';
import {
  QdrantClient,
  type QdrantClientLike,
  QdrantCollectionService,
  QdrantVectorIndex,
  buildStableQdrantPointId,
  type QdrantFilter,
  type SparseVector,
} from '@cube-ai/vector-qdrant';
import { currentTenantId, isGlobalAccessEnabled } from '@/infra/access-scope';
import { APP_CONFIG_TOKEN, type AppConfig } from '@/config/app.config';

export interface QdrantPointPayload extends Record<string, unknown> {
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  fileName: string;
  sourceType: string;
  text: string;
  embeddingText: string;
  sectionId: string;
  headingPath: string[];
  pageNo: number | null;
  chunkType: string;
  orderInSection: number;
  captionText: string | null;
  pictureDescription: string | null;
  sheetName?: string | null;
  tableId?: string | null;
  rowStart?: number | null;
  rowEnd?: number | null;
  headers?: string[];
  keywords?: string[];
  startTime?: string | null;
  endTime?: string | null;
  cueIndex?: number | null;
  propertyNamespace?: string | null;
  retrievalProfile?: string | null;
  tenantId?: string | null;
}

export interface QdrantSearchResult {
  id: string;
  score: number;
  payload: QdrantPointPayload;
}

export interface QdrantUpsertPoint {
  id: string | number;
  vectors: {
    dense: number[];
    sparse: SparseVector | null;
  };
  payload: QdrantPointPayload;
}

export interface QdrantVectorRepositorySearchParams {
  denseVector: number[];
  sparseVector: SparseVector | null;
  topK: number;
  documentId?: string;
  documentIds?: string[];
  scoreThreshold?: number;
}

export { buildStableQdrantPointId };

@Injectable()
export class QdrantVectorRepository {
  private readonly vectorIndex: QdrantVectorIndex;

  public constructor(
    @Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig,
    @Inject(QdrantClient) private readonly qdrantClient: QdrantClientLike,
    @Inject(QdrantCollectionService) qdrantCollectionService: QdrantCollectionService,
  ) {
    this.vectorIndex = new QdrantVectorIndex(qdrantClient, qdrantCollectionService);
  }

  private getScopedTenantIdForFilter(): string | null {
    if (isGlobalAccessEnabled()) return null;
    return currentTenantId();
  }

  private buildSearchFilter(
    params: QdrantVectorRepositorySearchParams,
  ): QdrantFilter | undefined {
    const scopedTenantId = this.getScopedTenantIdForFilter();
    const should: Array<{ key: string; match: { value: string | number } }> = [];
    if (params.documentId !== undefined) {
      const documentId = String(params.documentId).trim();
      should.push({ key: 'documentId', match: { value: documentId } });
      if (/^\d+$/u.test(documentId)) {
        should.push({ key: 'documentId', match: { value: Number(documentId) } });
      }
    }
    for (const documentId of params.documentIds ?? []) {
      const normalized = String(documentId).trim();
      should.push({ key: 'documentId', match: { value: normalized } });
      if (/^\d+$/u.test(normalized)) {
        should.push({ key: 'documentId', match: { value: Number(normalized) } });
      }
    }

    const must: Array<{ key: string; match: { value: string } }> = [];
    if (scopedTenantId !== null) {
      must.push({ key: 'tenantId', match: { value: scopedTenantId } });
    }

    if (must.length === 0 && should.length === 0) {
      return undefined;
    }

    const filter: QdrantFilter = {};
    if (must.length > 0) {
      filter.must = must;
    }
    if (should.length > 0) {
      filter.should = should;
    }
    return filter;
  }

  private buildDeleteFilter(documentId: string): QdrantFilter {
    const scopedTenantId = this.getScopedTenantIdForFilter();
    const must: Array<{ key: string; match: { value: string } }> = [
      {
        key: 'documentId',
        match: { value: documentId },
      },
    ];
    if (scopedTenantId !== null) {
      must.push({ key: 'tenantId', match: { value: scopedTenantId } });
    }
    return { must };
  }

  public async ensureCollection(): Promise<void> {
    await this.vectorIndex.ensureCollection({
      collectionName: this.config.qdrantCollectionName,
      dense: { size: this.config.qdrantVectorSize },
      sparse: {},
    });
  }

  public async upsert(points: QdrantUpsertPoint[]): Promise<void> {
    if (points.length === 0) {
      return;
    }
    const scopedTenantId = this.getScopedTenantIdForFilter();
    await this.vectorIndex.upsert(
      this.config.qdrantCollectionName,
      points.map((point) => ({
        id: point.id,
        vectors: point.vectors,
        payload: { ...point.payload, tenantId: scopedTenantId } as Record<string, unknown>,
      })),
    );
  }

  public async search(params: QdrantVectorRepositorySearchParams): Promise<QdrantSearchResult[]> {
    await this.ensureCollection();
    const hits = await this.vectorIndex.query({
      collectionName: this.config.qdrantCollectionName,
      dense: params.denseVector,
      sparse: params.sparseVector,
      topK: params.topK,
      filter: this.buildSearchFilter(params),
      fusion: 'rrf',
      scoreThreshold: params.scoreThreshold,
    });
    return hits.map((item) => ({
      id: item.id,
      score: item.score,
      payload: item.payload as QdrantPointPayload,
    }));
  }

  public async deleteByDocument(documentId: string): Promise<void> {
    await this.vectorIndex.delete(
      this.config.qdrantCollectionName,
      this.buildDeleteFilter(documentId),
    );
  }
}
