import { Inject, Injectable } from "@dangao/bun-server";

import type { RerankPort } from "@cube-ai/contracts/platform";

import { APP_CONFIG_TOKEN, type AppConfig } from "../../../config/app.config";
import { runKbUpstreamStep } from "../../../infrastructure/upstream-error";
import {
  DOCUMENT_PLATFORM_SYNC_PORT_TOKEN,
  type DocumentPlatformSyncPort,
  type PlatformDocumentSyncContext,
} from "../../../port/document-platform-sync.port";
import { chunkQualityPolicyFromConfig, isRetrievableChunk } from "../../common/chunk-quality";
import { type ChunkType, type RetrievalProfile, type SearchItem } from "../../common/document-types";
import { DocumentRepositoryOrm } from "../../documents/infrastructure/orm/document.repository";
import type { DocumentMetadataFilters, KbAclIdentity } from "../access/document-access-filter";
import {
  EmbeddingProvider,
  type EmbeddingProvider as EmbeddingProviderContract,
  type EmbeddingVector,
} from "../infrastructure/embeddings/embedding-provider";
import { resolveChunkRetrievalProfile, resolveQueryRetrievalProfile } from "../infrastructure/embeddings/retrieval-profile";
import { DocumentChunkRepositoryOrm } from "../infrastructure/qdrant/document-chunk.repository";
import { QdrantVectorRepository } from "../infrastructure/qdrant/qdrant-vector.repository";
import { isKeywordLikeQuery } from "./keyword-like-query";
import { allocateMultiDocumentRerankBudget, modelRerankOnce } from "./model-rerank";
import { recordModelRerankAttempt, recordModelRerankFallback, recordModelRerankSuccess } from "./retrieval-operational-metrics";
import { selectRetrievalQualityCandidates } from "./retrieval-quality-selection";

export { allocateMultiDocumentRerankBudget, modelRerankOnce, rerankDisplayText, clampRerankScore } from "./model-rerank";
export { isKeywordLikeQuery } from "./keyword-like-query";
export type { DocumentMetadataFilters, KbAclIdentity } from "../access/document-access-filter";

export interface RetrievalSearchParams {
  query: string;
  topK: number;
  documentId?: string;
  /**
   * 可选，[0,1]。与响应中 `score` 同源（绝对相关度，clamp 到 [0,1] 后比较）。
   * 仅保留 **score > similarityThreshold** 的分段。
   * 未传时使用 `retrievalDefaultSimilarityThreshold`；显式传 ≤0 表示关闭该层过滤。
   */
  similarityThreshold?: number;
  /** Server-injected identity for ACL; never trust client `allowedGroupIds`. */
  identity?: KbAclIdentity | null;
  /** Optional metadata AND filters (docType / lang / tags). */
  filters?: DocumentMetadataFilters | null;
}

/** 多文档检索：每个文档独立的 topK 与 similarityThreshold。 */
export interface RetrievalMultiDocumentSpec {
  documentId: string;
  /** 未传时与单文档检索一致，默认 5 */
  topK?: number;
  similarityThreshold?: number;
}

export interface RetrievalMultiDocumentSearchParams {
  query: string;
  documents: RetrievalMultiDocumentSpec[];
  platformSync?: PlatformDocumentSyncContext;
  identity?: KbAclIdentity | null;
  filters?: DocumentMetadataFilters | null;
}

export interface RetrievalDirectorySearchParams {
  query: string;
  topK: number;
  directoryId: string;
  similarityThreshold?: number;
  identity?: KbAclIdentity | null;
  filters?: DocumentMetadataFilters | null;
}

export interface RetrievalSearchResult {
  items: SearchItem[];
  /**
   * Optional correlation id echoed from the HTTP/search caller (W4.2-H3).
   * Same field name as KnowledgeQueryRequest.traceId / feedback.traceId.
   */
  traceId?: string;
}

type VectorSearchResult = Awaited<ReturnType<QdrantVectorRepository["search"]>>[number];

type RankedSearchResult = VectorSearchResult & {
  rankScore: number;
  lexicalScore: number;
  modelRerankScore?: number;
};

type ModelRerankRoute = "/kb/search" | "/kb/search/by-directory" | "/kb/search/by-documents";

function isErrorWithCode(value: unknown): value is { code: string } {
  return typeof value === "object" && value !== null && "code" in value && typeof value.code === "string";
}

function elapsedMs(startedAt: number): number {
  return Number(Math.max(0, performance.now() - startedAt).toFixed(3));
}

type SectionChunkRows = Awaited<ReturnType<DocumentChunkRepositoryOrm["findByDocumentIdAndSectionId"]>>;
type LexicalChunkRows = Awaited<ReturnType<DocumentChunkRepositoryOrm["searchLexicalChunks"]>>;

