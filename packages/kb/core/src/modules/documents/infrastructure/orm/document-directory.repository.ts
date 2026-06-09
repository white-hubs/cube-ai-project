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
import { formatMysqlDateTimeShanghai } from '../../../common/mysql-datetime'
import { DocumentDirectoryEntity } from './document-directory.entity'

@Repository('document_directory_record', 'id')
@Injectable()
export class DocumentDirectoryRepositoryOrm extends BaseRepository<DocumentDirectoryEntity> {
  protected override tableName = 'document_directory_record'
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

  public async createDirectory(data: {
    name: string
    description?: string | null
    icon?: string | null
  }): Promise<DocumentDirectoryEntity> {
    const tenant_id = this.getTenantId()
    const audit = this.getAuditInfo()
    const now = formatMysqlDateTimeShanghai()

    const payload: Omit<DocumentDirectoryEntity, 'id'> = {
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
      name: data.name,
      description: data.description ?? null,
      icon: data.icon ?? null,
    }

    const keys = Object.keys(payload) as Array<keyof typeof payload>
    const values = keys.map((key) => payload[key])
    const placeholders = keys.map(() => '?').join(', ')
    const sql = `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`
    this.logger.info(`Creating directory record: ${String(payload.name)}`)
    await this.executeQuery(sql, values)

    const lastIdResult = await this.executeQuery<{ id: number }>('SELECT LAST_INSERT_ID() as id')
    const lastId = Array.isArray(lastIdResult) && lastIdResult[0] ? lastIdResult[0].id : null
    return lastId !== null ? ((await this.findById(lastId)) as DocumentDirectoryEntity) : (payload as unknown as DocumentDirectoryEntity)
  }

  public override async findAll(): Promise<DocumentDirectoryEntity[]> {
    const sc = this.scopeFilter()
    const params: unknown[] = [...sc.params]
    let sql = `SELECT * FROM ${this.tableName} WHERE (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    sql += ' ORDER BY id DESC'

    const result = await this.executeQuery<DocumentDirectoryEntity>(sql, params)
    return Array.isArray(result) ? result : []
  }

  public override async findById(id: string | number): Promise<DocumentDirectoryEntity | null> {
    const sc = this.scopeFilter()
    const params: unknown[] = [id, ...sc.params]
    let sql = `SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = ? AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    const result = await this.executeQuery<DocumentDirectoryEntity>(sql, params)
    return Array.isArray(result) && result[0] ? (result[0] as DocumentDirectoryEntity) : null
  }

  public async searchDirectories(params: {
    pageNumber: number
    pageSize: number
    keyword: string | null
    period?: { start: Date; end: Date }
  }): Promise<{ items: DocumentDirectoryEntity[]; total: number }> {
    const sc = this.scopeFilter()
    const { pageNumber, pageSize, keyword, period } = params

    const where: string[] = ['(deleted IS NULL OR deleted = 0)']
    const values: unknown[] = [...sc.params]

    if (sc.sql) {
      where.push(sc.sql)
    }

    const trimmedKeyword = keyword?.trim() ?? ''
    if (trimmedKeyword) {
      where.push('(name LIKE ? OR description LIKE ?)')
      const like = `%${trimmedKeyword}%`
      values.push(like, like)
    }

    if (period) {
      where.push('create_time >= ? AND create_time <= ?')
      values.push(period.start, period.end)
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

    const offset = (pageNumber - 1) * pageSize
    const countSql = `SELECT COUNT(*) as total FROM ${this.tableName} ${whereSql}`
    const countResult = await this.executeQuery<{ total: number }>(countSql, values)
    const total = Array.isArray(countResult) && countResult[0]?.total !== undefined ? countResult[0].total : 0

    const sql = `SELECT * FROM ${this.tableName} ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
    const itemsResult = await this.executeQuery<DocumentDirectoryEntity>(sql, [...values, pageSize, offset])
    const items = Array.isArray(itemsResult) ? itemsResult : []

    return { items, total }
  }

  public async updateDirectory(
    id: string | number,
    data: { name?: string; description?: string | null; icon?: string | null },
  ): Promise<DocumentDirectoryEntity> {
    const sc = this.scopeFilter()
    const audit = this.getAuditInfo()
    const now = formatMysqlDateTimeShanghai()
    const patch: Record<string, unknown> = {
      update_time: now,
      update_by: audit.by,
      updater_id: audit.id,
      updater_type: audit.type,
    }
    if (data.name !== undefined) {
      patch.name = data.name
    }
    if (data.description !== undefined) {
      patch.description = data.description
    }
    if (data.icon !== undefined) {
      patch.icon = data.icon
    }
    const keys = Object.keys(patch)
    const values = Object.values(patch)
    const params: unknown[] = [...values, id, ...sc.params]
    let sql = `UPDATE ${this.tableName} SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE ${this.primaryKey} = ? AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    await this.executeQuery(sql, params)
    return (await this.findById(id)) as DocumentDirectoryEntity
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
    let sql = `UPDATE ${this.tableName} SET deleted = ?, update_by = ?, updater_id = ?, updater_type = ?, update_time = ? WHERE ${this.primaryKey} = ? AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    await this.executeQuery(sql, params)
    return true
  }
}

