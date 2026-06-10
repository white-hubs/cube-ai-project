import {
  BaseRepository,
  DatabaseService,
  Inject,
  Injectable,
  LOGGER_TOKEN,
  Repository,
  type Logger,
} from '@dangao/bun-server'
import { currentTenantId, isGlobalAccessEnabled } from '@/infra/access-scope'
import { resolveKbRecordId } from '@/infra/kb-record-id'
import { formatMysqlDateTimeShanghai } from '../../../common/mysql-datetime'
import { DocumentEntity } from './document.entity'

@Repository('document_record', 'id')
@Injectable()
export class DocumentRepositoryOrm extends BaseRepository<DocumentEntity> {
  protected override tableName = 'document_record'
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

  public override async findAll(): Promise<DocumentEntity[]> {
    const sc = this.scopeFilter()
    const params: unknown[] = [...sc.params]
    let sql = `SELECT * FROM ${this.tableName} WHERE (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    sql += ' ORDER BY id DESC'
    const result = await this.executeQuery<DocumentEntity>(sql, params)
    return Array.isArray(result) ? result : []
  }

  public override async findById(id: string | number): Promise<DocumentEntity | null> {
    const sc = this.scopeFilter()
    const params: unknown[] = [id, ...sc.params]
    let sql = `SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = ? AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    const result = await this.executeQuery<DocumentEntity>(sql, params)
    return Array.isArray(result) && result[0] ? (result[0] as DocumentEntity) : null
  }

  /**
   * 按目录汇总未删除文档数量与 size 总和（用于目录列表展示）。
   */
  public async aggregateDocumentStatsByDirectoryIds(
    directoryIds: string[],
  ): Promise<Map<string, { documentCount: number; totalSizeBytes: number }>> {
    const resultMap = new Map<string, { documentCount: number; totalSizeBytes: number }>()
    if (directoryIds.length === 0) {
      return resultMap
    }
    const sc = this.scopeFilter()
    const placeholders = directoryIds.map(() => '?').join(', ')
    const params: unknown[] = [...directoryIds, ...sc.params]
    let sql = `SELECT directory_id, COUNT(*) AS document_count, COALESCE(SUM(size), 0) AS total_size FROM ${this.tableName} WHERE directory_id IN (${placeholders}) AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    sql += ' GROUP BY directory_id'
    const queryResult = await this.executeQuery<{
      directory_id: string | number
      document_count: number | bigint
      total_size: string | number | bigint
    }>(sql, params)
    const rows = Array.isArray(queryResult) ? queryResult : []
    for (const row of rows) {
      const dirId = String(row.directory_id)
      resultMap.set(dirId, {
        documentCount: Number(row.document_count ?? 0),
        totalSizeBytes: Number(row.total_size ?? 0),
      })
    }
    return resultMap
  }

  public async findIdsByDirectoryId(directoryId: string): Promise<string[]> {
    const sc = this.scopeFilter()
    const params: unknown[] = [directoryId, ...sc.params]
    let sql = `SELECT id FROM ${this.tableName} WHERE directory_id = ? AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    const result = await this.executeQuery(sql, params)
    const rows = Array.isArray(result) ? (result as Array<{ id: string }>) : []
    return rows.map((r) => r.id)
  }

