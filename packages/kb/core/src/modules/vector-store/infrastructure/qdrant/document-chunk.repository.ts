import {
  BaseRepository,
  DatabaseService,
  Inject,
  Injectable,
  LOGGER_TOKEN,
  Repository,
  type Logger,
} from '@dangao/bun-server'
import { currentTenantId, isGlobalAccessEnabled } from '@cube-ai/tenant-context'
import { generateKbRecordId } from '@/infrastructure/kb-record-id'
import { formatMysqlDateTimeShanghai } from '../../../common/mysql-datetime'
import type { TextChunkRecord } from '../../../common/document-types'
import { buildStableQdrantPointId } from '@cube-ai/vector-qdrant';
import { DocumentChunkEntity } from './document-chunk.entity'

@Repository('document_chunk', 'id')
@Injectable()
export class DocumentChunkRepositoryOrm extends BaseRepository<DocumentChunkEntity> {
  protected override tableName = 'document_chunk'
  protected override primaryKey = 'id'

  public constructor(
    protected override readonly databaseService: DatabaseService,
    @Inject(LOGGER_TOKEN) private readonly logger: Logger,
  ) {
    super(databaseService)
  }

  private getTenantId(): string | null {
    if (isGlobalAccessEnabled()) return null
    return currentTenantId()
  }

  private scopeFilter(): { sql: string; params: unknown[] } {
    const pid = this.getTenantId()
    if (pid) return { sql: 'tenant_id = ?', params: [pid] }
    return { sql: '', params: [] }
  }

  private getAuditInfo(): { by: string; id: string | null; type: string | null } {
    return { by: 'system', id: null, type: null }
  }

  private normalizeSqlValue(value: unknown): unknown {
    if (value === undefined) {
      return null
    }
    if (typeof value === 'bigint') {
      return Number(value)
    }
    if (value instanceof Date || value === null) {
      return value
    }
    if (Array.isArray(value) || typeof value === 'object') {
      return JSON.stringify(value)
    }
    return value
  }

  private calculateLexicalScore(row: Record<string, unknown>, query: string, terms: string[]): number {
    const scoreField = (value: unknown, exactWeight: number, termWeight: number): number => {
      if (typeof value !== 'string' || value.trim() === '') {
        return 0
      }
      const haystack = value.toLowerCase()
      let score = haystack.includes(query) ? exactWeight : 0
      for (const term of terms) {
        if (haystack.includes(term)) {
          score += termWeight
        }
      }
      return score
    }

    return scoreField(row.text_content, 3.5, 0.8)
      + scoreField(row.embedding_text, 2.2, 0.6)
      + scoreField(row.heading_path, 2.8, 0.8)
      + scoreField(row.sheet_name, 2.5, 0.7)
      + scoreField(row.headers_text, 3.2, 0.9)
      + scoreField(row.keywords_text, 4.0, 1.1)
      + scoreField(row.property_namespace, 3.0, 0.9)
      + scoreField(row.start_time, 3.2, 0.9)
      + scoreField(row.end_time, 3.2, 0.9)
  }

  private buildStructuredSearchTerms(query: string, terms: string[]): string[] {
    const normalizedQuery = query.trim().toLowerCase()
    const expanded = new Set<string>(terms)
    const structuredTokens = normalizedQuery
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/[\s/_.:-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)

    for (const token of structuredTokens) {
      expanded.add(token)
    }

    if (!normalizedQuery.includes(' ') && normalizedQuery.length >= 4 && normalizedQuery.length <= 24) {
      for (let index = 0; index <= normalizedQuery.length - 2; index += 1) {
        expanded.add(normalizedQuery.slice(index, index + 2))
      }
    }

    return Array.from(expanded).slice(0, 16)
  }