const HEADING_EXACT_BOOST = 0.35;
const HEADING_TERM_BOOST = 0.12;
const TEXT_EXACT_BOOST = 0.2;
const TEXT_TERM_BOOST = 0.06;
const LEXICAL_SCORE_WEIGHT = 0.08;
const TABLE_EXACT_BOOST = 0.35;
const TABLE_TERM_BOOST = 0.12;
const TIMECODE_BOOST = 0.18;
const PROPERTY_NAMESPACE_BOOST = 0.18;
const MAX_TERM_BOOSTS = 3;
const CONTEXT_AGGREGATED_CHUNK_TYPES: ChunkType[] = ["paragraph", "list", "text"];
const ENTITY_LOOKUP_EXACT_BOOST = 0.28;
const ENTITY_LOOKUP_TERM_BOOST = 0.14;
const NAVIGATION_HEADING_BOOST = 0.22;

@Injectable()
export class RetrievalService {
  public constructor(
    @Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig,
    @Inject(EmbeddingProvider) private readonly embeddingProvider: EmbeddingProviderContract,
    private readonly qdrantVectorRepository: QdrantVectorRepository,
    private readonly documentRepository: DocumentRepositoryOrm,
    private readonly documentChunkRepository: DocumentChunkRepositoryOrm,
    @Inject(DOCUMENT_PLATFORM_SYNC_PORT_TOKEN)
    private readonly documentPlatformSync?: DocumentPlatformSyncPort,
    private readonly rerankPort?: RerankPort,
  ) {}

  private resolveRerankTenant(): number {
    // Model catalog access is a service-level concern, matching KB embedding.
    // Request tenant context continues to scope KB data, but must not select model credentials.
    const raw = Bun.env.KB_EMBEDDING_TENANT ?? process.env.KB_EMBEDDING_TENANT ?? "1";
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
  }

  private resolveRerankModelCode(): string {
    const configured = this.config.retrievalRerankModel.trim();
    return configured !== "" ? configured : "qwen3-rerank";
  }

  private normalizeQuery(query: string, maxQueryLength: number): string {
    return query.replaceAll(/\s+/gu, " ").trim().slice(0, maxQueryLength);
  }

