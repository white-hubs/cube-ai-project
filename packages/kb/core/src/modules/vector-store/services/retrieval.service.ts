import { Inject, Injectable } from "@dangao/bun-server";

import { APP_CONFIG_TOKEN, type AppConfig } from "../../../config/app.config";
import { runKbUpstreamStep } from "../../../infrastructure/upstream-error";
import {
  DOCUMENT_PLATFORM_SYNC_PORT_TOKEN,
  type DocumentPlatformSyncPort,
  type PlatformDocumentSyncContext,
} from "../../../port/document-platform-sync.port";
import { type ChunkType, type RetrievalProfile, type SearchItem } from "../../common/document-types";
import { DocumentRepositoryOrm } from "../../documents/infrastructure/orm/document.repository";
import {
  EmbeddingProvider,
  type EmbeddingProvider as EmbeddingProviderContract,
  type EmbeddingVector,
} from "../infrastructure/embeddings/embedding-provider";
import { resolveChunkRetrievalProfile, resolveQueryRetrievalProfile } from "../infrastructure/embeddings/retrieval-profile";
import { DocumentChunkRepositoryOrm } from "../infrastructure/qdrant/document-chunk.repository";
import { QdrantVectorRepository } from "../infrastructure/qdrant/qdrant-vector.repository";

export interface RetrievalSearchParams {
  query: string;
  topK: number;
  documentId?: string;
  /**
   * 可选，[0,1]。与响应中 `score` 同源（对 `rankScore` clamp 到 [0,1] 后比较）。
   * 仅保留 **score > similarityThreshold** 的分段；≤0 或未传表示不做该层过滤。
   */
  similarityThreshold?: number;
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
}

export interface RetrievalSearchResult {
  items: SearchItem[];
}

type VectorSearchResult = Awaited<ReturnType<QdrantVectorRepository["search"]>>[number];