  public async findByDirectoryId(directoryId: string): Promise<DocumentEntity[]> {
    const sc = this.scopeFilter()
    const params: unknown[] = [directoryId, ...sc.params]
    let sql = `SELECT * FROM ${this.tableName} WHERE directory_id = ? AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    sql += ' ORDER BY id DESC'
    const result = await this.executeQuery<DocumentEntity>(sql, params)
    return Array.isArray(result) ? result : []
  }

  public async searchByDirectoryId(params: {
    directoryId: string
    pageNumber: number
    pageSize: number
    keyword: string | null
    period?: { start: Date; end: Date }
  }): Promise<{ items: DocumentEntity[]; total: number; pages: number }> {
    const sc = this.scopeFilter()
    const { directoryId, pageNumber, pageSize, keyword, period } = params

    const where: string[] = ['directory_id = ?', '(deleted IS NULL OR deleted = 0)']
    const values: unknown[] = [directoryId, ...sc.params]

    if (sc.sql) {
      where.push(sc.sql)
    }

    const trimmedKeyword = keyword?.trim() ?? ''
    if (trimmedKeyword) {
      where.push('name LIKE ?')
      values.push(`%${trimmedKeyword}%`)
    }

    if (period) {
      where.push('create_time >= ? AND create_time <= ?')
      values.push(period.start, period.end)
    }

    const whereSql = `WHERE ${where.join(' AND ')}`

    const offset = (pageNumber - 1) * pageSize

    const countSql = `SELECT COUNT(*) as total FROM ${this.tableName} ${whereSql}`
    const countResult = await this.executeQuery<{ total: number }>(countSql, values)
    const total = Array.isArray(countResult) && countResult[0]?.total !== undefined ? countResult[0].total : 0

    const sql = `SELECT * FROM ${this.tableName} ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
    const itemsResult = await this.executeQuery<DocumentEntity>(sql, [...values, pageSize, offset])
    const items = Array.isArray(itemsResult) ? itemsResult : []

    const pages = Math.ceil(total / pageSize)
    return { items, total, pages }
  }

  public async createDocument(data: Partial<DocumentEntity>): Promise<DocumentEntity> {
    const tenant_id = this.getTenantId()
    const audit = this.getAuditInfo()
    const now = formatMysqlDateTimeShanghai()

    const payload: Partial<DocumentEntity> = {
      ...data,
      id: resolveKbRecordId(data.id),
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
    }

    const keys = Object.keys(payload) as Array<keyof DocumentEntity>
    const values = keys.map((key) => payload[key])
    const placeholders = keys.map(() => '?').join(', ')
    const sql = `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`
    this.logger.info(`Creating document record: ${String(payload.name ?? '')}`)
    await this.executeQuery(sql, values)
    return (await this.findById(payload.id!)) as DocumentEntity
  }

  public override async update(id: string | number, data: Partial<DocumentEntity>): Promise<DocumentEntity> {
    const sc = this.scopeFilter()
    const audit = this.getAuditInfo()
    const now = formatMysqlDateTimeShanghai()
    const patch: Partial<DocumentEntity> = {
      ...data,
      update_time: now as unknown as Date,
      update_by: audit.by,
      updater_id: audit.id,
      updater_type: audit.type,
    }
    const keys = Object.keys(patch)
    const values = Object.values(patch)
    const params: unknown[] = [...values, id, ...sc.params]
    let sql = `UPDATE ${this.tableName} SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE ${this.primaryKey} = ? AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    await this.executeQuery(sql, params)
    return (await this.findById(id)) as DocumentEntity
  }

  public async logicalDelete(id: string | number): Promise<boolean> {
    const sc = this.scopeFilter()
    const audit = this.getAuditInfo()
    const params: unknown[] = [
      Date.now(),
      audit.by,
      audit.id,
      audit.type,
      formatMysqlDateTimeShanghai(),
      id,
      ...sc.params,
    ]
    let sql = `UPDATE ${this.tableName} SET deleted = ?, status = 'deleted', update_by = ?, updater_id = ?, updater_type = ?, update_time = ? WHERE ${this.primaryKey} = ?`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    await this.executeQuery(sql, params)
    return true
  }

  /**
   * 批量累加文档召回次数（按 documentId -> delta）。
   */
  public async incrementRecallCount(deltas: Map<string, number>): Promise<void> {
    const entries = Array.from(deltas.entries()).filter(([, delta]) => Number.isFinite(delta) && delta > 0)
    if (entries.length === 0) {
      return
    }
    const sc = this.scopeFilter()
    const ids = entries.map(([id]) => id)
    const placeholders = ids.map(() => '?').join(', ')
    const caseSql = entries.map(() => 'WHEN ? THEN ?').join(' ')
    const params: unknown[] = []
    for (const [id, delta] of entries) {
      params.push(id, delta)
    }
    params.push(...ids, ...sc.params)

    let sql = `UPDATE ${this.tableName} SET recall_count = recall_count + (CASE ${this.primaryKey} ${caseSql} ELSE 0 END) WHERE ${this.primaryKey} IN (${placeholders}) AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    await this.executeQuery(sql, params)
  }
}
