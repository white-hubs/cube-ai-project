import { BaseRepository, DatabaseService, Inject, Injectable, LOGGER_TOKEN, type Logger, Repository } from "@dangao/bun-server";

import { currentTenantId, isGlobalAccessEnabled } from "@cube-ai/tenant-context";
import { buildStableQdrantPointId } from "@cube-ai/vector-qdrant";

import { serializeStringArrayJson } from "../../../common/document-metadata";
import { type TextChunkRecord } from "../../../common/document-types";
import { formatMysqlDateTimeShanghai } from "../../../common/mysql-datetime";
import { buildDocumentAccessMysqlPredicate, type DocumentMetadataFilters, type KbAclIdentity } from "../../access/document-access-filter";
import { type DocumentChunkEntity } from "./document-chunk.entity";
import { LEXICAL_FIELD_WEIGHTS, LEXICAL_SCORE_FIELDS, type LexicalScoreField } from "./lexical-field-weights";
import {
  buildFulltextAgainstQuery,
  calculateShortFieldLexicalBonus,
  fulltextMatchColumnsSql,
  LEXICAL_SHORT_LIKE_FIELDS,
  maxJsComparableFulltextScore,
  normalizeFulltextScores,
} from "./lexical-fulltext-score";
import { APP_CONFIG_TOKEN, type AppConfig } from "@/config/app.config";
import { generateKbRecordId } from "@/infrastructure/kb-record-id";

export { LEXICAL_FIELD_WEIGHTS, LEXICAL_SCORE_FIELDS, type LexicalScoreField };

type MergeSources<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer R) => void ? R : never;

function mergeObject<T extends object, S extends readonly object[]>(target: T, ...sources: S): T & MergeSources<S[number]> {
  const clone = { ...target } as T & MergeSources<S[number]>;
  return Object.assign(clone, ...sources);
}

/**
 * 构造与 `calculateLexicalScore` 同权的 SQL 预评分表达式及绑定参数。
 * W3.4 可替换本函数体为 FULLTEXT，权重仍来自 `LEXICAL_FIELD_WEIGHTS`。
 */
export function buildLexicalPreScoreSql(query: string, terms: string[]): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const field of LEXICAL_SCORE_FIELDS) {
    const weights = LEXICAL_FIELD_WEIGHTS[field];
    const column = `LOWER(COALESCE(${field}, ''))`;
    if (query !== "") {
      parts.push(`(CASE WHEN ${column} LIKE ? THEN ${weights.exact} ELSE 0 END)`);
      params.push(`%${query}%`);
    }
    for (const term of terms) {
      if (term === "") {
        continue;
      }
      parts.push(`(CASE WHEN ${column} LIKE ? THEN ${weights.term} ELSE 0 END)`);
      params.push(`%${term}%`);
    }
  }
  if (parts.length === 0) {
    return { params: [], sql: "0" };
  }
  return { params, sql: `(${parts.join(" + ")})` };
}

@Repository("document_chunk", "id")
@Injectable()
export class DocumentChunkRepositoryOrm extends BaseRepository<DocumentChunkEntity> {
  protected override tableName = "document_chunk";
  protected override primaryKey = "id";

  public constructor(
    protected override readonly databaseService: DatabaseService,
    @Inject(LOGGER_TOKEN) private readonly logger: Logger,
    @Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig,
  ) {
    super(databaseService);
  }

  private getTenantId(): string | null {
    if (isGlobalAccessEnabled()) {
      return null;
    }
    return currentTenantId();
  }

  private scopeFilter(): { sql: string; params: unknown[] } {
    const pid = this.getTenantId();
    if (pid) {
      return { sql: "tenant_id = ?", params: [pid] };
    }
    return { params: [], sql: "" };
  }

  private getAuditInfo(): { by: string; id: string | null; type: string | null } {
    return { by: "system", id: null, type: null };
  }

  private activeGenerationPredicate(alias?: string): string {
    const prefix = alias ? `${alias}.` : "";
    return `${prefix}generation_id = COALESCE((SELECT dr.active_generation_id FROM document_record dr WHERE dr.id = ${prefix}document_id AND (dr.deleted IS NULL OR dr.deleted = 0)), 'legacy')`;
  }

