import { Inject, Injectable } from "@dangao/bun-server";

import { currentTenantId, isGlobalAccessEnabled } from "@cube-ai/tenant-context";
import {
  QdrantClient,
  type QdrantClientLike,
  QdrantCollectionService,
  type QdrantFilter,
  QdrantVectorIndex,
  type SparseVector,
  buildStableQdrantPointId,
} from "@cube-ai/vector-qdrant";

import {
  buildDocumentAccessQdrantMustClauses,
  type DocumentMetadataFilters,
  type KbAclIdentity,
} from "../../access/document-access-filter";
import { APP_CONFIG_TOKEN, type AppConfig } from "@/config/app.config";

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
  chunkRole?: string | null;
  qualityScore?: number | null;
  qualityReasons?: string[] | null;
  retrievableByDefault?: boolean | null;
  /** W4.1 document metadata + ACL (written on upsert; filtered on search) */
  docType?: string | null;
  lang?: string | null;
  tags?: string[] | null;
  aclGroupIds?: string[] | null;
  createdAt?: string | null;
  /** W3.1 versioned rebuild generation. Missing means legacy data. */
  generationId?: string;
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
  /** Server-resolved ACL identity; never from client filter body. */
  identity?: KbAclIdentity | null;
  allowedGroupIds?: readonly string[];
  filters?: DocumentMetadataFilters | null;
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
    if (isGlobalAccessEnabled()) {
      return null;
    }
    return currentTenantId();
  }

  private buildSearchFilter(params: QdrantVectorRepositorySearchParams): QdrantFilter | undefined {
    const scopedTenantId = this.getScopedTenantIdForFilter();
    const should: { key: string; match: { value: string | number } }[] = [];
    if (params.documentId !== undefined) {
      const documentId = String(params.documentId).trim();
      should.push({ key: "documentId", match: { value: documentId } });
      if (/^\d+$/u.test(documentId)) {
        should.push({ key: "documentId", match: { value: Number(documentId) } });
      }
    }
    for (const documentId of params.documentIds ?? []) {
      const normalized = String(documentId).trim();
      should.push({ key: "documentId", match: { value: normalized } });
      if (/^\d+$/u.test(normalized)) {
        should.push({ key: "documentId", match: { value: Number(normalized) } });
      }
    }

    const must: unknown[] = [];
    if (scopedTenantId !== null) {
      must.push({ key: "tenantId", match: { value: scopedTenantId } });
    }
    must.push(
      ...buildDocumentAccessQdrantMustClauses({
        allowedGroupIds: params.allowedGroupIds,
        filters: params.filters,
        identity: params.identity,
      }),
    );

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

  private buildDeleteFilter(documentId: string, generationId?: string): QdrantFilter {
    const scopedTenantId = this.getScopedTenantIdForFilter();
    const must: { key: string; match: { value: string } }[] = [
      {
        key: "documentId",
        match: { value: documentId },
      },
    ];
    if (scopedTenantId !== null) {
      must.push({ key: "tenantId", match: { value: scopedTenantId } });
    }
    if (generationId !== undefined) {
      must.push({ key: "generationId", match: { value: generationId } });
    }
    return { must };
  }

  public async ensureCollection(): Promise<void> {
    await this.vectorIndex.ensureCollection({
      collectionName: this.config.qdrantCollectionName,
      dense: { size: this.config.qdrantVectorSize },
      payloadIndexes: {
        aclGroupIds: "keyword",
        chunkId: "keyword",
        createdAt: "datetime",
        docType: "keyword",
        documentId: "keyword",
        generationId: "keyword",
        lang: "keyword",
        tags: "keyword",
        tenantId: "keyword",
      },
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
        payload: { ...point.payload, tenantId: scopedTenantId } as Record<string, unknown>,
        vectors: point.vectors,
      })),
    );
  }

  public async search(params: QdrantVectorRepositorySearchParams): Promise<QdrantSearchResult[]> {
    await this.ensureCollection();
    const hits = await this.vectorIndex.query({
      collectionName: this.config.qdrantCollectionName,
      dense: params.denseVector,
      filter: this.buildSearchFilter(params),
      fusion: "rrf",
      scoreThreshold: params.scoreThreshold,
      sparse: params.sparseVector,
      topK: params.topK,
    });
    return hits.map((item) => ({
      id: item.id,
      payload: item.payload as QdrantPointPayload,
      score: item.score,
    }));
  }

  public async deleteByDocument(documentId: string): Promise<void> {
    await this.vectorIndex.delete(this.config.qdrantCollectionName, this.buildDeleteFilter(documentId));
  }

  public async deleteByDocumentGeneration(documentId: string, generationId: string): Promise<void> {
    await this.vectorIndex.delete(this.config.qdrantCollectionName, this.buildDeleteFilter(documentId, generationId));
  }

  /** Scroll all point ids for a document (reconcile / dual-write diff). */
  public async listPointIdsByDocument(documentId: string): Promise<string[]> {
    return this.vectorIndex.scrollPointIds(this.config.qdrantCollectionName, this.buildDeleteFilter(documentId));
  }

  public async listPointIdsByDocumentGeneration(documentId: string, generationId: string): Promise<string[]> {
    return this.vectorIndex.scrollPointIds(this.config.qdrantCollectionName, this.buildDeleteFilter(documentId, generationId));
  }

  public async deleteByPointIds(pointIds: string[]): Promise<void> {
    await this.vectorIndex.deleteByPointIds(this.config.qdrantCollectionName, pointIds);
  }

  public async getVectorsByPointIds(pointIds: string[]): Promise<Map<string, QdrantUpsertPoint["vectors"]>> {
    const points = await this.vectorIndex.retrieveByPointIds(this.config.qdrantCollectionName, pointIds);
    return new Map(points.map((point) => [point.id, point.vectors]));
  }
}