  private parseHeadingPath(raw: string | string[] | undefined): string[] {
    if (Array.isArray(raw)) {
      return raw.filter((item): item is string => typeof item === "string");
    }
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  private normalizeForMatch(value: string): string {
    return value
      .normalize("NFKC")
      .toLowerCase()
      .replaceAll(/[^\p{Letter}\p{Number}\s]+/gu, " ")
      .replaceAll(/\s+/gu, " ")
      .trim();
  }

  private buildQueryTerms(query: string): string[] {
    const normalized = this.normalizeForMatch(query);
    if (normalized === "") {
      return [];
    }

    const terms = new Set<string>([normalized]);
    for (const token of normalized.split(" ")) {
      if (token !== "") {
        terms.add(token);
      }
    }

    if (!normalized.includes(" ") && normalized.length >= 4) {
      for (let index = 0; index <= normalized.length - 2; index += 1) {
        terms.add(normalized.slice(index, index + 2));
      }
    }

    return Array.from(terms).filter((term) => term !== "");
  }

  private buildLexicalTerms(query: string): string[] {
    const trimmed = query.trim();
    if (trimmed === "") {
      return [];
    }
    const terms = new Set<string>([trimmed]);
    const normalized = trimmed.replaceAll(/([a-z])([A-Z])/gu, "$1 $2");
    for (const token of normalized.split(/[\s/_.:-]+/u)) {
      if (token !== "") {
        terms.add(token);
      }
    }
    if (!trimmed.includes(" ") && trimmed.length >= 4 && trimmed.length <= 24) {
      for (let index = 0; index <= trimmed.length - 2; index += 1) {
        terms.add(trimmed.slice(index, index + 2));
      }
    }
    return Array.from(terms);
  }

  private parseStringArray(raw: unknown): string[] {
    if (Array.isArray(raw)) {
      return raw.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    }
    if (typeof raw !== "string" || raw.trim() === "") {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
    } catch {
      return raw.split(/\s*,\s*/u).filter((item) => item.trim() !== "");
    }
  }

  private normalizeDocumentId(documentId: unknown): string {
    return String(documentId ?? "").trim();
  }

  private documentIdsMatch(payloadDocumentId: unknown, expectedDocumentId: string): boolean {
    return this.normalizeDocumentId(payloadDocumentId) === this.normalizeDocumentId(expectedDocumentId);
  }

  private clampScoreToUnitInterval(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    if (value <= 0) {
      return 0;
    }
    if (value >= 1) {
      return 1;
    }
    return Number(value.toFixed(6));
  }

  /**
   * 检索侧质量策略：优先用 payload 中持久化的 role/score；
   * 否则现场评估。封面/目录默认不召回，noise/占位符不返回。
   */
  private filterLowQualityChunks(ranked: RankedSearchResult[]): RankedSearchResult[] {
    const policy = chunkQualityPolicyFromConfig(this.config);
    return ranked.filter((result) => {
      const payload = result.payload;
      return isRetrievableChunk(
        {
          chunkRole: typeof payload.chunkRole === "string" ? payload.chunkRole : null,
          chunkType: typeof payload.chunkType === "string" ? payload.chunkType : null,
          embeddingText: typeof payload.embeddingText === "string" ? payload.embeddingText : null,
          headingPath: Array.isArray(payload.headingPath) ? payload.headingPath : null,
          pageNo: typeof payload.pageNo === "number" ? payload.pageNo : null,
          qualityScore: typeof payload.qualityScore === "number" ? payload.qualityScore : null,
          retrievableByDefault: typeof payload.retrievableByDefault === "boolean" ? payload.retrievableByDefault : null,
          sectionId: typeof payload.sectionId === "string" ? payload.sectionId : null,
          text: String(payload.text ?? ""),
        },
        policy,
      );
    });
  }

  private chunkMatchesKeywordQuery(result: RankedSearchResult, query: string): boolean {
    const haystack = this.normalizeForMatch(
      [
        this.parseHeadingPath(result.payload.headingPath).join(" "),
        String(result.payload.text ?? ""),
        this.parseStringArray(result.payload.headers).join(" "),
        this.parseStringArray(result.payload.keywords).join(" "),
      ].join(" "),
    );
    if (haystack === "") {
      return false;
    }
    const full = this.normalizeForMatch(query);
    if (full !== "" && haystack.includes(full)) {
      return true;
    }
    const terms = this.buildQueryTerms(query).filter((term) => term.length >= 2);
    return terms.some((term) => haystack.includes(term));
  }

  private filterKeywordTermMatch(ranked: RankedSearchResult[], query: string): RankedSearchResult[] {
    if (!isKeywordLikeQuery(query)) {
      return ranked;
    }
    return ranked.filter((result) => this.chunkMatchesKeywordQuery(result, query));
  }

  /** KB receives an already-searchable query; conversational rewriting belongs to the Agent. */
  private async recallForQuery(params: {
    normalizedQuery: string;
    prefetchTopK: number;
    documentId?: string;
    identity?: KbAclIdentity | null;
    filters?: DocumentMetadataFilters | null;
  }): Promise<RankedSearchResult[]> {
    const query = params.normalizedQuery;
    const access = { filters: params.filters, identity: params.identity };
    const queryProfile = resolveQueryRetrievalProfile(query);
    const [queryVector] = await this.embeddingProvider.embed([query], "query", [{ retrievalProfile: queryProfile }]);
    if (!queryVector || queryVector.dense.length === 0) {
      return [];
    }
    if (params.documentId) {
      return this.recallAndRankForDocument(query, query, queryVector, {
        documentId: params.documentId,
        prefetchTopK: params.prefetchTopK,
        ...access,
      });
    }
    return this.recallAndRankGlobal(query, query, queryVector, params.prefetchTopK, access);
  }

  private resolvePayloadRetrievalProfile(payload: VectorSearchResult["payload"]): RetrievalProfile {
    if (typeof payload.retrievalProfile === "string") {
      return payload.retrievalProfile as RetrievalProfile;
    }

    return resolveChunkRetrievalProfile({
      chunkType: typeof payload.chunkType === "string" ? (payload.chunkType as ChunkType) : "text",
      headingPath: this.parseHeadingPath(payload.headingPath),
      sourceType: typeof payload.sourceType === "string" ? payload.sourceType : "",
      text: typeof payload.text === "string" ? payload.text : "",
    });
  }

  private buildSearchPayloadFromLexicalRow(row: LexicalChunkRows[number]): VectorSearchResult {
    return {
      id: String(row.qdrant_point_id ?? row.chunk_id),
      payload: {
        captionText: row.caption_text ?? null,
        chunkId: row.chunk_id,
        chunkIndex: row.chunk_index,
        chunkType: row.chunk_type,
        cueIndex: row.cue_index ?? null,
        documentId: row.document_id,
        embeddingText: row.embedding_text,
        endTime: row.end_time ?? null,
        fileName: row.file_name ?? "",
        headers: this.parseStringArray(row.headers_text),
        headingPath: this.parseHeadingPath(row.heading_path),
        keywords: this.parseStringArray(row.keywords_text),
        orderInSection: row.order_in_section,
        pageNo: row.page_no,
        pictureDescription: row.picture_description ?? null,
        propertyNamespace: row.property_namespace ?? null,
        retrievalProfile: resolveChunkRetrievalProfile({
          chunkType: row.chunk_type as ChunkType,
          sourceType: row.source_type ?? "",
          headingPath: this.parseHeadingPath(row.heading_path),
          text: row.text_content,
        }),
        rowEnd: row.row_end ?? null,
        rowStart: row.row_start ?? null,
        sectionId: row.section_id,
        sheetName: row.sheet_name ?? null,
        sourceType: row.source_type ?? "",
        startTime: row.start_time ?? null,
        tableId: row.table_id ?? null,
        text: row.text_content,
      },
      score: 0,
    };
  }

  private mergeRecallResults(
    vectorResults: Awaited<ReturnType<QdrantVectorRepository["search"]>>,
    lexicalRows: LexicalChunkRows,
  ): (VectorSearchResult & { lexicalScore: number })[] {
    const merged = new Map<string, VectorSearchResult & { lexicalScore: number }>();

    for (const result of vectorResults) {
      merged.set(result.payload.chunkId, {
        ...result,
        lexicalScore: 0,
      });
    }

    for (const row of lexicalRows) {
      const lexicalScore = typeof row.lexical_score === "number" ? row.lexical_score : 0;
      const existing = merged.get(row.chunk_id);
      if (existing) {
        existing.lexicalScore = Math.max(existing.lexicalScore, lexicalScore);
        continue;
      }
      const result = this.buildSearchPayloadFromLexicalRow(row);
      merged.set(result.payload.chunkId, {
        ...result,
        lexicalScore,
      });
    }

    return Array.from(merged.values());
  }

  private calculateRankScore(result: VectorSearchResult & { lexicalScore?: number }, query: string, rerankEnabled: boolean): number {
    if (!rerankEnabled) {
      return Number((result.score + (result.lexicalScore ?? 0) * LEXICAL_SCORE_WEIGHT).toFixed(6));
    }

    const normalizedQuery = this.normalizeForMatch(query);
    const headingText = this.normalizeForMatch(this.parseHeadingPath(result.payload.headingPath).join(" "));
    const bodyText = this.normalizeForMatch(result.payload.text);
    const queryTerms = this.buildQueryTerms(query);
    const headersText = this.normalizeForMatch(this.parseStringArray(result.payload.headers).join(" "));
    const keywordsText = this.normalizeForMatch(this.parseStringArray(result.payload.keywords).join(" "));
    const propertyNamespace = this.normalizeForMatch(String(result.payload.propertyNamespace ?? ""));
    const timeText = this.normalizeForMatch([result.payload.startTime, result.payload.endTime].filter(Boolean).join(" "));
    const retrievalProfile = this.resolvePayloadRetrievalProfile(result.payload);

    let rankScore = result.score + (result.lexicalScore ?? 0) * LEXICAL_SCORE_WEIGHT;
    if (normalizedQuery !== "" && headingText.includes(normalizedQuery)) {
      rankScore += HEADING_EXACT_BOOST;
    }
    if (normalizedQuery !== "" && bodyText.includes(normalizedQuery)) {
      rankScore += TEXT_EXACT_BOOST;
    }

    const matchedHeadingTerms = queryTerms.filter((term) => term.length >= 2 && headingText.includes(term)).slice(0, MAX_TERM_BOOSTS);
    const matchedBodyTerms = queryTerms.filter((term) => term.length >= 2 && bodyText.includes(term)).slice(0, MAX_TERM_BOOSTS);

    rankScore += matchedHeadingTerms.length * HEADING_TERM_BOOST;
    rankScore += matchedBodyTerms.length * TEXT_TERM_BOOST;

    const matchedHeaderTerms = queryTerms.filter((term) => term.length >= 2 && headersText.includes(term)).slice(0, MAX_TERM_BOOSTS);
    const matchedKeywordTerms = queryTerms.filter((term) => term.length >= 2 && keywordsText.includes(term)).slice(0, MAX_TERM_BOOSTS);

    if (result.payload.chunkType === "table-row-window") {
      if (normalizedQuery !== "" && (headersText.includes(normalizedQuery) || keywordsText.includes(normalizedQuery))) {
        rankScore += TABLE_EXACT_BOOST;
      }
      rankScore += (matchedHeaderTerms.length + matchedKeywordTerms.length) * TABLE_TERM_BOOST;
    }

    if (retrievalProfile === "entity-lookup") {
      if (normalizedQuery !== "" && (bodyText.includes(normalizedQuery) || keywordsText.includes(normalizedQuery))) {
        rankScore += ENTITY_LOOKUP_EXACT_BOOST;
      }
      rankScore += matchedKeywordTerms.length * ENTITY_LOOKUP_TERM_BOOST;
    }

    if (retrievalProfile === "navigation") {
      if (normalizedQuery !== "" && headingText.includes(normalizedQuery)) {
        rankScore += NAVIGATION_HEADING_BOOST;
      }
      rankScore += matchedHeadingTerms.length * (HEADING_TERM_BOOST / 2);
    }

    if (result.payload.chunkType === "vtt-cue-window" && normalizedQuery !== "" && timeText.includes(normalizedQuery)) {
      rankScore += TIMECODE_BOOST;
    }

    if (result.payload.chunkType === "properties-group" && normalizedQuery !== "" && propertyNamespace.includes(normalizedQuery)) {
      rankScore += PROPERTY_NAMESPACE_BOOST;
    }

    return Number(rankScore.toFixed(6));
  }

  private async rankResults(
    results: (VectorSearchResult & { lexicalScore: number })[],
    query: string,
    rerankEnabled: boolean,
  ): Promise<RankedSearchResult[]> {
    return results
      .map((result) => ({
        ...result,
        lexicalScore: result.lexicalScore,
        rankScore: this.calculateRankScore(result, query, rerankEnabled),
      }))
      .toSorted((left, right) => right.rankScore - left.rankScore || right.score - left.score);
  }

  private async buildSearchItem(
    result: RankedSearchResult,
    sectionChunksCache: Map<string, Promise<SectionChunkRows>>,
  ): Promise<SearchItem> {
    const payload = result.payload;
    const sectionCacheKey = `${payload.documentId}:${payload.sectionId}`;
    const sectionChunks = payload.sectionId
      ? await (sectionChunksCache.get(sectionCacheKey) ??
          (() => {
            const promise = this.documentChunkRepository.findByDocumentIdAndSectionId(payload.documentId, payload.sectionId);
            sectionChunksCache.set(sectionCacheKey, promise);
            return promise;
          })())
      : [];
    const windowStart = typeof payload.orderInSection === "number" ? payload.orderInSection - 1 : Number.NEGATIVE_INFINITY;
    const windowEnd = typeof payload.orderInSection === "number" ? payload.orderInSection + 1 : Number.POSITIVE_INFINITY;
    const windowedChunks = sectionChunks.filter((chunk) => {
      const order = typeof chunk.order_in_section === "number" ? chunk.order_in_section : chunk.chunk_index;
      return order >= windowStart && order <= windowEnd;
    });
    const shouldAggregateContext =
      typeof payload.chunkType === "string" && CONTEXT_AGGREGATED_CHUNK_TYPES.includes(payload.chunkType as ChunkType);
    const aggregatedText =
      shouldAggregateContext && sectionChunks.length > 0
        ? (windowedChunks.length > 0 ? windowedChunks : sectionChunks)
            .map((chunk) => chunk.text_content)
            .filter((text) => typeof text === "string" && text.trim() !== "")
            .join("\n\n")
        : payload.text;

    return {
      chunkId: payload.chunkId,
      chunkIndex: payload.chunkIndex,
      chunkType: typeof payload.chunkType === "string" ? (payload.chunkType as ChunkType) : undefined,
      cueIndex: typeof payload.cueIndex === "number" ? payload.cueIndex : null,
      documentId: this.normalizeDocumentId(payload.documentId),
      endTime: typeof payload.endTime === "string" ? payload.endTime : null,
      fileName: payload.fileName,
      headers: this.parseStringArray(payload.headers),
      headingPath: this.parseHeadingPath(payload.headingPath),
      keywords: this.parseStringArray(payload.keywords),
      pageNo: payload.pageNo,
      propertyNamespace: typeof payload.propertyNamespace === "string" ? payload.propertyNamespace : null,
      rankScore: this.clampScoreToUnitInterval(result.rankScore),
      retrievalProfile: this.resolvePayloadRetrievalProfile(payload),
      rowEnd: typeof payload.rowEnd === "number" ? payload.rowEnd : null,
      rowStart: typeof payload.rowStart === "number" ? payload.rowStart : null,
      score: this.clampScoreToUnitInterval(result.rankScore),
      sectionId: payload.sectionId,
      sheetName: typeof payload.sheetName === "string" ? payload.sheetName : null,
      sourceType: payload.sourceType,
      startTime: typeof payload.startTime === "string" ? payload.startTime : null,
      tableId: typeof payload.tableId === "string" ? payload.tableId : null,
      text: aggregatedText,
      vectorScore: result.score,
    };
  }

  private async recordRecallCounts(items: SearchItem[]): Promise<void> {
    if (typeof (this.documentRepository as unknown as { incrementRecallCount?: unknown }).incrementRecallCount !== "function") {
      return;
    }
    const deltas = new Map<string, number>();
    for (const item of items) {
      const key = item.documentId;
      deltas.set(key, (deltas.get(key) ?? 0) + 1);
    }
    await this.documentRepository.incrementRecallCount(deltas);
  }

  private async recordChunkRecallCounts(items: SearchItem[]): Promise<void> {
    if (
      typeof (this.documentChunkRepository as unknown as { incrementChunkRecallCount?: unknown }).incrementChunkRecallCount !== "function"
    ) {
      return;
    }
    const deltas = new Map<string, number>();
    for (const item of items) {
      const key = `${item.documentId}\u0001${item.chunkId}`;
      deltas.set(key, (deltas.get(key) ?? 0) + 1);
    }
    await this.documentChunkRepository.incrementChunkRecallCount(deltas);
  }

  private accessSearchArgs(params: { identity?: KbAclIdentity | null; filters?: DocumentMetadataFilters | null }): {
    identity?: KbAclIdentity | null;
    filters?: DocumentMetadataFilters | null;
  } {
    return {
      ...(params.identity !== undefined ? { identity: params.identity } : {}),
      ...(params.filters !== undefined ? { filters: params.filters } : {}),
    };
  }

  /**
   * Qdrant cannot join document_record.active_generation_id. Validate every
   * vector hit against MySQL so staging/obsolete generations are never visible.
   */
  private async filterActiveVectorGeneration(results: VectorSearchResult[]): Promise<VectorSearchResult[]> {
    if (
      typeof (this.documentChunkRepository as unknown as { findActiveChunkReferenceKeys?: unknown }).findActiveChunkReferenceKeys !==
      "function"
    ) {
      return results;
    }
    const refs = results.map((result) => ({
      chunkId: String(result.payload.chunkId ?? ""),
      documentId: this.normalizeDocumentId(result.payload.documentId),
      generationId: typeof result.payload.generationId === "string" ? result.payload.generationId : "legacy",
    }));
    const active = await this.documentChunkRepository.findActiveChunkReferenceKeys(refs);
    return results.filter((result) => {
      const generationId = typeof result.payload.generationId === "string" ? result.payload.generationId : "legacy";
      const key = `${this.normalizeDocumentId(result.payload.documentId)}\u0001${String(result.payload.chunkId ?? "")}\u0001${generationId}`;
      return active.has(key);
    });
  }

  private vectorRecallTopK(topK: number): number {
    const supportsGenerationValidation =
      typeof (this.documentChunkRepository as unknown as { findActiveChunkReferenceKeys?: unknown }).findActiveChunkReferenceKeys ===
      "function";
    return supportsGenerationValidation ? topK * 2 : topK;
  }

  /** 全库（或当前 project）向量+词法召回与排序，不截断 topK。 */
  private async recallAndRankGlobal(
    normalizedQuery: string,
    rawQuery: string,
    queryVector: EmbeddingVector,
    prefetchTopK: number,
    access?: { identity?: KbAclIdentity | null; filters?: DocumentMetadataFilters | null },
  ): Promise<RankedSearchResult[]> {
    const config = this.config;
    const accessArgs = this.accessSearchArgs(access ?? {});
    const rawResults = await this.qdrantVectorRepository.search({
      denseVector: queryVector.dense,
      scoreThreshold: config.retrievalScoreThreshold > 0 ? config.retrievalScoreThreshold : undefined,
      sparseVector: queryVector.sparse,
      topK: this.vectorRecallTopK(prefetchTopK),
      ...accessArgs,
    });
    const results = (await this.filterActiveVectorGeneration(rawResults)).slice(0, prefetchTopK);
    const lexicalRows = await this.documentChunkRepository.searchLexicalChunks({
      query: normalizedQuery,
      terms: this.buildLexicalTerms(rawQuery),
      topK: prefetchTopK,
      ...accessArgs,
    });
    const mergedResults = this.mergeRecallResults(results, lexicalRows);
    return this.rankResults(mergedResults, normalizedQuery, config.retrievalRerankEnabled);
  }

  /**
   * 单文档向量+词法召回与排序（不截断 topK、不写召回计数），供 search / searchByDocuments / searchByDirectory 复用。
   */
  private async recallAndRankForDocument(
    normalizedQuery: string,
    rawQuery: string,
    queryVector: EmbeddingVector,
    params: {
      prefetchTopK: number;
      documentId: string;
      identity?: KbAclIdentity | null;
      filters?: DocumentMetadataFilters | null;
    },
  ): Promise<RankedSearchResult[]> {
    const config = this.config;
    const accessArgs = this.accessSearchArgs(params);
    const rawResults = await this.qdrantVectorRepository.search({
      denseVector: queryVector.dense,
      documentId: params.documentId,
      scoreThreshold: config.retrievalScoreThreshold > 0 ? config.retrievalScoreThreshold : undefined,
      sparseVector: queryVector.sparse,
      topK: this.vectorRecallTopK(params.prefetchTopK),
      ...accessArgs,
    });
    const results = (await this.filterActiveVectorGeneration(rawResults)).slice(0, params.prefetchTopK);
    const lexicalRows = await this.documentChunkRepository.searchLexicalChunks({
      documentId: params.documentId,
      query: normalizedQuery,
      terms: this.buildLexicalTerms(rawQuery),
      topK: params.prefetchTopK,
      ...accessArgs,
    });
    const mergedResults = this.mergeRecallResults(results, lexicalRows).filter((result) =>
      this.documentIdsMatch(result.payload.documentId, params.documentId),
    );
    return this.rankResults(mergedResults, normalizedQuery, config.retrievalRerankEnabled);
  }

  /**
   * quality / keyword filters after recall+rule pre-rank (pipeline stage before model rerank).
   */
  private prepareCandidatesForRerank(ranked: RankedSearchResult[], query: string): RankedSearchResult[] {
    const qualityFiltered = this.filterLowQualityChunks(ranked);
    return this.filterKeywordTermMatch(qualityFiltered, query);
  }

  private async loadDenseVectorsForDiversification(ranked: readonly RankedSearchResult[]): Promise<Map<string, readonly number[]>> {
    if (!this.config.retrievalDiversificationEnabled || ranked.length < 2) {
      return new Map();
    }
    const repository = this.qdrantVectorRepository as Partial<Pick<QdrantVectorRepository, "getVectorsByPointIds">>;
    if (typeof repository.getVectorsByPointIds !== "function") {
      return new Map();
    }
    try {
      const vectors = await repository.getVectorsByPointIds.call(
        this.qdrantVectorRepository,
        ranked.map((candidate) => String(candidate.id)),
      );
      return new Map([...vectors].map(([id, vector]) => [id, vector.dense]));
    } catch (error) {
      console.warn(
        JSON.stringify({
          candidateCount: ranked.length,
          errorCode: isErrorWithCode(error) ? error.code : undefined,
          errorName: error instanceof Error ? error.name : typeof error,
          event: "fallback",
          ns: "kb.retrieval.diversification",
          reason: "vector-retrieve-failed",
        }),
      );
      return new Map();
    }
  }

  /** Independent score floor + exact/dedupe/section/MMR + dynamic TopK. */
  private async applyThresholdAndTopK(
    ranked: RankedSearchResult[],
    params: { query: string; topK: number; similarityThreshold?: number },
  ): Promise<RankedSearchResult[]> {
    const denseVectors = await this.loadDenseVectorsForDiversification(ranked);
    return selectRetrievalQualityCandidates(ranked, {
      denseVectors,
      diversificationEnabled: this.config.retrievalDiversificationEnabled,
      exactMatchReserve: this.config.retrievalExactMatchReserve,
      fallbackSimilarityThreshold: this.config.retrievalDefaultSimilarityThreshold,
      maxChunksPerSection: this.config.retrievalMaxChunksPerSection,
      mmrLambda: this.config.retrievalMmrLambda,
      query: params.query,
      requestedSimilarityThreshold: params.similarityThreshold,
      rerankMinScore: this.config.retrievalRerankMinScore,
      topK: params.topK,
    });
  }

  /**
   * Explicit pipeline stage: merged vector/lexical recall → modelRerankOnce (at most once).
   * On RerankPort failure: keep rule order; never empty when candidates exist (W2.2-H2).
   */
  private async modelRerankOnceStage(
    candidates: RankedSearchResult[],
    query: string,
    route: ModelRerankRoute = "/kb/search",
  ): Promise<RankedSearchResult[]> {
    const modelCode = this.resolveRerankModelCode();
    const tenant = this.resolveRerankTenant();
    const logContext = {
      candidateCount: candidates.length,
      inputCount: Math.min(candidates.length, this.config.retrievalRerankInputTopN),
      modelCode,
      route,
      tenant,
    };

    if (!this.config.retrievalModelRerankEnabled) {
      if (route === "/kb/search/by-documents") {
        console.info(JSON.stringify({ ...logContext, event: "skipped", ns: "kb.retrieval.model-rerank", reason: "disabled" }));
      }
      return candidates;
    }
    if (!this.rerankPort) {
      if (route === "/kb/search/by-documents") {
        console.warn(JSON.stringify({ ...logContext, event: "skipped", ns: "kb.retrieval.model-rerank", reason: "provider-unavailable" }));
      }
      return candidates;
    }
    if (candidates.length === 0) {
      if (route === "/kb/search/by-documents") {
        console.info(JSON.stringify({ ...logContext, event: "skipped", ns: "kb.retrieval.model-rerank", reason: "no-candidates" }));
      }
      return candidates;
    }

    const startedAt = recordModelRerankAttempt();
    console.info(JSON.stringify({ ...logContext, event: "started", ns: "kb.retrieval.model-rerank" }));
    try {
      const reranked = await modelRerankOnce({
        candidates,
        inputTopN: this.config.retrievalRerankInputTopN,
        modelCode,
        query,
        rerankPort: this.rerankPort,
        tenant,
      });
      recordModelRerankSuccess(startedAt);
      console.info(
        JSON.stringify({
          ...logContext,
          durationMs: elapsedMs(startedAt),
          event: "succeeded",
          ns: "kb.retrieval.model-rerank",
          resultCount: reranked.length,
        }),
      );
      return reranked;
    } catch (error) {
      recordModelRerankFallback(startedAt);
      console.warn(
        JSON.stringify({
          ...logContext,
          durationMs: elapsedMs(startedAt),
          errorCode: isErrorWithCode(error) ? error.code : undefined,
          errorName: error instanceof Error ? error.name : typeof error,
          event: "fallback",
          ns: "kb.retrieval.model-rerank",
        }),
      );
      return candidates;
    }
  }

  /**
   * recall* → prepare → modelRerankOnce → applyThresholdAndTopK (global / single-doc / by-directory).
   */
  private async finalizeWithOptionalModelRerank(
    ranked: RankedSearchResult[],
    params: { topK: number; query: string; route?: ModelRerankRoute; similarityThreshold?: number },
  ): Promise<RankedSearchResult[]> {
    const prepared = this.prepareCandidatesForRerank(ranked, params.query);
    const reranked = await this.modelRerankOnceStage(prepared, params.query, params.route);
    return this.applyThresholdAndTopK(reranked, {
      query: params.query,
      similarityThreshold: params.similarityThreshold,
      topK: params.topK,
    });
  }

  public async search(params: RetrievalSearchParams): Promise<RetrievalSearchResult> {
    const config = this.config;
    const normalizedQuery = this.normalizeQuery(params.query, config.retrievalMaxQueryLength);
    if (normalizedQuery === "") {
      return { items: [] };
    }
    const prefetchTopK = Math.max(params.topK, params.topK * 3, config.retrievalPrefetchTopK);
    const ranked = await this.recallForQuery({
      documentId: params.documentId,
      filters: params.filters,
      identity: params.identity,
      normalizedQuery,
      prefetchTopK,
    });
    const finalized = await this.finalizeWithOptionalModelRerank(ranked, {
      query: normalizedQuery,
      similarityThreshold: params.similarityThreshold,
      topK: params.topK,
    });
    const sectionChunksCache = new Map<string, Promise<SectionChunkRows>>();
    const items = await Promise.all(finalized.map((result) => this.buildSearchItem(result, sectionChunksCache)));
    await this.recordRecallCounts(items);
    await this.recordChunkRecallCounts(items);
    return { items };
  }

  /**
   * 多文档检索：各文档召回后拼接 → 统一 modelRerankOnce → 按 documentId 分组截断各 topK → 按请求顺序 flat。
   */
  public async searchMultiByDocuments(params: RetrievalMultiDocumentSearchParams): Promise<RetrievalSearchResult> {
    if (this.documentPlatformSync) {
      await runKbUpstreamStep("platform-document-sync", () =>
        Promise.all(
          params.documents.map((spec) => this.documentPlatformSync!.ensureDocumentAvailable(spec.documentId, params.platformSync)),
        ),
      );
    }

    const config = this.config;
    const normalizedQuery = this.normalizeQuery(params.query, config.retrievalMaxQueryLength);
    if (normalizedQuery === "") {
      return { items: [] };
    }

    const access = { filters: params.filters, identity: params.identity };
    const recalled = await runKbUpstreamStep("vector-search", () =>
      Promise.all(
        params.documents.map(async (spec) => {
          const topK = typeof spec.topK === "number" ? spec.topK : 5;
          const prefetchTopK = Math.max(topK, topK * 3, config.retrievalPrefetchTopK);
          const ranked = await this.recallForQuery({
            documentId: spec.documentId,
            filters: access.filters,
            identity: access.identity,
            normalizedQuery,
            prefetchTopK,
          });
          return {
            prepared: this.prepareCandidatesForRerank(ranked, normalizedQuery),
            spec: { ...spec, topK },
          };
        }),
      ),
    );

    const mergedCandidates =
      this.config.retrievalModelRerankEnabled && this.rerankPort
        ? allocateMultiDocumentRerankBudget(
            recalled.map((entry) => entry.prepared),
            this.config.retrievalRerankInputTopN,
          )
        : recalled.flatMap((entry) => entry.prepared);
    const reranked = await this.modelRerankOnceStage(mergedCandidates, normalizedQuery, "/kb/search/by-documents");

    const byDocumentId = new Map<string, RankedSearchResult[]>();
    for (const result of reranked) {
      const documentId = this.normalizeDocumentId(result.payload.documentId);
      const bucket = byDocumentId.get(documentId);
      if (bucket) {
        bucket.push(result);
      } else {
        byDocumentId.set(documentId, [result]);
      }
    }

    const sectionChunksCache = new Map<string, Promise<SectionChunkRows>>();
    const itemGroups: SearchItem[][] = [];
    for (const entry of recalled) {
      const documentId = this.normalizeDocumentId(entry.spec.documentId);
      const docCandidates = byDocumentId.get(documentId) ?? [];
      const finalized = await this.applyThresholdAndTopK(docCandidates, {
        query: normalizedQuery,
        similarityThreshold: entry.spec.similarityThreshold,
        topK: entry.spec.topK,
      });
      itemGroups.push(await Promise.all(finalized.map((result) => this.buildSearchItem(result, sectionChunksCache))));
    }

    const items = itemGroups.flat();
    await this.recordRecallCounts(items);
    await this.recordChunkRecallCounts(items);
    return { items };
  }

  public async searchByDirectory(params: RetrievalDirectorySearchParams): Promise<RetrievalSearchResult> {
    const config = this.config;
    const normalizedQuery = this.normalizeQuery(params.query, config.retrievalMaxQueryLength);
    if (normalizedQuery === "") {
      return { items: [] };
    }

    const documentIds = await this.documentRepository.findIdsByDirectoryId(params.directoryId);
    if (documentIds.length === 0) {
      return { items: [] };
    }

    const prefetchTopK = Math.max(params.topK, params.topK * 3, config.retrievalPrefetchTopK);
    const access = { filters: params.filters, identity: params.identity };
    const perDocumentRanked = await Promise.all(
      documentIds.map((documentId) =>
        this.recallForQuery({
          documentId,
          filters: access.filters,
          identity: access.identity,
          normalizedQuery,
          prefetchTopK,
        }),
      ),
    );
    // Cross-document concat; vector/lexical fusion already happened per document.
    const mergedRanked = perDocumentRanked.flat();
    const finalized = await this.finalizeWithOptionalModelRerank(mergedRanked, {
      query: normalizedQuery,
      route: "/kb/search/by-directory",
      similarityThreshold: params.similarityThreshold,
      topK: params.topK,
    });
    const sectionChunksCache = new Map<string, Promise<SectionChunkRows>>();

    const items = await Promise.all(finalized.map((result) => this.buildSearchItem(result, sectionChunksCache)));
    await this.recordRecallCounts(items);
    await this.recordChunkRecallCounts(items);
    return { items };
  }
}