type RankedSearchResult = VectorSearchResult & {
  rankScore: number;
  lexicalScore: number;
};

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
  ) {}

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
   * 按文档内最高分归一化 rankScore，使同一 chunk 在 by-documents / by-directory / search(documentId) 下得分一致，
   * 且单文档内最佳命中可接近 1.0（避免 RRF 在多 chunk 文档内被压到 0.x）。
   */
  private normalizeRankScoresPerDocument(ranked: RankedSearchResult[]): RankedSearchResult[] {
    const groups = new Map<string, RankedSearchResult[]>();
    for (const result of ranked) {
      const documentId = this.normalizeDocumentId(result.payload.documentId);
      const bucket = groups.get(documentId) ?? [];
      bucket.push(result);
      groups.set(documentId, bucket);
    }

    const normalized: RankedSearchResult[] = [];
    for (const group of groups.values()) {
      const maxRankScore = group.reduce((max, item) => Math.max(max, item.rankScore), 0);
      if (maxRankScore <= 0) {
        normalized.push(...group);
        continue;
      }
      for (const item of group) {
        normalized.push({
          ...item,
          rankScore: Number((item.rankScore / maxRankScore).toFixed(6)),
        });
      }
    }
    return normalized;
  }

  /** 按最终相关性得分过滤；与 `buildSearchItem` 中写入的 `score` 一致（应在文档内归一化之后调用）。 */
  private filterBySimilarityThreshold(ranked: RankedSearchResult[], similarityThreshold?: number): RankedSearchResult[] {
    if (similarityThreshold === undefined || !Number.isFinite(similarityThreshold) || similarityThreshold <= 0) {
      return ranked;
    }
    return ranked.filter((r) => this.clampScoreToUnitInterval(r.rankScore) > similarityThreshold);
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

  /** 全库（或当前 project）向量+词法召回与排序，不截断 topK。 */
  private async recallAndRankGlobal(
    normalizedQuery: string,
    rawQuery: string,
    queryVector: EmbeddingVector,
    prefetchTopK: number,
  ): Promise<RankedSearchResult[]> {
    const config = this.config;
    const results = await this.qdrantVectorRepository.search({
      denseVector: queryVector.dense,
      scoreThreshold: config.retrievalScoreThreshold > 0 ? config.retrievalScoreThreshold : undefined,
      sparseVector: queryVector.sparse,
      topK: prefetchTopK,
    });
    const lexicalRows = await this.documentChunkRepository.searchLexicalChunks({
      query: normalizedQuery,
      terms: this.buildLexicalTerms(rawQuery),
      topK: prefetchTopK,
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
    },
  ): Promise<RankedSearchResult[]> {
    const config = this.config;
    const results = await this.qdrantVectorRepository.search({
      denseVector: queryVector.dense,
      documentId: params.documentId,
      scoreThreshold: config.retrievalScoreThreshold > 0 ? config.retrievalScoreThreshold : undefined,
      sparseVector: queryVector.sparse,
      topK: params.prefetchTopK,
    });
    const lexicalRows = await this.documentChunkRepository.searchLexicalChunks({
      documentId: params.documentId,
      query: normalizedQuery,
      terms: this.buildLexicalTerms(rawQuery),
      topK: params.prefetchTopK,
    });
    const mergedResults = this.mergeRecallResults(results, lexicalRows).filter((result) =>
      this.documentIdsMatch(result.payload.documentId, params.documentId),
    );
    return this.rankResults(mergedResults, normalizedQuery, config.retrievalRerankEnabled);
  }

  private finalizeRankedResults(
    ranked: RankedSearchResult[],
    params: { topK: number; similarityThreshold?: number },
  ): RankedSearchResult[] {
    const normalized = this.normalizeRankScoresPerDocument(ranked);
    const afterThreshold = this.filterBySimilarityThreshold(normalized, params.similarityThreshold);
    return afterThreshold.toSorted((left, right) => right.rankScore - left.rankScore || right.score - left.score).slice(0, params.topK);
  }

  /**
   * 单次向量+词法召回与排序，不写入召回计数（由上层统一汇总后写入）。
   */
  private async searchSingleDocument(
    normalizedQuery: string,
    rawQuery: string,
    queryVector: EmbeddingVector,
    params: {
      topK: number;
      documentId: string;
      similarityThreshold?: number;
    },
  ): Promise<SearchItem[]> {
    const config = this.config;
    const prefetchTopK = Math.max(params.topK, params.topK * 3, config.retrievalPrefetchTopK);
    const ranked = await this.recallAndRankForDocument(normalizedQuery, rawQuery, queryVector, {
      documentId: params.documentId,
      prefetchTopK,
    });
    const finalized = this.finalizeRankedResults(ranked, params);
    const sectionChunksCache = new Map<string, Promise<SectionChunkRows>>();

    return Promise.all(finalized.map((result) => this.buildSearchItem(result, sectionChunksCache)));
  }

  public async search(params: RetrievalSearchParams): Promise<RetrievalSearchResult> {
    const config = this.config;
    const normalizedQuery = this.normalizeQuery(params.query, config.retrievalMaxQueryLength);
    const queryProfile = resolveQueryRetrievalProfile(normalizedQuery);
    const [queryVector] = await this.embeddingProvider.embed([normalizedQuery], "query", [{ retrievalProfile: queryProfile }]);
    if (!queryVector || queryVector.dense.length === 0) {
      return { items: [] };
    }
    const prefetchTopK = Math.max(params.topK, params.topK * 3, config.retrievalPrefetchTopK);
    const ranked = params.documentId
      ? await this.recallAndRankForDocument(normalizedQuery, params.query, queryVector, {
          documentId: params.documentId,
          prefetchTopK,
        })
      : await this.recallAndRankGlobal(normalizedQuery, params.query, queryVector, prefetchTopK);
    const finalized = this.finalizeRankedResults(ranked, {
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
   * 多文档检索：query 只嵌入一次；对每个文档分别限定召回范围并应用各自的 topK / similarityThreshold，
   * 最终按请求中 `documents` 顺序拼接各文档结果。
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
    const queryProfile = resolveQueryRetrievalProfile(normalizedQuery);
    const [queryVector] = await runKbUpstreamStep("embedding", () =>
      this.embeddingProvider.embed([normalizedQuery], "query", [{ retrievalProfile: queryProfile }]),
    );
    if (!queryVector || queryVector.dense.length === 0) {
      return { items: [] };
    }

    const itemGroups = await runKbUpstreamStep("vector-search", () =>
      Promise.all(
        params.documents.map((spec) => {
          const topK = typeof spec.topK === "number" ? spec.topK : 5;
          return this.searchSingleDocument(normalizedQuery, params.query, queryVector, {
            documentId: spec.documentId,
            similarityThreshold: spec.similarityThreshold,
            topK,
          });
        }),
      ),
    );
    const items = itemGroups.flat();
    await this.recordRecallCounts(items);
    await this.recordChunkRecallCounts(items);
    return { items };
  }

  public async searchByDirectory(params: {
    query: string;
    topK: number;
    directoryId: string;
    similarityThreshold?: number;
  }): Promise<RetrievalSearchResult> {
    const config = this.config;
    const normalizedQuery = this.normalizeQuery(params.query, config.retrievalMaxQueryLength);
    const queryProfile = resolveQueryRetrievalProfile(normalizedQuery);
    const [queryVector] = await this.embeddingProvider.embed([normalizedQuery], "query", [{ retrievalProfile: queryProfile }]);
    if (!queryVector || queryVector.dense.length === 0) {
      return { items: [] };
    }

    const documentIds = await this.documentRepository.findIdsByDirectoryId(params.directoryId);
    if (documentIds.length === 0) {
      return { items: [] };
    }

    const prefetchTopK = Math.max(params.topK, params.topK * 3, config.retrievalPrefetchTopK);
    const perDocumentRanked = await Promise.all(
      documentIds.map((documentId) =>
        this.recallAndRankForDocument(normalizedQuery, params.query, queryVector, {
          documentId,
          prefetchTopK,
        }),
      ),
    );
    const mergedRanked = perDocumentRanked.flat();
    const finalized = this.finalizeRankedResults(mergedRanked, {
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
