import { loadAppConfig, type AppConfig } from '@cube-ai/server-base'
import { currentTenantId } from '@cube-ai/server-shared'
import mysql, { type Connection } from 'mysql2/promise'

/** Minimal query surface backing the flow_studio_* repositories (mirrors flow-core MysqlQueryService). */
export interface MysqlQueryService {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] | Promise<T[]>
}

export class StudioTenantError extends Error {
  constructor(message = '缺少租户上下文') {
    super(message)
    this.name = 'StudioTenantError'
  }
}

/** Resolve the effective tenant id: explicit arg wins, else current tenant context. Throws if neither present. */
export function resolveTenantId(explicit?: string | null): string {
  const candidate = (explicit ?? currentTenantId() ?? '').trim()
  if (!candidate) {
    throw new StudioTenantError()
  }
  return candidate
}

export function deletedValue(): string {
  return String(Date.now())
}

export function formatMysqlDateTimeShanghai(date: Date = new Date()): string {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false })
}

function normalizeDateValue(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return String(value)
}

function strOrNull(value: unknown): string | null {
  return value == null || value === '' ? null : String(value)
}

function boolOrNull(value: unknown): boolean | null {
  if (value == null) return null
  if (typeof value === 'boolean') return value
  return Number(value) !== 0
}

export const STUDIO_AUDIT = {
  by: 'system',
  id: null as string | null,
  type: null as string | null,
}

export function normalizeAudit(row: Record<string, unknown>) {
  return {
    create_by: String(row['create_by'] ?? 'system'),
    creator_id: strOrNull(row['creator_id']),
    creator_type: strOrNull(row['creator_type']),
    update_by: String(row['update_by'] ?? 'system'),
    updater_id: strOrNull(row['updater_id']),
    updater_type: strOrNull(row['updater_type']),
  }
}

export const rowHelpers = { normalizeDateValue, strOrNull, boolOrNull }

/** Shared base for studio repositories: thin async query helpers over the injected query service. */
export class StudioRepositoryBase {
  constructor(protected readonly databaseService: MysqlQueryService) {}

  protected async q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = this.databaseService.query<T>(sql, params)
    const rows = result instanceof Promise ? await result : result
    return Array.isArray(rows) ? rows : []
  }

  protected async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.q<T>(sql, params)
    return rows[0] ?? null
  }

  protected async exec(sql: string, params: unknown[] = []): Promise<void> {
    await this.q(sql, params)
  }
}

/** mysql2-backed query service, constructed once from AppConfig (mirrors flow-core Mysql2FlowQueryService). */
export class Mysql2StudioQueryService implements MysqlQueryService {
  private connection: Connection | null = null

  public constructor(private readonly config: AppConfig) {}

  public async initialize(): Promise<void> {
    if (this.connection) return
    this.connection = await mysql.createConnection({
      host: this.config.mysqlHost,
      port: this.config.mysqlPort,
      database: this.config.mysqlDatabase,
      user: this.config.mysqlUsername,
      password: this.config.mysqlPassword,
      supportBigNumbers: true,
      bigNumberStrings: true,
    })
    await this.connection.query("SET time_zone = '+08:00'")
  }

  public async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.connection) {
      throw new Error('Flow Studio MySQL connection is not initialized')
    }
    const [rows] = await this.connection.query(sql, params)
    return Array.isArray(rows) ? (rows as T[]) : []
  }
}

let _service: Mysql2StudioQueryService | null = null
let _servicePromise: Promise<Mysql2StudioQueryService> | null = null

export async function getStudioQueryService(config?: AppConfig): Promise<Mysql2StudioQueryService> {
  if (_service) return _service
  if (_servicePromise) return _servicePromise
  _servicePromise = (async () => {
    const cfg = config ?? (await loadAppConfig())
    const svc = new Mysql2StudioQueryService(cfg)
    await svc.initialize()
    _service = svc
    return svc
  })()
  try {
    return await _servicePromise
  } finally {
    _servicePromise = null
  }
}
