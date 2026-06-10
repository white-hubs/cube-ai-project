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
import { ImportJobEntity } from './import-job.entity'

@Repository('document_import_job', 'id')
@Injectable()
export class ImportJobRepositoryOrm extends BaseRepository<ImportJobEntity> {
  protected override tableName = 'document_import_job'
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

  public async createJob(data: Partial<ImportJobEntity>): Promise<ImportJobEntity> {
    const tenant_id = this.getTenantId()
    const audit = this.getAuditInfo()
    const now = formatMysqlDateTimeShanghai()

    const payload: Partial<ImportJobEntity> = {
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

    const keys = Object.keys(payload) as Array<keyof ImportJobEntity>
    const values = keys.map((key) => payload[key])
    const placeholders = keys.map(() => '?').join(', ')
    const sql = `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`
    this.logger.info(`Creating import job for document: ${String(payload.document_id ?? '')}`)
    await this.executeQuery(sql, values)
    return (await this.findById(payload.id!)) as ImportJobEntity
  }

  public override async findById(id: string | number): Promise<ImportJobEntity | null> {
    const sc = this.scopeFilter()
    const params: unknown[] = [id, ...sc.params]
    let sql = `SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = ? AND (deleted IS NULL OR deleted = 0)`
    if (sc.sql) {
      sql += ` AND ${sc.sql}`
    }
    const result = await this.executeQuery<ImportJobEntity>(sql, params)
    return Array.isArray(result) && result[0] ? (result[0] as ImportJobEntity) : null
  }

  public override async update(id: string | number, data: Partial<ImportJobEntity>): Promise<ImportJobEntity> {
    const sc = this.scopeFilter()
    const audit = this.getAuditInfo()
    const patch: Partial<ImportJobEntity> = {
      ...data,
      update_time: formatMysqlDateTimeShanghai() as unknown as Date,
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
    return (await this.findById(id)) as ImportJobEntity
  }
}
