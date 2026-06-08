import { Database } from 'bun:sqlite'
import { createHash, pbkdf2Sync, timingSafeEqual } from 'node:crypto'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { SnowflakeUtil } from '@cube-ai/server-base'
import { generateTenantProjectId, slugifyTenantProjectId, tenantSlugWithSuffix } from '@cube-ai/server-shared'

/** 软删时间戳（毫秒），与 MySQL `deleted` 列语义一致 */
function deletedValueMs(): number {
  return Date.now()
}

/** 与 MySQL 审计列一致；INSERT 可使用 DEFAULT，`insertApiKey` 等通过 `Omit<..., keyof AuditColumns>` 不要求调用方传入 */
export type AuditColumns = {
  create_by: string
  creator_id: string | null
  creator_type: string | null
  update_by: string
  updater_id: string | null
  updater_type: string | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT '',
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  langflow_flow_id TEXT,
  binding_status TEXT NOT NULL DEFAULT 'pending',
  cube_revision INTEGER NOT NULL DEFAULT 0,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  lf_snapshot_json TEXT,
  project_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS flow_graphs (
  flow_id TEXT PRIMARY KEY,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playground_sessions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  title TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  user_id TEXT,
  chat_history TEXT,
  last_message TEXT,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playground_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  seq INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES playground_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playground_messages_session ON playground_messages(session_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_playground_one_default_per_flow ON playground_sessions(flow_id) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS custom_component_templates (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  dsl_json TEXT NOT NULL,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  flow_id TEXT,
  scopes_json TEXT,
  project_id TEXT NOT NULL DEFAULT '',
  access_level TEXT NOT NULL DEFAULT 'project',
  expires_at TEXT,
  allowed_tools_json TEXT,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_algo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  role TEXT NOT NULL DEFAULT 'super_admin',
  default_project_id TEXT,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  scope_json TEXT,
  expires_at TEXT NOT NULL,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  access_token_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE,
  FOREIGN KEY (access_token_id) REFERENCES oauth_access_tokens(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oauth_access_token_hash ON oauth_access_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_token_hash ON oauth_refresh_tokens(token_hash);

CREATE TABLE IF NOT EXISTS webhook_invocations (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  source TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_webhook_invocations_flow ON webhook_invocations(flow_id, create_time);

CREATE TABLE IF NOT EXISTS app_kv (
  key TEXT PRIMARY KEY,
  create_by TEXT NOT NULL DEFAULT 'system',
  creator_id TEXT,
  creator_type TEXT,
  create_time TEXT NOT NULL,
  update_by TEXT NOT NULL DEFAULT 'system',
  updater_id TEXT,
  updater_type TEXT,
  update_time TEXT NOT NULL,
  value_json TEXT NOT NULL
);
`

export type ProjectRow = AuditColumns & {
  id: string
  /** 租户标识（与 X-Project-Id 对齐；子表 project_id 存此值） */
  project_id: string
  name: string
  description: string
  create_time: string
  update_time: string
}

export type FlowRow = AuditColumns & {
  id: string
  name: string
  description: string
  langflow_flow_id: string | null
  binding_status: string
  cube_revision: number
  create_time: string
  update_time: string
  lf_snapshot_json: string | null
  project_id: string
}

export type PlaygroundSessionRow = AuditColumns & {
  id: string
  flow_id: string
  title: string | null
  is_default: number
  user_id?: string | null
  chat_history?: string | null
  last_message?: string | null
  create_time: string
  update_time: string
}

export type PlaygroundMessageRow = AuditColumns & {
  id: string
  session_id: string
  role: string
  content: string
  seq: number
  create_time: string
  update_time: string
}


export type CustomComponentTemplateRow = AuditColumns & {
  id: string
  display_name: string
  dsl_json: string
  create_time: string
  update_time: string
  project_id: string
}

export type ApiKeyRow = AuditColumns & {
  id: string
  name: string
  key_hash: string
  key_prefix: string
  flow_id: string | null
  scopes_json: string | null
  project_id: string
  access_level: 'project' | 'system'
  create_time: string
  update_time: string
  /** 0 表示未删除；非 0 为软删时间戳（毫秒），与 MySQL `deleted` 一致 */
  deleted: number
  last_used_at: string | null
  expires_at: string | null
  allowed_tools_json: string | null
}

export type AuthUserRow = AuditColumns & {
  id: string
  username: string
  password_hash: string
  password_algo: string
  status: string
  role: string
  default_project_id: string | null
  create_time: string
  update_time: string
}

export type OAuthAccessTokenRow = AuditColumns & {
  id: string
  token_hash: string
  user_id: string
  username: string
  role: string
  scope_json: string | null
  expires_at: string
  create_time: string
  update_time: string
  deleted: number
}

export type OAuthRefreshTokenRow = AuditColumns & {
  id: string
  token_hash: string
  user_id: string
  access_token_id: string
  expires_at: string
  create_time: string
  update_time: string
  deleted: number
}

export type ApiKeySummary = {
  id: string
  name: string
  key_prefix: string
  flow_id: string | null
  scopes: string[]
  allowed_tools: string[]
  project_id: string | null
  access_level: 'project' | 'system'
  expires_at: string | null
  create_time: string
  last_used_at: string | null
}

/** 内置系统级 Developer API Key 的固定主键（数字字符串，兼容 MySQL BIGINT）。 */
export const BUILTIN_SYSTEM_API_KEY_ID = '1'

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

export function hashOpaqueToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

export function randomOpaqueToken(prefix: string): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `${prefix}_${Buffer.from(bytes).toString('base64url')}`
}

export function hashPassword(raw: string): string {
  const salt = Buffer.alloc(16)
  crypto.getRandomValues(salt)
  const iterations = 210_000
  const derived = pbkdf2Sync(raw, salt, iterations, 32, 'sha256')
  return `pbkdf2_sha256$${iterations}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export function verifyPassword(raw: string, encoded: string): boolean {
  const [algo, iterationsRaw, saltRaw, digestRaw] = encoded.split('$')
  if (algo !== 'pbkdf2_sha256' || !iterationsRaw || !saltRaw || !digestRaw) return false
  const iterations = Number(iterationsRaw)
  if (!Number.isFinite(iterations) || iterations <= 0) return false
  const salt = Buffer.from(saltRaw, 'base64url')
  const expected = Buffer.from(digestRaw, 'base64url')
  const actual = pbkdf2Sync(raw, salt, iterations, expected.length, 'sha256')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function randomApiKeySecret(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const b64 = Buffer.from(bytes).toString('base64url')
  return `sk_${b64}`
}

export interface FlowRepositorySeedConfig {
  superAdminUsername?: string
  superAdminPassword?: string
  builtinSystemApiKey?: string
}

export class FlowRepository {
  private readonly seedConfig: FlowRepositorySeedConfig

  constructor(public readonly db: Database, seedConfig?: FlowRepositorySeedConfig) {
    this.seedConfig = seedConfig ?? {}
    this.db.run(SCHEMA)
    this.migrateLegacyTimestampColumns()
    this.migrateApiKeysColumns()
    this.migrateRevokedAtToDeleted()
    this.migrateAuditColumns()
    this.migrateProjectColumns()
    this.migrateAuthColumns()
    this.migratePlaygroundSessionColumns()
    this.ensureSuperAdminSeed()
    this.ensureBuiltinSystemApiKey()
  }

  /** 通过路径打开（或创建）SQLite 数据库并初始化仓储。 */
  static open(dbPath: string, seedConfig?: FlowRepositorySeedConfig): FlowRepository {
    mkdirSync(dirname(dbPath), { recursive: true })
    const db = new Database(dbPath, { create: true })
    db.run('PRAGMA journal_mode=WAL')
    db.run('PRAGMA foreign_keys=ON')
    return new FlowRepository(db, seedConfig)
  }

  /** SQLite 轻量迁移（已有库缺列时补齐）。 */
  private migrateApiKeysColumns(): void {
    const rows = this.db.query(`PRAGMA table_info(api_keys)`).all() as Array<{ name: string }>
    const names = new Set(rows.map((r) => r.name))
    const tryAdd = (sql: string) => {
      try {
        this.db.run(sql)
      } catch {
        /* 列已存在或表不存在 */
      }
    }
    if (!names.has('expires_at')) tryAdd(`ALTER TABLE api_keys ADD COLUMN expires_at TEXT`)
    if (!names.has('allowed_tools_json')) tryAdd(`ALTER TABLE api_keys ADD COLUMN allowed_tools_json TEXT`)
    if (!names.has('project_id')) tryAdd(`ALTER TABLE api_keys ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`)
    if (!names.has('access_level')) tryAdd(`ALTER TABLE api_keys ADD COLUMN access_level TEXT NOT NULL DEFAULT 'project'`)
    this.db.run(`UPDATE api_keys SET access_level = 'project' WHERE access_level IS NULL OR TRIM(access_level) = ''`)
  }

  /** 旧库 `revoked_at` → `deleted`（毫秒时间戳），并补齐 `update_time`。 */
  private migrateRevokedAtToDeleted(): void {
    const tryAdd = (sql: string) => {
      try {
        this.db.run(sql)
      } catch {
        /* ignore */
      }
    }
    const tryDropRevoked = (table: string) => {
      if (!this.tableColumnNames(table).has('revoked_at')) return
      try {
        this.db.run(`ALTER TABLE ${table} DROP COLUMN revoked_at`)
      } catch {
        /* ignore */
      }
    }
    const migrateTable = (table: string) => {
      let cols = this.tableColumnNames(table)
      if (!cols.has('deleted')) tryAdd(`ALTER TABLE ${table} ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`)
      if (!cols.has('update_time')) tryAdd(`ALTER TABLE ${table} ADD COLUMN update_time TEXT NOT NULL DEFAULT ''`)
      this.db.run(
        `UPDATE ${table} SET update_time = create_time WHERE update_time = '' OR update_time IS NULL`,
      )
      cols = this.tableColumnNames(table)
      if (!cols.has('revoked_at')) return
      const rows = this.db
        .query(`SELECT id, revoked_at FROM ${table} WHERE revoked_at IS NOT NULL`)
        .all() as Array<{ id: string; revoked_at: string }>
      for (const r of rows) {
        const ms = Date.parse(r.revoked_at)
        const del = Number.isFinite(ms) ? ms : Date.now()
        this.db.run(`UPDATE ${table} SET deleted = ? WHERE id = ?`, [del, r.id])
      }
      tryDropRevoked(table)
    }
    migrateTable('api_keys')
    migrateTable('oauth_access_tokens')
    migrateTable('oauth_refresh_tokens')
  }

  /** 存量库补齐与 MySQL 一致的审计列，以及 flow_graphs / messages 等表的 `create_time`/`update_time`。 */
  private migrateAuditColumns(): void {
    const tryAdd = (sql: string) => {
      try {
        this.db.run(sql)
      } catch {
        /* ignore */
      }
    }
    const addAudit = (table: string) => {
      if (this.tableColumnNames(table).size === 0) return
      const c = this.tableColumnNames(table)
      if (!c.has('create_by')) tryAdd(`ALTER TABLE ${table} ADD COLUMN create_by TEXT NOT NULL DEFAULT 'system'`)
      if (!c.has('creator_id')) tryAdd(`ALTER TABLE ${table} ADD COLUMN creator_id TEXT`)
      if (!c.has('creator_type')) tryAdd(`ALTER TABLE ${table} ADD COLUMN creator_type TEXT`)
      if (!c.has('update_by')) tryAdd(`ALTER TABLE ${table} ADD COLUMN update_by TEXT NOT NULL DEFAULT 'system'`)
      if (!c.has('updater_id')) tryAdd(`ALTER TABLE ${table} ADD COLUMN updater_id TEXT`)
      if (!c.has('updater_type')) tryAdd(`ALTER TABLE ${table} ADD COLUMN updater_type TEXT`)
    }
    for (const t of [
      'projects',
      'flows',
      'flow_graphs',
      'playground_sessions',
      'playground_messages',
      'custom_component_templates',
      'api_keys',
      'auth_users',
      'oauth_access_tokens',
      'oauth_refresh_tokens',
      'webhook_invocations',
      'app_kv',
    ]) {
      addAudit(t)
    }

    const fg = this.tableColumnNames('flow_graphs')
    if (fg.size > 0) {
      if (!fg.has('create_time')) tryAdd(`ALTER TABLE flow_graphs ADD COLUMN create_time TEXT NOT NULL DEFAULT ''`)
      if (!fg.has('update_time')) tryAdd(`ALTER TABLE flow_graphs ADD COLUMN update_time TEXT NOT NULL DEFAULT ''`)
      this.db.run(
        `UPDATE flow_graphs SET create_time = datetime('now') WHERE create_time = '' OR create_time IS NULL`,
      )
      this.db.run(`UPDATE flow_graphs SET update_time = create_time WHERE update_time = '' OR update_time IS NULL`)
    }

    const pm = this.tableColumnNames('playground_messages')
    if (pm.size > 0 && !pm.has('update_time')) {
      tryAdd(`ALTER TABLE playground_messages ADD COLUMN update_time TEXT NOT NULL DEFAULT ''`)
      this.db.run(
        `UPDATE playground_messages SET update_time = create_time WHERE update_time = '' OR update_time IS NULL`,
      )
    }


    const akv = this.tableColumnNames('app_kv')
    if (akv.size > 0 && !akv.has('create_time')) {
      tryAdd(`ALTER TABLE app_kv ADD COLUMN create_time TEXT NOT NULL DEFAULT ''`)
      this.db.run(`UPDATE app_kv SET create_time = update_time WHERE create_time = '' OR create_time IS NULL`)
    }
  }

  private tableColumnNames(table: string): Set<string> {
    try {
      const rows = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      return new Set(rows.map((r) => r.name))
    } catch {
      return new Set()
    }
  }

  /** 存量库：`created_at`/`updated_at` 重命名为 `create_time`/`update_time`；`flows` 补 `create_time`。 */
  private migrateLegacyTimestampColumns(): void {
    const tryRename = (table: string, from: string, to: string) => {
      const cols = this.tableColumnNames(table)
      if (!cols.has(from) || cols.has(to)) return
      try {
        this.db.run(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`)
      } catch {
        /* ignore */
      }
    }
    const tables = [
      'projects',
      'flows',
      'playground_sessions',
      'playground_messages',
      'custom_component_templates',
      'api_keys',
      'auth_users',
      'oauth_access_tokens',
      'oauth_refresh_tokens',
      'webhook_invocations',
      'app_kv',
    ]
    for (const t of tables) {
      tryRename(t, 'created_at', 'create_time')
      tryRename(t, 'updated_at', 'update_time')
    }
    const fc = this.tableColumnNames('flows')
    if (fc.has('update_time') && !fc.has('create_time')) {
      try {
        this.db.run(`ALTER TABLE flows ADD COLUMN create_time TEXT NOT NULL DEFAULT ''`)
        this.db.run(`UPDATE flows SET create_time = update_time WHERE create_time = '' OR create_time IS NULL`)
      } catch {
        /* ignore */
      }
    }
  }

  /** 补齐 projects 表与各资源 project_id 列，并回填默认项目。 */
  private migrateProjectColumns(): void {
    const tryRun = (sql: string) => {
      try {
        this.db.run(sql)
      } catch {
        /* ignore */
      }
    }
    tryRun(`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT '',
      create_by TEXT NOT NULL DEFAULT 'system',
      creator_id TEXT,
      creator_type TEXT,
      create_time TEXT NOT NULL,
      update_by TEXT NOT NULL DEFAULT 'system',
      updater_id TEXT,
      updater_type TEXT,
      update_time TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    )`)

    const projCols0 = this.tableColumnNames('projects')
    if (!projCols0.has('project_id')) {
      tryRun(`ALTER TABLE projects ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`)
    }

    const flowsCols = this.tableColumnNames('flows')
    if (!flowsCols.has('project_id')) {
      tryRun(`ALTER TABLE flows ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`)
    }

    const apiCols = this.tableColumnNames('api_keys')
    if (apiCols.has('tenant_scope') && apiCols.has('project_id')) {
      tryRun(
        `UPDATE api_keys SET project_id = TRIM(tenant_scope) WHERE (project_id = '' OR project_id IS NULL) AND tenant_scope IS NOT NULL AND TRIM(tenant_scope) != ''`,
      )
    }

    const tplCols = this.tableColumnNames('custom_component_templates')
    if (!tplCols.has('project_id')) {
      tryRun(`ALTER TABLE custom_component_templates ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`)
    }

    const whCols = this.tableColumnNames('webhook_invocations')
    if (!whCols.has('project_id')) {
      tryRun(`ALTER TABLE webhook_invocations ADD COLUMN project_id TEXT NOT NULL DEFAULT ''`)
    }

    const flowsCols2 = this.tableColumnNames('flows')
    if (flowsCols2.has('project_id')) {
      tryRun(`CREATE INDEX IF NOT EXISTS idx_flows_project ON flows(project_id)`)
    }

    this.backfillProjectsTenantIds()
    this.ensureDefaultProjectMigration()
  }

  /** 为存量 projects 行写入租户 project_id，并把子表 project_id 从内部 id 切到租户 id。 */
  private backfillProjectsTenantIds(): void {
    const rows = this.db
      .query(`SELECT id, name, project_id FROM projects`)
      .all() as Array<{ id: string; name: string; project_id: string }>
    const used = new Set(rows.map((r) => r.project_id).filter((p) => p.trim() !== ''))
    for (const r of rows) {
      let tenant = (r.project_id ?? '').trim()
      if (tenant) continue
      let base = slugifyTenantProjectId(r.name)
      let candidate = base || 'project'
      let n = 0
      while (used.has(candidate)) {
        n += 1
        candidate = tenantSlugWithSuffix(base || 'project', n)
      }
      used.add(candidate)
      this.db.run(`UPDATE projects SET project_id = ? WHERE id = ?`, [candidate, r.id])
      this.db.run(`UPDATE flows SET project_id = ? WHERE project_id = ?`, [candidate, r.id])
      this.db.run(
        `UPDATE api_keys SET project_id = ? WHERE project_id = ? AND COALESCE(access_level, 'project') != 'system'`,
        [candidate, r.id],
      )
      this.db.run(`UPDATE custom_component_templates SET project_id = ? WHERE project_id = ?`, [candidate, r.id])
      this.db.run(`UPDATE webhook_invocations SET project_id = ? WHERE project_id = ?`, [candidate, r.id])
      this.db.run(`UPDATE auth_users SET default_project_id = ? WHERE default_project_id = ?`, [candidate, r.id])
    }
  }

  private migrateAuthColumns(): void {
    const tryAdd = (sql: string) => {
      try {
        this.db.run(sql)
      } catch {
        /* ignore */
      }
    }
    const authUserCols = this.tableColumnNames('auth_users')
    if (!authUserCols.has('role')) {
      tryAdd(`ALTER TABLE auth_users ADD COLUMN role TEXT NOT NULL DEFAULT 'super_admin'`)
    }
    if (!authUserCols.has('default_project_id')) {
      tryAdd(`ALTER TABLE auth_users ADD COLUMN default_project_id TEXT`)
    }
    const accessCols = this.tableColumnNames('oauth_access_tokens')
    if (!accessCols.has('scope_json')) {
      tryAdd(`ALTER TABLE oauth_access_tokens ADD COLUMN scope_json TEXT`)
    }
  }

  private migratePlaygroundSessionColumns(): void {
    const tryAdd = (sql: string) => {
      try {
        this.db.run(sql)
      } catch {
        /* ignore */
      }
    }
    const cols = this.tableColumnNames('playground_sessions')
    if (!cols.has('user_id')) {
      tryAdd(`ALTER TABLE playground_sessions ADD COLUMN user_id TEXT`)
    }
    if (!cols.has('chat_history')) {
      tryAdd(`ALTER TABLE playground_sessions ADD COLUMN chat_history TEXT`)
    }
    if (!cols.has('last_message')) {
      tryAdd(`ALTER TABLE playground_sessions ADD COLUMN last_message TEXT`)
    }
  }

  private ensureDefaultProjectMigration(): void {
    const countRow = this.db.query(`SELECT COUNT(1) as c FROM projects`).get() as { c: number } | undefined
    if ((countRow?.c ?? 0) === 0) {
      const id = SnowflakeUtil.nextId()
      const now = new Date().toISOString()
      this.db.run(
        `INSERT INTO projects (id, project_id, name, description, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, 'default', '默认项目', '', now, now],
      )
    }
    const first = this.db.query(`SELECT id, project_id FROM projects ORDER BY create_time ASC LIMIT 1`).get() as
      | { id: string; project_id: string }
      | undefined
    if (!first?.id) return
    const tenantPid = (first.project_id ?? '').trim() || first.id
    this.db.run(`UPDATE flows SET project_id = ? WHERE project_id = '' OR project_id IS NULL`, [tenantPid])
    this.db.run(
      `UPDATE api_keys SET project_id = ? WHERE (project_id = '' OR project_id IS NULL) AND COALESCE(access_level, 'project') != 'system'`,
      [tenantPid],
    )
    this.db.run(`UPDATE custom_component_templates SET project_id = ? WHERE project_id = '' OR project_id IS NULL`, [
      tenantPid,
    ])
    this.db.run(`UPDATE webhook_invocations SET project_id = ? WHERE project_id = '' OR project_id IS NULL`, [tenantPid])
  }

  /**
   * 当 `auth_users` 尚无任何用户时，写入一条内置超级管理员（`role = super_admin`）。
   * 用户名/明文密码来自环境变量；未设置时默认为 `admin` / `ChangeMe123!`（生产环境请务必通过
   * `CUBE_SUPER_ADMIN_PASSWORD` 覆盖，并在首次启动前配置好）。
   * 仅在表为空时执行一次；若库中已有用户，不会覆盖或重复插入。
   */
  private ensureSuperAdminSeed(): void {
    const countRow = this.db.query(`SELECT COUNT(1) as c FROM auth_users`).get() as { c: number } | undefined
    if ((countRow?.c ?? 0) > 0) return
    const defaultProject = this.db.query(`SELECT id, project_id FROM projects ORDER BY create_time ASC LIMIT 1`).get() as
      | { id: string; project_id: string }
      | undefined
    const now = new Date().toISOString()
    const username = this.seedConfig.superAdminUsername ?? process.env.CUBE_SUPER_ADMIN_USERNAME?.trim() ?? 'admin'
    const password = this.seedConfig.superAdminPassword ?? process.env.CUBE_SUPER_ADMIN_PASSWORD?.trim() ?? 'ChangeMe123!'
    const userId = SnowflakeUtil.nextId()
    const defaultTenant = defaultProject?.project_id?.trim()
      ? defaultProject.project_id.trim()
      : defaultProject?.id ?? null
    this.db.run(
      `INSERT INTO auth_users (id, username, password_hash, password_algo, status, role, default_project_id, create_time, update_time)
       VALUES (?, ?, ?, ?, 'active', 'super_admin', ?, ?, ?)`,
      [
        userId,
        username,
        hashPassword(password),
        'pbkdf2_sha256',
        defaultTenant,
        now,
        now,
      ],
    )
  }

  /**
   * 若不存在固定 id 的内置系统级 API Key，则插入一条（access_level = system，不绑定项目）。
   * 明文密钥由 `CUBE_AI_BUILTIN_SYSTEM_API_KEY` 提供；未设置时使用仅适用于本地开发的默认值，生产环境务必覆盖。
   */
  private ensureBuiltinSystemApiKey(): void {
    const row = this.db.query('SELECT id FROM api_keys WHERE id = ?').get(BUILTIN_SYSTEM_API_KEY_ID) as
      | { id: string }
      | undefined
    if (row) {
      this.db.run(`UPDATE api_keys SET scopes_json = ? WHERE id = ?`, [
        JSON.stringify(['run', 'kb', 'search', 'documents']),
        BUILTIN_SYSTEM_API_KEY_ID,
      ])
      return
    }
    const secret = this.seedConfig.builtinSystemApiKey ?? process.env.CUBE_AI_BUILTIN_SYSTEM_API_KEY?.trim() ?? 'sk_cube_builtin_system_ChangeMeInProduction'
    const now = new Date().toISOString()
    const prefix = secret.slice(0, 10)
    this.db.run(
      `INSERT INTO api_keys (id, name, key_hash, key_prefix, flow_id, scopes_json, project_id, access_level, expires_at, allowed_tools_json, create_time, update_time, deleted, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
      [
        BUILTIN_SYSTEM_API_KEY_ID,
        'Built-in system',
        hashApiKey(secret),
        prefix,
        null,
        JSON.stringify(['run', 'kb', 'search', 'documents']),
        '',
        'system',
        null,
        null,
        now,
        now,
      ],
    )
  }

  createFlow(
    projectId: string,
    row: Omit<FlowRow, 'lf_snapshot_json' | 'project_id'> & { lf_snapshot_json?: string | null },
    graphJson: string,
  ): void {
    const tx = this.db.transaction(() => {
      this.db.run(
        `INSERT INTO flows (id, name, description, langflow_flow_id, binding_status, cube_revision, create_time, update_time, lf_snapshot_json, project_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.name,
          row.description,
          row.langflow_flow_id,
          row.binding_status,
          row.cube_revision,
          row.create_time,
          row.update_time,
          row.lf_snapshot_json ?? null,
          projectId,
        ],
      )
      this.db.run(
        `INSERT INTO flow_graphs (flow_id, graph_json, create_time, update_time) VALUES (?, ?, ?, ?)`,
        [row.id, graphJson, row.create_time, row.update_time],
      )
    })
    tx()
  }

  updateFlowMeta(
    projectId: string,
    id: string,
    patch: Partial<Pick<FlowRow, 'name' | 'description' | 'langflow_flow_id' | 'binding_status'>>,
    bumpRevision: boolean,
  ): void {
    const now = new Date().toISOString()
    const row = this.getFlow(id, projectId)
    if (!row) return
    const rev = bumpRevision ? row.cube_revision + 1 : row.cube_revision
    this.db.run(
      `UPDATE flows SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        langflow_flow_id = COALESCE(?, langflow_flow_id),
        binding_status = COALESCE(?, binding_status),
        cube_revision = ?,
        update_time = ?,
        update_by = 'system'
      WHERE id = ? AND project_id = ?`,
      [
        patch.name ?? null,
        patch.description ?? null,
        patch.langflow_flow_id ?? null,
        patch.binding_status ?? null,
        rev,
        now,
        id,
        projectId,
      ],
    )
  }

  setLfSnapshot(projectId: string, id: string, json: string | null): void {
    const now = new Date().toISOString()
    this.db.run(
      `UPDATE flows SET lf_snapshot_json = ?, update_time = ?, update_by = 'system' WHERE id = ? AND project_id = ?`,
      [json, now, id, projectId],
    )
  }

  updateGraph(projectId: string, id: string, graphJson: string): void {
    const now = new Date().toISOString()
    this.db.run(`UPDATE flow_graphs SET graph_json = ?, update_time = ?, update_by = 'system' WHERE flow_id = ?`, [
      graphJson,
      now,
      id,
    ])
    this.db.run(
      `UPDATE flows SET update_time = ?, cube_revision = cube_revision + 1, update_by = 'system' WHERE id = ? AND project_id = ?`,
      [now, id, projectId],
    )
  }

  deleteFlow(projectId: string, id: string): void {
    this.db.run(`DELETE FROM flows WHERE id = ? AND project_id = ?`, [id, projectId])
  }

  listFlows(projectId?: string | null): FlowRow[] {
    if (!projectId || projectId.trim() === '') {
      return this.db.query('SELECT * FROM flows ORDER BY update_time DESC').all() as FlowRow[]
    }
    return this.db
      .query('SELECT * FROM flows WHERE project_id = ? ORDER BY update_time DESC')
      .all(projectId) as FlowRow[]
  }

  getFlow(id: string, projectId?: string | null): FlowRow | null {
    if (!projectId || projectId.trim() === '') {
      const r = this.db.query('SELECT * FROM flows WHERE id = ?').get(id) as FlowRow | undefined
      return r ?? null
    }
    const r = this.db
      .query('SELECT * FROM flows WHERE id = ? AND project_id = ?')
      .get(id, projectId) as FlowRow | undefined
    return r ?? null
  }

  /** 执行面：按 id 解析 flow，并校验属于给定 project（用于 API Key / webhook）。 */
  getFlowInProject(id: string, projectId: string): FlowRow | null {
    return this.getFlow(id, projectId)
  }

  countFlowsInProject(projectId: string): number {
    const r = this.db.query(`SELECT COUNT(1) as n FROM flows WHERE project_id = ?`).get(projectId) as
      | { n: number }
      | undefined
    return r?.n ?? 0
  }

  countApiKeysInProject(projectId: string): number {
    const r = this.db
      .query(`SELECT COUNT(1) as n FROM api_keys WHERE project_id = ? AND deleted = 0`)
      .get(projectId) as { n: number } | undefined
    return r?.n ?? 0
  }

  countCustomTemplatesInProject(projectId: string): number {
    const r = this.db
      .query(`SELECT COUNT(1) as n FROM custom_component_templates WHERE project_id = ?`)
      .get(projectId) as { n: number } | undefined
    return r?.n ?? 0
  }

  getGraphJson(flowId: string): string | null {
    const r = this.db
      .query('SELECT graph_json FROM flow_graphs WHERE flow_id = ?')
      .get(flowId) as { graph_json: string } | undefined
    return r?.graph_json ?? null
  }

  // --- Playground sessions (Cube-managed; not Langflow history) ---

  getPlaygroundSession(flowId: string, sessionId: string): PlaygroundSessionRow | null {
    const r = this.db
      .query(`SELECT * FROM playground_sessions WHERE id = ? AND flow_id = ?`)
      .get(sessionId, flowId) as PlaygroundSessionRow | undefined
    return r ?? null
  }

  listPlaygroundSessions(flowId: string): PlaygroundSessionRow[] {
    return this.db
      .query(
        `SELECT * FROM playground_sessions WHERE flow_id = ? ORDER BY is_default DESC, update_time DESC`,
      )
      .all(flowId) as PlaygroundSessionRow[]
  }

  /** Ensure one default session per flow; returns its id. */
  ensurePlaygroundDefaultSession(flowId: string): string {
    const row = this.db
      .query(`SELECT id FROM playground_sessions WHERE flow_id = ? AND is_default = 1`)
      .get(flowId) as { id: string } | undefined
    if (row) return row.id
    const id = SnowflakeUtil.nextId()
    const now = new Date().toISOString()
    this.db.run(
      `INSERT INTO playground_sessions (id, flow_id, title, is_default, create_time, update_time)
       VALUES (?, ?, NULL, 1, ?, ?)`,
      [id, flowId, now, now],
    )
    return id
  }

  createPlaygroundSession(
    flowId: string,
    opts: { title?: string | null; asDefault: boolean; userId?: string | null },
  ): string {
    const id = SnowflakeUtil.nextId()
    const now = new Date().toISOString()
    const tx = this.db.transaction(() => {
      if (opts.asDefault) {
        this.db.run(`UPDATE playground_sessions SET is_default = 0 WHERE flow_id = ?`, [flowId])
      }
      this.db.run(
        `INSERT INTO playground_sessions (id, flow_id, title, is_default, user_id, chat_history, last_message, create_time, update_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          flowId,
          opts.title ?? null,
          opts.asDefault ? 1 : 0,
          opts.userId ?? null,
          null,
          null,
          now,
          now,
        ],
      )
    })
    tx()
    return id
  }

  updatePlaygroundSession(
    flowId: string,
    sessionId: string,
    patch: Partial<{
      title: string | null
      is_default: number
      user_id: string | null
      chat_history: string | null
      last_message: string | null
      update_time: string
    }>,
  ): void {
    const keys = Object.keys(patch) as Array<keyof typeof patch>
    if (keys.length === 0) return
    const values = keys.map((key) => patch[key] ?? null)
    const setSql = keys.map((key) => `${key} = ?`).join(', ')
    this.db.run(`UPDATE playground_sessions SET ${setSql} WHERE id = ? AND flow_id = ?`, [...values, sessionId, flowId])
  }

  deletePlaygroundSession(flowId: string, sessionId: string): void {
    this.db.run(`DELETE FROM playground_sessions WHERE id = ? AND flow_id = ?`, [sessionId, flowId])
  }

  countPlaygroundMessages(sessionId: string): number {
    const r = this.db
      .query(`SELECT COUNT(1) as n FROM playground_messages WHERE session_id = ?`)
      .get(sessionId) as { n: number } | undefined
    return r?.n ?? 0
  }

  appendPlaygroundMessage(sessionId: string, role: 'user' | 'bot', content: string): void {
    const now = new Date().toISOString()
    const r = this.db
      .query(`SELECT COALESCE(MAX(seq), -1) as m FROM playground_messages WHERE session_id = ?`)
      .get(sessionId) as { m: number } | undefined
    const seq = (r?.m ?? -1) + 1
    this.db.run(
      `INSERT INTO playground_messages (session_id, role, content, seq, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, role, content, seq, now, now],
    )
    this.db.run(
      `UPDATE playground_sessions SET update_time = ?, last_message = ?, update_by = 'system' WHERE id = ?`,
      [now, content, sessionId],
    )
  }

  listPlaygroundMessages(sessionId: string): PlaygroundMessageRow[] {
    const raw = this.db
      .query(`SELECT * FROM playground_messages WHERE session_id = ? ORDER BY seq ASC`)
      .all(sessionId) as Array<Omit<PlaygroundMessageRow, 'id'> & { id: number | string }>
    return raw.map((r) => ({ ...r, id: String(r.id) }))
  }

  /**
   * After graph persist: if default session has messages, demote it and create a new empty default.
   */
  archiveDefaultPlaygroundSession(flowId: string, demotedTitle: string): void {
    const def = this.db
      .query(`SELECT id FROM playground_sessions WHERE flow_id = ? AND is_default = 1`)
      .get(flowId) as { id: string } | undefined
    if (!def) {
      this.ensurePlaygroundDefaultSession(flowId)
      return
    }
    const n = this.countPlaygroundMessages(def.id)
    if (n === 0) return
    const now = new Date().toISOString()
    const tx = this.db.transaction(() => {
      this.db.run(
        `UPDATE playground_sessions SET is_default = 0, title = COALESCE(NULLIF(TRIM(title), ''), ?), update_time = ?, update_by = 'system'
         WHERE id = ?`,
        [demotedTitle, now, def.id],
      )
      const nid = SnowflakeUtil.nextId()
      this.db.run(
        `INSERT INTO playground_sessions (id, flow_id, title, is_default, create_time, update_time)
         VALUES (?, ?, NULL, 1, ?, ?)`,
        [nid, flowId, now, now],
      )
    })
    tx()
  }

  listCustomComponentTemplates(projectId?: string | null): CustomComponentTemplateRow[] {
    if (!projectId || projectId.trim() === '') {
      return this.db
        .query(`SELECT * FROM custom_component_templates ORDER BY update_time DESC`)
        .all() as CustomComponentTemplateRow[]
    }
    return this.db
      .query(`SELECT * FROM custom_component_templates WHERE project_id = ? ORDER BY update_time DESC`)
      .all(projectId) as CustomComponentTemplateRow[]
  }

  getCustomComponentTemplate(id: string, projectId?: string | null): CustomComponentTemplateRow | null {
    if (!projectId || projectId.trim() === '') {
      const r = this.db
        .query(`SELECT * FROM custom_component_templates WHERE id = ?`)
        .get(id) as CustomComponentTemplateRow | undefined
      return r ?? null
    }
    const r = this.db
      .query(`SELECT * FROM custom_component_templates WHERE id = ? AND project_id = ?`)
      .get(id, projectId) as CustomComponentTemplateRow | undefined
    return r ?? null
  }

  insertCustomComponentTemplate(
    projectId: string,
    row: Omit<CustomComponentTemplateRow, 'create_time' | 'update_time' | 'project_id' | keyof AuditColumns>,
  ): void {
    const now = new Date().toISOString()
    this.db.run(
      `INSERT INTO custom_component_templates (id, display_name, dsl_json, create_time, update_time, project_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.display_name, row.dsl_json, now, now, projectId],
    )
  }

  updateCustomComponentTemplate(
    projectId: string,
    id: string,
    patch: Partial<Pick<CustomComponentTemplateRow, 'display_name' | 'dsl_json'>>,
  ): void {
    const row = this.getCustomComponentTemplate(id, projectId)
    if (!row) return
    const now = new Date().toISOString()
    const displayName = patch.display_name ?? row.display_name
    const dsl = patch.dsl_json ?? row.dsl_json
    this.db.run(
      `UPDATE custom_component_templates SET display_name = ?, dsl_json = ?, update_time = ?, update_by = 'system' WHERE id = ? AND project_id = ?`,
      [displayName, dsl, now, id, projectId],
    )
  }

  deleteCustomComponentTemplate(projectId: string, id: string): void {
    this.db.run(`DELETE FROM custom_component_templates WHERE id = ? AND project_id = ?`, [id, projectId])
  }

  // --- Developer API keys ---

  insertApiKey(row: Omit<ApiKeyRow, 'last_used_at' | 'deleted' | 'update_time' | keyof AuditColumns>): void {
    this.db.run(
      `INSERT INTO api_keys (id, name, key_hash, key_prefix, flow_id, scopes_json, project_id, access_level, expires_at, allowed_tools_json, create_time, update_time, deleted, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
      [
        row.id,
        row.name,
        row.key_hash,
        row.key_prefix,
        row.flow_id,
        row.scopes_json,
        row.project_id,
        row.access_level,
        row.expires_at,
        row.allowed_tools_json,
        row.create_time,
        row.create_time,
      ],
    )
  }

  listApiKeys(projectId?: string | null): ApiKeyRow[] {
    if (!projectId || projectId.trim() === '') {
      return this.db
        .query('SELECT * FROM api_keys WHERE deleted = 0 ORDER BY create_time DESC')
        .all() as ApiKeyRow[]
    }
    return this.db
      .query(
        'SELECT * FROM api_keys WHERE project_id = ? AND deleted = 0 ORDER BY create_time DESC',
      )
      .all(projectId) as ApiKeyRow[]
  }

  getApiKeyById(id: string, projectId?: string | null): ApiKeyRow | null {
    if (!projectId || projectId.trim() === '') {
      const r = this.db
        .query('SELECT * FROM api_keys WHERE id = ? AND deleted = 0')
        .get(id) as ApiKeyRow | undefined
      return r ?? null
    }
    const r = this.db
      .query('SELECT * FROM api_keys WHERE id = ? AND project_id = ? AND deleted = 0')
      .get(id, projectId) as ApiKeyRow | undefined
    return r ?? null
  }

  revokeApiKey(projectId: string | null | undefined, id: string): void {
    const del = deletedValueMs()
    const now = new Date().toISOString()
    if (!projectId || projectId.trim() === '') {
      this.db.run(
        `UPDATE api_keys SET deleted = ?, update_time = ?, update_by = 'system' WHERE id = ? AND deleted = 0`,
        [del, now, id],
      )
      return
    }
    this.db.run(
      `UPDATE api_keys SET deleted = ?, update_time = ?, update_by = 'system' WHERE id = ? AND project_id = ? AND deleted = 0`,
      [del, now, id, projectId],
    )
  }

  touchApiKeyUsage(id: string): void {
    const now = new Date().toISOString()
    this.db.run(`UPDATE api_keys SET last_used_at = ?, update_time = ?, update_by = 'system' WHERE id = ?`, [
      now,
      now,
      id,
    ])
  }

  /**
   * 校验原始密钥；返回行或 null。会更新 last_used_at。
   */
  verifyApiKeyRaw(rawSecret: string): ApiKeyRow | null {
    const h = hashApiKey(rawSecret)
    const r = this.db
      .query('SELECT * FROM api_keys WHERE key_hash = ? AND deleted = 0')
      .get(h) as ApiKeyRow | undefined
    if (!r) return null
    if (r.expires_at) {
      const exp = Date.parse(r.expires_at)
      if (Number.isFinite(exp) && exp < Date.now()) return null
    }
    this.touchApiKeyUsage(r.id)
    return r
  }

  listAuthUsers(): AuthUserRow[] {
    return this.db.query(`SELECT * FROM auth_users ORDER BY create_time ASC`).all() as AuthUserRow[]
  }

  createAuthUser(row: {
    id: string
    username: string
    passwordHash: string
    passwordAlgo: string
    role: string
    status: string
    defaultProjectId: string | null
  }): void {
    const now = new Date().toISOString()
    this.db.run(
      `INSERT INTO auth_users (id, username, password_hash, password_algo, status, role, default_project_id, create_time, update_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.username, row.passwordHash, row.passwordAlgo, row.status, row.role, row.defaultProjectId, now, now],
    )
  }

  updateAuthUser(id: string, fields: Partial<{ role: string; status: string; defaultProjectId: string | null }>): void {
    const now = new Date().toISOString()
    const sets: string[] = ['update_time = ?', `update_by = 'system'`]
    const params: (string | null)[] = [now]
    if (fields.role !== undefined) { sets.push('role = ?'); params.push(fields.role) }
    if (fields.status !== undefined) { sets.push('status = ?'); params.push(fields.status) }
    if ('defaultProjectId' in fields) { sets.push('default_project_id = ?'); params.push(fields.defaultProjectId ?? null) }
    params.push(id)
    this.db.run(`UPDATE auth_users SET ${sets.join(', ')} WHERE id = ?`, params)
  }

  updateAuthUserPassword(id: string, passwordHash: string, passwordAlgo: string): void {
    const now = new Date().toISOString()
    this.db.run(
      `UPDATE auth_users SET password_hash = ?, password_algo = ?, update_time = ?, update_by = 'system' WHERE id = ?`,
      [passwordHash, passwordAlgo, now, id],
    )
  }

  deleteAuthUser(id: string): void {
    this.db.run(`DELETE FROM auth_users WHERE id = ?`, [id])
  }

  getAuthUserByUsername(username: string): AuthUserRow | null {
    const row = this.db
      .query(`SELECT * FROM auth_users WHERE username = ?`)
      .get(username) as AuthUserRow | undefined
    return row ?? null
  }

  getAuthUserById(id: string): AuthUserRow | null {
    const row = this.db
      .query(`SELECT * FROM auth_users WHERE id = ?`)
      .get(id) as AuthUserRow | undefined
    return row ?? null
  }

  createAccessToken(row: Omit<OAuthAccessTokenRow, 'deleted' | 'update_time' | keyof AuditColumns>): void {
    this.db.run(
      `INSERT INTO oauth_access_tokens (id, token_hash, user_id, username, role, scope_json, expires_at, create_time, update_time, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        row.id,
        row.token_hash,
        row.user_id,
        row.username,
        row.role,
        row.scope_json,
        row.expires_at,
        row.create_time,
        row.create_time,
      ],
    )
  }

  createRefreshToken(row: Omit<OAuthRefreshTokenRow, 'deleted' | 'update_time' | keyof AuditColumns>): void {
    this.db.run(
      `INSERT INTO oauth_refresh_tokens (id, token_hash, user_id, access_token_id, expires_at, create_time, update_time, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        row.id,
        row.token_hash,
        row.user_id,
        row.access_token_id,
        row.expires_at,
        row.create_time,
        row.create_time,
      ],
    )
  }

  verifyAccessToken(rawToken: string): AuthUserRow | null {
    const tokenHash = hashOpaqueToken(rawToken)
    const token = this.db
      .query(
        `SELECT id, token_hash, user_id, username, role, scope_json, expires_at, create_time, update_time, deleted
         FROM oauth_access_tokens WHERE token_hash = ? AND deleted = 0`,
      )
      .get(tokenHash) as OAuthAccessTokenRow | undefined
    if (!token) return null
    const expiresAt = Date.parse(token.expires_at)
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) return null
    const user = this.getAuthUserById(token.user_id)
    if (!user || user.status !== 'active') return null
    return user
  }

  verifyRefreshToken(rawToken: string): { refresh: OAuthRefreshTokenRow; user: AuthUserRow } | null {
    const tokenHash = hashOpaqueToken(rawToken)
    const refresh = this.db
      .query(
        `SELECT id, token_hash, user_id, access_token_id, expires_at, create_time, update_time, deleted
         FROM oauth_refresh_tokens WHERE token_hash = ? AND deleted = 0`,
      )
      .get(tokenHash) as OAuthRefreshTokenRow | undefined
    if (!refresh) return null
    const expiresAt = Date.parse(refresh.expires_at)
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) return null
    const user = this.getAuthUserById(refresh.user_id)
    if (!user || user.status !== 'active') return null
    return { refresh, user }
  }

  revokeAccessToken(accessTokenId: string): void {
    const del = deletedValueMs()
    const now = new Date().toISOString()
    this.db.run(
      `UPDATE oauth_access_tokens SET deleted = ?, update_time = ?, update_by = 'system' WHERE id = ? AND deleted = 0`,
      [del, now, accessTokenId],
    )
  }

  revokeRefreshToken(refreshTokenId: string): void {
    const del = deletedValueMs()
    const now = new Date().toISOString()
    this.db.run(
      `UPDATE oauth_refresh_tokens SET deleted = ?, update_time = ?, update_by = 'system' WHERE id = ? AND deleted = 0`,
      [del, now, refreshTokenId],
    )
  }

  insertWebhookInvocation(row: {
    id: string
    flow_id: string
    project_id: string
    source: string | null
    payload_json: string
    status: string
    create_time: string
  }): void {
    const u = row.create_time
    this.db.run(
      `INSERT INTO webhook_invocations (id, flow_id, source, payload_json, status, create_time, update_time, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.flow_id, row.source, row.payload_json, row.status, row.create_time, u, row.project_id],
    )
  }

  getKv(key: string): string | null {
    const row = this.db
      .query<{ value_json: string }, [string]>(`SELECT value_json FROM app_kv WHERE key = ?`)
      .get(key)
    return row?.value_json ?? null
  }

  setKv(key: string, value: unknown): void {
    const now = new Date().toISOString()
    this.db.run(
      `INSERT INTO app_kv (key, value_json, create_time, update_time) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, update_time = excluded.update_time, update_by = 'system'`,
      [key, JSON.stringify(value), now, now],
    )
  }

  deleteKv(key: string): void {
    this.db.run(`DELETE FROM app_kv WHERE key = ?`, [key])
  }

  listKvByPrefix(prefix: string): Array<{ key: string; value_json: string }> {
    return this.db
      .query<{ key: string; value_json: string }, [string]>(
        `SELECT key, value_json FROM app_kv WHERE key LIKE ? ORDER BY key`,
      )
      .all(`${prefix}%`)
  }
}

/** Project CRUD（与 FlowRepository 共用同一 Database）。 */
export class ProjectRepository {
  constructor(public readonly db: Database) {}

  listProjects(): ProjectRow[] {
    return this.db
      .query(`SELECT * FROM projects ORDER BY create_time ASC`)
      .all() as ProjectRow[]
  }

  getProject(key: string): ProjectRow | null {
    const r = this.db
      .query(`SELECT * FROM projects WHERE id = ? OR project_id = ?`)
      .get(key, key) as ProjectRow | undefined
    return r ?? null
  }

  allocateUniqueTenantProjectId(_name: string): string {
    for (let attempt = 0; attempt < 64; attempt++) {
      const id = generateTenantProjectId()
      const row = this.db.query(`SELECT project_id FROM projects WHERE project_id = ?`).get(id) as
        | { project_id: string }
        | undefined
      if (!row) return id
    }
    throw new Error('could not allocate unique tenant project_id')
  }

  insertProject(row: { id: string; project_id: string; name: string; description: string }): void {
    const now = new Date().toISOString()
    this.db.run(
      `INSERT INTO projects (id, project_id, name, description, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.project_id, row.name, row.description, now, now],
    )
  }

  updateProject(internalId: string, patch: Partial<Pick<ProjectRow, 'name' | 'description'>>): void {
    const row = this.db
      .query(`SELECT * FROM projects WHERE id = ?`)
      .get(internalId) as ProjectRow | undefined
    if (!row) return
    const now = new Date().toISOString()
    const name = patch.name ?? row.name
    const desc = patch.description ?? row.description
    this.db.run(`UPDATE projects SET name = ?, description = ?, update_time = ?, update_by = 'system' WHERE id = ?`, [
      name,
      desc,
      now,
      internalId,
    ])
  }

  deleteProject(internalId: string): void {
    this.db.run(`DELETE FROM projects WHERE id = ?`, [internalId])
  }

  countProjects(): number {
    const r = this.db.query(`SELECT COUNT(1) as n FROM projects`).get() as { n: number } | undefined
    return r?.n ?? 0
  }
}

/** @deprecated 改用 AppConfig.paths.sqlitePath，通过 DI 注入 AppConfig */
export function defaultDbPath(): string {
  const env = process.env['CUBE_AI_SQLITE_PATH']?.trim()
  if (env) return env
  return '/app/data/cube-ai.sqlite'
}

let _sharedRepo: FlowRepository | null = null

/**
 * 初始化进程级共享 FlowRepository 单例（由 FlowModule 在启动时调用一次）。
 * 已初始化时忽略重复调用，保证全进程只有一个 Database 连接。
 */
export function initSharedFlowRepository(
  dbPath: string,
  seedConfig?: FlowRepositorySeedConfig,
): FlowRepository {
  if (!_sharedRepo) {
    _sharedRepo = FlowRepository.open(dbPath, seedConfig)
  }
  return _sharedRepo
}

/**
 * 获取共享 FlowRepository 单例。
 * 若 FlowModule 尚未初始化（如独立测试场景），则懒加载默认路径。
 */
export function getSharedFlowRepository(): FlowRepository {
  if (!_sharedRepo) {
    _sharedRepo = FlowRepository.open(defaultDbPath())
  }
  return _sharedRepo
}