  public async replaceDocumentChunks(documentId: string, chunks: TextChunkRecord[]): Promise<void> {
    await this.deleteByDocument(documentId)
    if (chunks.length === 0) {
      return
    }

    const tenant_id = this.getTenantId()
    const audit = this.getAuditInfo()
    const now = formatMysqlDateTimeShanghai()

    for (const chunk of chunks) {
      const payload: Partial<DocumentChunkEntity> = {
        id: generateKbRecordId(),
        tenant_id,
        deleted: 0n,
        create_by: audit.by,
        creator_id: audit.id,
        creator_type: audit.type,
        create_time: now as unknown as Date,
        update_by: audit.by,
        updater_id: audit.id,
        updater_type: audit.type,
        update_time: now as unknown as Date,
        document_id: documentId,
        file_name: chunk.fileName,
        source_type: chunk.sourceType,
        chunk_id: chunk.chunkId,
        qdrant_point_id: buildStableQdrantPointId(chunk.chunkId),
        chunk_index: chunk.chunkIndex,
        text_content: chunk.text,
        embedding_text: chunk.embeddingText,
        char_count: chunk.text.length,
        recall_count: 0,
        section_id: chunk.sectionId,
        heading_path: JSON.stringify(chunk.headingPath),
        page_no: chunk.pageNo,
        chunk_type: chunk.chunkType,
        order_in_section: chunk.orderInSection,
        caption_text: chunk.captionText,
        picture_description: chunk.pictureDescription,
        sheet_name: chunk.sheetName ?? null,
        table_id: chunk.tableId ?? null,
        row_start: chunk.rowStart ?? null,
        row_end: chunk.rowEnd ?? null,
        headers_text: chunk.headers ? JSON.stringify(chunk.headers) : null,
        keywords_text: chunk.keywords ? JSON.stringify(chunk.keywords) : null,
        start_time: chunk.startTime ?? null,
        end_time: chunk.endTime ?? null,
        cue_index: chunk.cueIndex ?? null,
        property_namespace: chunk.propertyNamespace ?? null,
      }
      const keys = Object.keys(payload) as Array<keyof DocumentChunkEntity>
      const values = keys.map((key) => this.normalizeSqlValue(payload[key]))
      const placeholders = keys.map(() => '?').join(', ')
      const sql = `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`
      try {
        await this.executeQuery(sql, values)
      } catch (error) {
        this.logger.error(`Failed to insert document chunk ${chunk.chunkId}`, {
          keys,
          valueTypes: values.map((value) => value === null ? 'null' : value instanceof Date ? 'Date' : typeof value),
          error,
        })
        throw error
      }
    }
    this.logger.info(`Replaced chunk manifest for document ${documentId}`)
  }

  public async findByDocumentId(documentId: string): Promise<DocumentChunkEntity[]> {
    const sc = this.scopeFilter()
    const params: unknown[] = [documentId, ...sc.params]
    let sql = `SELECT * FROM ${this.tableName} WHERE document_id = ? AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    sql += ' ORDER BY chunk_index ASC'
    return await this.executeQuery(sql, params) as DocumentChunkEntity[]
  }

  public async findByDocumentIdAndChunkId(documentId: string, chunkId: string): Promise<DocumentChunkEntity | null> {
    const sc = this.scopeFilter()
    const params: unknown[] = [documentId, chunkId, ...sc.params]
    let sql = `SELECT * FROM ${this.tableName} WHERE document_id = ? AND chunk_id = ? AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    const rows = await this.executeQuery(sql, params) as DocumentChunkEntity[]
    return rows[0] ?? null
  }

  public async updateDocumentChunk(chunk: TextChunkRecord): Promise<void> {
    const sc = this.scopeFilter()
    const audit = this.getAuditInfo()
    const params: unknown[] = [
      chunk.text,
      chunk.embeddingText,
      chunk.text.length,
      chunk.chunkIndex,
      chunk.sectionId,
      JSON.stringify(chunk.headingPath),
      chunk.pageNo,
      chunk.chunkType,
      chunk.orderInSection,
      chunk.captionText,
      chunk.pictureDescription,
      chunk.fileName,
      chunk.sourceType,
      chunk.sheetName ?? null,
      chunk.tableId ?? null,
      chunk.rowStart ?? null,
      chunk.rowEnd ?? null,
      chunk.headers ? JSON.stringify(chunk.headers) : null,
      chunk.keywords ? JSON.stringify(chunk.keywords) : null,
      chunk.startTime ?? null,
      chunk.endTime ?? null,
      chunk.cueIndex ?? null,
      chunk.propertyNamespace ?? null,
      audit.by,
      audit.id,
      audit.type,
      formatMysqlDateTimeShanghai(),
      chunk.documentId,
      chunk.chunkId,
      ...sc.params,
    ]
    let sql = `UPDATE ${this.tableName} SET text_content = ?, embedding_text = ?, char_count = ?, chunk_index = ?, section_id = ?, heading_path = ?, page_no = ?, chunk_type = ?, order_in_section = ?, caption_text = ?, picture_description = ?, file_name = ?, source_type = ?, sheet_name = ?, table_id = ?, row_start = ?, row_end = ?, headers_text = ?, keywords_text = ?, start_time = ?, end_time = ?, cue_index = ?, property_namespace = ?, update_by = ?, updater_id = ?, updater_type = ?, update_time = ? WHERE document_id = ? AND chunk_id = ? AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    await this.executeQuery(sql, params.map((value) => this.normalizeSqlValue(value)))
  }

  public async findByDocumentIdAndSectionId(documentId: string, sectionId: string): Promise<DocumentChunkEntity[]> {
    const sc = this.scopeFilter()
    const params: unknown[] = [documentId, sectionId, ...sc.params]
    let sql = `SELECT * FROM ${this.tableName} WHERE document_id = ? AND section_id = ? AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    sql += ' ORDER BY order_in_section ASC, chunk_index ASC'
    const rows = await this.executeQuery(sql, params) as DocumentChunkEntity[]
    return rows
  }