  private normalizeSqlValue(value: unknown): unknown {
    if (value === undefined) {
      return null;
    }
    if (typeof value === "bigint") {
      return Number(value);
    }
    if (value instanceof Date || value === null) {
      return value;
    }
    if (Array.isArray(value) || typeof value === "object") {
      return JSON.stringify(value);
    }
    return value;
  }

  private calculateLexicalScore(row: Record<string, unknown>, query: string, terms: string[]): number {
    const scoreField = (value: unknown, exactWeight: number, termWeight: number): number => {
      if (typeof value !== "string" || value.trim() === "") {
        return 0;
      }
      const haystack = value.toLowerCase();
      let score = query !== "" && haystack.includes(query) ? exactWeight : 0;
      for (const term of terms) {
        if (term !== "" && haystack.includes(term)) {
          score += termWeight;
        }
      }
      return score;
    };

    let total = 0;
    for (const field of LEXICAL_SCORE_FIELDS) {
      const weights = LEXICAL_FIELD_WEIGHTS[field];
      total += scoreField(row[field], weights.exact, weights.term);
    }
    return total;
  }

  private buildStructuredSearchTerms(query: string, terms: string[]): string[] {
    const normalizedQuery = query.trim().toLowerCase();
    const expanded = new Set<string>(terms);
    const structuredTokens = normalizedQuery
      .replaceAll(/([a-z])([A-Z])/gu, "$1 $2")
      .split(/[\s/_.:-]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);

    for (const token of structuredTokens) {
      expanded.add(token);
    }

    if (!normalizedQuery.includes(" ") && normalizedQuery.length >= 4 && normalizedQuery.length <= 24) {
      for (let index = 0; index <= normalizedQuery.length - 2; index += 1) {
        expanded.add(normalizedQuery.slice(index, index + 2));
      }
    }

    return Array.from(expanded).slice(0, 16);
  }

  public async replaceDocumentChunks(documentId: string, chunks: TextChunkRecord[]): Promise<void> {
    await this.deleteByDocument(documentId);
    await this.insertDocumentGenerationChunks(documentId, chunks[0]?.generationId ?? "legacy", chunks);
  }

  /** Insert a staging generation without touching the currently active manifest. */
  public async insertDocumentGenerationChunks(documentId: string, generationId: string, chunks: TextChunkRecord[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    const tenant_id = this.getTenantId();
    const audit = this.getAuditInfo();
    const now = formatMysqlDateTimeShanghai();

    for (const chunk of chunks) {
      const payload: Partial<DocumentChunkEntity> = {
        acl_group_ids_json: serializeStringArrayJson(chunk.aclGroupIds ?? null),
        caption_text: chunk.captionText,
        char_count: chunk.text.length,
        chunk_id: chunk.chunkId,
        chunk_index: chunk.chunkIndex,
        chunk_type: chunk.chunkType,
        create_by: audit.by,
        create_time: now as unknown as Date,
        creator_id: audit.id,
        creator_type: audit.type,
        cue_index: chunk.cueIndex ?? null,
        deleted: 0n,
        doc_created_at: chunk.docCreatedAt ? (chunk.docCreatedAt as unknown as Date) : null,
        doc_type: chunk.docType ?? null,
        document_id: documentId,
        generation_id: generationId,
        embedding_fingerprint: chunk.embeddingFingerprint ?? null,
        embedding_text: chunk.embeddingText,
        end_time: chunk.endTime ?? null,
        file_name: chunk.fileName,
        headers_text: chunk.headers ? JSON.stringify(chunk.headers) : null,
        heading_path: JSON.stringify(chunk.headingPath),
        id: generateKbRecordId(),
        keywords_text: chunk.keywords ? JSON.stringify(chunk.keywords) : null,
        lang: chunk.lang ?? null,
        order_in_section: chunk.orderInSection,
        page_no: chunk.pageNo,
        picture_description: chunk.pictureDescription,
        property_namespace: chunk.propertyNamespace ?? null,
        qdrant_point_id: buildStableQdrantPointId(generationId === "legacy" ? chunk.chunkId : `${generationId}:${chunk.chunkId}`),
        recall_count: 0,
        row_end: chunk.rowEnd ?? null,
        row_start: chunk.rowStart ?? null,
        section_id: chunk.sectionId,
        sheet_name: chunk.sheetName ?? null,
        source_type: chunk.sourceType,
        start_time: chunk.startTime ?? null,
        table_id: chunk.tableId ?? null,
        tags_json: serializeStringArrayJson(chunk.tags ?? null),
        tenant_id,
        text_content: chunk.text,
        update_by: audit.by,
        update_time: now as unknown as Date,
        updater_id: audit.id,
        updater_type: audit.type,
      };
      const keys = Object.keys(payload) as (keyof DocumentChunkEntity)[];
      const values = keys.map((key) => this.normalizeSqlValue(payload[key]));
      const placeholders = keys.map(() => "?").join(", ");
      const sql = `INSERT INTO ${this.tableName} (${keys.join(", ")}) VALUES (${placeholders})`;
      try {
        await this.executeQuery(sql, values);
      } catch (error) {
        this.logger.error(`Failed to insert document chunk ${chunk.chunkId}`, {
          error,
          keys,
          valueTypes: values.map((value) => (value === null ? "null" : value instanceof Date ? "Date" : typeof value)),
        });
        throw error;
      }
    }
    this.logger.info(`Inserted chunk generation ${generationId} for document ${documentId}`);
  }

  public async findByDocumentId(documentId: string): Promise<DocumentChunkEntity[]> {
    const sc = this.scopeFilter();
    const params: unknown[] = [documentId, ...sc.params];
    let sql = `SELECT * FROM ${this.tableName} WHERE document_id = ? AND (deleted IS NULL OR deleted = 0) AND ${this.activeGenerationPredicate()}`;
    if (sc.sql) {
      sql += ` AND ${sc.sql}`;
    }
    sql += " ORDER BY chunk_index ASC";
    return (await this.executeQuery(sql, params)) as DocumentChunkEntity[];
  }

  public async findByDocumentIdAndChunkId(documentId: string, chunkId: string): Promise<DocumentChunkEntity | null> {
    const sc = this.scopeFilter();
    const params: unknown[] = [documentId, chunkId, ...sc.params];
    let sql = `SELECT * FROM ${this.tableName} WHERE document_id = ? AND chunk_id = ? AND (deleted IS NULL OR deleted = 0) AND ${this.activeGenerationPredicate()}`;
    if (sc.sql) {
      sql += ` AND ${sc.sql}`;
    }
    const rows = (await this.executeQuery(sql, params)) as DocumentChunkEntity[];
    return rows[0] ?? null;
  }

  /** Public chunk lookup fails closed unless an explicit tenant is active. */
  public async findByChunkId(chunkId: string): Promise<DocumentChunkEntity | null> {
    const tenantId = this.getTenantId();
    if (!tenantId) {
      return null;
    }
    const rows = (await this.executeQuery(
      `SELECT * FROM ${this.tableName} WHERE chunk_id = ? AND tenant_id = ? AND (deleted IS NULL OR deleted = 0) AND ${this.activeGenerationPredicate()}`,
      [chunkId, tenantId],
    )) as DocumentChunkEntity[];
    return rows[0] ?? null;
  }

  public async findByDocumentIdAndSectionId(documentId: string, sectionId: string): Promise<DocumentChunkEntity[]> {
    const sc = this.scopeFilter();
    const params: unknown[] = [documentId, sectionId, ...sc.params];
    let sql = `SELECT * FROM ${this.tableName} WHERE document_id = ? AND section_id = ? AND (deleted IS NULL OR deleted = 0) AND ${this.activeGenerationPredicate()}`;
    if (sc.sql) {
      sql += ` AND ${sc.sql}`;
    }
    sql += " ORDER BY order_in_section ASC, chunk_index ASC";
    const rows = (await this.executeQuery(sql, params)) as DocumentChunkEntity[];
    return rows;
  }

  public async searchLexicalChunks(params: {
    query: string;
    terms: string[];
    topK: number;
    documentId?: string;
    documentIds?: string[];
    /** Server-resolved ACL identity; never from client filter body. */
    identity?: KbAclIdentity | null;
    allowedGroupIds?: readonly string[];
    filters?: DocumentMetadataFilters | null;
  }): Promise<(DocumentChunkEntity & { lexical_score: number })[]> {
    const sc = this.scopeFilter();
    const access = buildDocumentAccessMysqlPredicate({
      allowedGroupIds: params.allowedGroupIds,
      filters: params.filters,
      identity: params.identity,
    });
    const normalizedQuery = params.query.trim().toLowerCase();
    const normalizedTerms = this.buildStructuredSearchTerms(
      normalizedQuery,
      Array.from(new Set(params.terms.map((term) => term.trim().toLowerCase()).filter((term) => term !== ""))),
    );
    if (normalizedQuery === "" && normalizedTerms.length === 0) {
      return [];
    }

    const searchTerms = [normalizedQuery, ...normalizedTerms].filter((term) => term !== "");
    if (searchTerms.length === 0) {
      return [];
    }

    if (this.config.lexicalFulltextEnabled) {
      return this.searchLexicalChunksFulltext({
        access,
        documentId: params.documentId,
        documentIds: params.documentIds,
        normalizedQuery,
        normalizedTerms,
        sc,
        searchTerms,
        topK: params.topK,
      });
    }

    return this.searchLexicalChunksLike({
      access,
      documentId: params.documentId,
      documentIds: params.documentIds,
      normalizedQuery,
      normalizedTerms,
      sc,
      searchTerms,
      topK: params.topK,
    });
  }

  /** 默认路径：LIKE + SQL pre-score + JS calculateLexicalScore（flag off）。 */
  private async searchLexicalChunksLike(params: {
    normalizedQuery: string;
    normalizedTerms: string[];
    searchTerms: string[];
    topK: number;
    documentId?: string;
    documentIds?: string[];
    sc: { sql: string; params: unknown[] };
    access: { sql: string; params: unknown[] };
  }): Promise<(DocumentChunkEntity & { lexical_score: number })[]> {
    const preScore = buildLexicalPreScoreSql(params.normalizedQuery, params.normalizedTerms);
    const paramsList: unknown[] = [...preScore.params, ...params.sc.params, ...params.access.params];
    let sql = `SELECT *, ${preScore.sql} AS lexical_pre_score FROM ${this.tableName} WHERE (deleted IS NULL OR deleted = 0) AND ${this.activeGenerationPredicate()}`;
    if (params.sc.sql) {
      sql += ` AND ${params.sc.sql}`;
    }
    if (params.access.sql) {
      sql += ` AND ${params.access.sql}`;
    }
    if (typeof params.documentId === "string") {
      sql += " AND document_id = ?";
      paramsList.push(params.documentId);
    } else if (Array.isArray(params.documentIds) && params.documentIds.length > 0) {
      sql += ` AND document_id IN (${params.documentIds.map(() => "?").join(", ")})`;
      paramsList.push(...params.documentIds);
    }

    const whereClauses = params.searchTerms.map(
      () => `(${LEXICAL_SCORE_FIELDS.map((field) => `LOWER(COALESCE(${field}, '')) LIKE ?`).join(" OR ")})`,
    );
    sql += ` AND (${whereClauses.join(" OR ")})`;
    for (const term of params.searchTerms) {
      const likeValue = `%${term}%`;
      paramsList.push(...Array.from({ length: LEXICAL_SCORE_FIELDS.length }, () => likeValue));
    }

    const candidateLimit = Math.max(params.topK, this.config.lexicalCandidateLimit);
    sql += " ORDER BY lexical_pre_score DESC, chunk_index ASC LIMIT ?";
    paramsList.push(candidateLimit);
    const rows = (await this.executeQuery(sql, paramsList)) as (DocumentChunkEntity & Record<string, unknown>)[];
    return rows
      .map((row) =>
        mergeObject({}, row, {
          lexical_score: this.calculateLexicalScore(row, params.normalizedQuery, params.normalizedTerms),
        }),
      )
      .filter((row) => row.lexical_score > 0)
      .toSorted((left, right) => right.lexical_score - left.lexical_score || left.chunk_index - right.chunk_index)
      .slice(0, params.topK);
  }

  /**
   * FULLTEXT 路径（LEXICAL_FULLTEXT_ENABLED）：
   * MATCH 主列候选 + 短字段 LIKE OR；窗口内 log1p→min-max 归一化后再加短字段 bonus。
   * 权重仍只引用 LEXICAL_FIELD_WEIGHTS；raw MATCH 永不直接入 hybrid。
   */
  private async searchLexicalChunksFulltext(params: {
    normalizedQuery: string;
    normalizedTerms: string[];
    searchTerms: string[];
    topK: number;
    documentId?: string;
    documentIds?: string[];
    sc: { sql: string; params: unknown[] };
    access: { sql: string; params: unknown[] };
  }): Promise<(DocumentChunkEntity & { lexical_score: number })[]> {
    const againstQuery = buildFulltextAgainstQuery(params.normalizedQuery, params.normalizedTerms);
    const matchCols = fulltextMatchColumnsSql();
    const matchExpr = `MATCH(${matchCols}) AGAINST (? IN BOOLEAN MODE)`;
    const paramsList: unknown[] = [againstQuery, ...params.sc.params, ...params.access.params];
    let sql = `SELECT *, ${matchExpr} AS ft_raw_score FROM ${this.tableName} WHERE (deleted IS NULL OR deleted = 0) AND ${this.activeGenerationPredicate()}`;
    if (params.sc.sql) {
      sql += ` AND ${params.sc.sql}`;
    }
    if (params.access.sql) {
      sql += ` AND ${params.access.sql}`;
    }
    if (typeof params.documentId === "string") {
      sql += " AND document_id = ?";
      paramsList.push(params.documentId);
    } else if (Array.isArray(params.documentIds) && params.documentIds.length > 0) {
      sql += ` AND document_id IN (${params.documentIds.map(() => "?").join(", ")})`;
      paramsList.push(...params.documentIds);
    }

    const shortLikeClauses = params.searchTerms.map(
      () => `(${LEXICAL_SHORT_LIKE_FIELDS.map((field) => `LOWER(COALESCE(${field}, '')) LIKE ?`).join(" OR ")})`,
    );
    // againstQuery 再绑一次给 WHERE MATCH；短字段 LIKE 兜底 OR
    sql += ` AND (${matchExpr}`;
    paramsList.push(againstQuery);
    if (shortLikeClauses.length > 0) {
      sql += ` OR ${shortLikeClauses.join(" OR ")}`;
      for (const term of params.searchTerms) {
        const likeValue = `%${term}%`;
        paramsList.push(...Array.from({ length: LEXICAL_SHORT_LIKE_FIELDS.length }, () => likeValue));
      }
    }
    sql += ")";

    const candidateLimit = Math.max(params.topK, this.config.lexicalCandidateLimit);
    sql += " ORDER BY ft_raw_score DESC, chunk_index ASC LIMIT ?";
    paramsList.push(candidateLimit);
    const rows = (await this.executeQuery(sql, paramsList)) as (DocumentChunkEntity & Record<string, unknown>)[];

    const rawScores = rows.map((row) => {
      const raw = row.ft_raw_score;
      return typeof raw === "number" && Number.isFinite(raw) ? raw : Number(raw) || 0;
    });
    const normalized = normalizeFulltextScores(rawScores, maxJsComparableFulltextScore());

    return rows
      .map((row, index) => {
        const shortBonus = calculateShortFieldLexicalBonus(row, params.normalizedQuery, params.normalizedTerms);
        const lexical_score = (normalized[index] ?? 0) + shortBonus;
        return mergeObject({}, row, { lexical_score });
      })
      .filter((row) => row.lexical_score > 0)
      .toSorted((left, right) => right.lexical_score - left.lexical_score || left.chunk_index - right.chunk_index)
      .slice(0, params.topK);
  }

  /**
   * 按 (documentId, chunkId) 批量累加分段召回次数；key 为 `${documentId}\u0001${chunkId}`。
   */
  public async incrementChunkRecallCount(deltas: Map<string, number>): Promise<void> {
    const entries = Array.from(deltas.entries()).filter(([, delta]) => Number.isFinite(delta) && delta > 0);
    if (entries.length === 0) {
      return;
    }
    const unionParts: string[] = [];
    const joinParams: unknown[] = [];
    for (const [key, delta] of entries) {
      const sepIndex = key.indexOf("\u0001");
      if (sepIndex <= 0) {
        continue;
      }
      const documentId = key.slice(0, sepIndex);
      const chunkId = key.slice(sepIndex + 1);
      unionParts.push("SELECT ? AS document_id, ? AS chunk_id, ? AS delta");
      joinParams.push(documentId, chunkId, delta);
    }
    if (unionParts.length === 0) {
      return;
    }
    const innerSql = unionParts.join(" UNION ALL ");
    let sql = `UPDATE ${this.tableName} AS dc INNER JOIN (${innerSql}) AS t ON dc.document_id = t.document_id AND dc.chunk_id = t.chunk_id SET dc.recall_count = dc.recall_count + t.delta WHERE (dc.deleted IS NULL OR dc.deleted = 0) AND ${this.activeGenerationPredicate("dc")}`;
    const pid = this.getTenantId();
    if (pid) {
      sql += " AND dc.tenant_id = ?";
      joinParams.push(pid);
    }
    await this.executeQuery(
      sql,
      joinParams.map((value) => this.normalizeSqlValue(value)),
    );
  }

  public async deleteByDocument(documentId: string): Promise<void> {
    const sc = this.scopeFilter();
    const params: unknown[] = [documentId, ...sc.params];
    let sql = `DELETE FROM ${this.tableName} WHERE document_id = ?`;
    if (sc.sql) {
      sql += ` AND ${sc.sql}`;
    }
    await this.executeQuery(
      sql,
      params.map((value) => this.normalizeSqlValue(value)),
    );
  }

  public async deleteDocumentGeneration(documentId: string, generationId: string): Promise<void> {
    const sc = this.scopeFilter();
    const params: unknown[] = [documentId, generationId, ...sc.params];
    let sql = `DELETE FROM ${this.tableName} WHERE document_id = ? AND generation_id = ?`;
    if (sc.sql) {
      sql += ` AND ${sc.sql}`;
    }
    await this.executeQuery(
      sql,
      params.map((value) => this.normalizeSqlValue(value)),
    );
  }

  public async countDocumentGeneration(documentId: string, generationId: string): Promise<number> {
    const sc = this.scopeFilter();
    const params: unknown[] = [documentId, generationId, ...sc.params];
    let sql = `SELECT COUNT(*) AS total FROM ${this.tableName} WHERE document_id = ? AND generation_id = ? AND (deleted IS NULL OR deleted = 0)`;
    if (sc.sql) {
      sql += ` AND ${sc.sql}`;
    }
    const rows = (await this.executeQuery<{ total: number | string }>(sql, params)) as { total: number | string }[];
    return Number(rows[0]?.total ?? 0);
  }

  /** Validate Qdrant hits against the authoritative active MySQL generation. */
  public async findActiveChunkReferenceKeys(
    refs: readonly { documentId: string; chunkId: string; generationId?: string }[],
  ): Promise<Set<string>> {
    if (refs.length === 0) {
      return new Set();
    }
    const sc = this.scopeFilter();
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const ref of refs.slice(0, 1000)) {
      clauses.push("(dc.document_id = ? AND dc.chunk_id = ? AND dc.generation_id = ?)");
      params.push(ref.documentId, ref.chunkId, ref.generationId ?? "legacy");
    }
    let sql = `SELECT dc.document_id, dc.chunk_id, dc.generation_id
      FROM ${this.tableName} dc
      INNER JOIN document_record dr ON dr.id = dc.document_id
      WHERE (${clauses.join(" OR ")})
        AND (dc.deleted IS NULL OR dc.deleted = 0)
        AND (dr.deleted IS NULL OR dr.deleted = 0)
        AND dc.generation_id = COALESCE(dr.active_generation_id, 'legacy')`;
    if (sc.sql) {
      sql += " AND dc.tenant_id = ?";
      params.push(...sc.params);
    }
    const rows = (await this.executeQuery<{ document_id: string; chunk_id: string; generation_id: string }>(sql, params)) as {
      document_id: string;
      chunk_id: string;
      generation_id: string;
    }[];
    return new Set(rows.map((row) => `${row.document_id}\u0001${row.chunk_id}\u0001${row.generation_id}`));
  }

  public async logicalDeleteByDocument(documentId: string): Promise<void> {
    const sc = this.scopeFilter();
    const audit = this.getAuditInfo();
    const params: unknown[] = [Date.now(), audit.by, audit.id, audit.type, formatMysqlDateTimeShanghai(), documentId, ...sc.params];
    let sql = `UPDATE ${this.tableName} SET deleted = ?, update_by = ?, updater_id = ?, updater_type = ?, update_time = ? WHERE document_id = ? AND (deleted IS NULL OR deleted = 0)`;
    if (sc.sql) {
      sql += ` AND ${sc.sql}`;
    }
    await this.executeQuery(
      sql,
      params.map((value) => this.normalizeSqlValue(value)),
    );
  }
}