  public async searchLexicalChunks(params: {
    query: string
    terms: string[]
    topK: number
    documentId?: string
    documentIds?: string[]
  }): Promise<Array<DocumentChunkEntity & { lexical_score: number }>> {
    const sc = this.scopeFilter()
    const normalizedQuery = params.query.trim().toLowerCase()
    const normalizedTerms = this.buildStructuredSearchTerms(
      normalizedQuery,
      Array.from(new Set(params.terms.map((term) => term.trim().toLowerCase()).filter((term) => term !== ''))),
    )
    if (normalizedQuery === '' && normalizedTerms.length === 0) {
      return []
    }

    const paramsList: unknown[] = [...sc.params]
    let sql = `SELECT * FROM ${this.tableName} WHERE (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    if (typeof params.documentId === 'string') {
      sql += ' AND document_id = ?'
      paramsList.push(params.documentId)
    } else if (Array.isArray(params.documentIds) && params.documentIds.length > 0) {
      sql += ` AND document_id IN (${params.documentIds.map(() => '?').join(', ')})`
      paramsList.push(...params.documentIds)
    }

    const fields = [
      'text_content',
      'embedding_text',
      'heading_path',
      'sheet_name',
      'headers_text',
      'keywords_text',
      'property_namespace',
      'start_time',
      'end_time',
    ]
    const searchTerms = [normalizedQuery, ...normalizedTerms].filter((term) => term !== '')
    if (searchTerms.length === 0) {
      return []
    }
    const whereClauses = searchTerms.map(() => `(${fields.map((field) => `LOWER(COALESCE(${field}, '')) LIKE ?`).join(' OR ')})`)
    sql += ` AND (${whereClauses.join(' OR ')})`
    for (const term of searchTerms) {
      const likeValue = `%${term}%`
      for (const _field of fields) {
        paramsList.push(likeValue)
      }
    }

    sql += ' ORDER BY chunk_index ASC LIMIT ?'
    paramsList.push(Math.max(params.topK * 4, params.topK))
    const rows = await this.executeQuery(sql, paramsList) as Array<DocumentChunkEntity & Record<string, unknown>>
    return rows
      .map((row) => ({
        ...row,
        lexical_score: this.calculateLexicalScore(row, normalizedQuery, normalizedTerms),
      }))
      .filter((row) => row.lexical_score > 0)
      .sort((left, right) => right.lexical_score - left.lexical_score || left.chunk_index - right.chunk_index)
      .slice(0, params.topK)
  }

  /**
   * 按 (documentId, chunkId) 批量累加分段召回次数；key 为 `${documentId}\u0001${chunkId}`。
   */
  public async incrementChunkRecallCount(deltas: Map<string, number>): Promise<void> {
    const entries = Array.from(deltas.entries()).filter(([, delta]) => Number.isFinite(delta) && delta > 0)
    if (entries.length === 0) {
      return
    }
    const unionParts: string[] = []
    const joinParams: unknown[] = []
    for (const [key, delta] of entries) {
      const sepIndex = key.indexOf('\u0001')
      if (sepIndex <= 0) {
        continue
      }
      const documentId = key.slice(0, sepIndex)
      const chunkId = key.slice(sepIndex + 1)
      unionParts.push('SELECT ? AS document_id, ? AS chunk_id, ? AS delta')
      joinParams.push(documentId, chunkId, delta)
    }
    if (unionParts.length === 0) {
      return
    }
    const innerSql = unionParts.join(' UNION ALL ')
    let sql = `UPDATE ${this.tableName} AS dc INNER JOIN (${innerSql}) AS t ON dc.document_id = t.document_id AND dc.chunk_id = t.chunk_id SET dc.recall_count = dc.recall_count + t.delta WHERE (dc.deleted IS NULL OR dc.deleted = 0)`
    const pid = this.getTenantId()
    if (pid) {
      sql += ' AND dc.tenant_id = ?'
      joinParams.push(pid)
    }
    await this.executeQuery(sql, joinParams.map((value) => this.normalizeSqlValue(value)))
  }

  public async deleteByDocument(documentId: string): Promise<void> {
    const sc = this.scopeFilter()
    const params: unknown[] = [documentId, ...sc.params]
    let sql = `DELETE FROM ${this.tableName} WHERE document_id = ?`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    await this.executeQuery(sql, params.map((value) => this.normalizeSqlValue(value)))
  }

  public async logicalDeleteByDocument(documentId: string): Promise<void> {
    const sc = this.scopeFilter()
    const audit = this.getAuditInfo()
    const params: unknown[] = [
      Date.now(),
      audit.by,
      audit.id,
      audit.type,
      formatMysqlDateTimeShanghai(),
      documentId,
      ...sc.params,
    ]
    let sql = `UPDATE ${this.tableName} SET deleted = ?, update_by = ?, updater_id = ?, updater_type = ?, update_time = ? WHERE document_id = ? AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    await this.executeQuery(sql, params.map((value) => this.normalizeSqlValue(value)))
  }
}
