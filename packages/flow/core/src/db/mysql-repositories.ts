import { Injectable } from '@dangao/bun-server'
import { SnowflakeUtil } from '@cube-ai/server-base'
import { currentTenantId, generateTenantProjectId, isGlobalAccessEnabled } from '@cube-ai/server-shared'
import {
  BUILTIN_SYSTEM_API_KEY_ID,
  hashApiKey,
  hashOpaqueToken,
  hashPassword,
  type ApiKeyRow,
  type AuditColumns,
  type AuthUserRow,
  type CustomComponentTemplateRow,
  type FlowRow,
  type OAuthAccessTokenRow,
  type OAuthRefreshTokenRow,
  type PlaygroundMessageRow,
  type PlaygroundSessionRow,
  type ProjectRow,
  type FlowRepositorySeedConfig,
} from './sqlite'
import type { FlowRepository, ProjectRepository } from './repository-contracts'

export interface MysqlQueryService {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] | Promise<T[]>
}

function nowIso(): string {
  return new Date().toISOString()
}

function deletedValue(): number {
  return Date.now()
}

function formatMysqlDateTimeShanghai(date: Date = new Date()): string {
  return date.toLocaleString('sv-SE', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  })
}

function toDateTime(value?: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? formatMysqlDateTimeShanghai(d) : value
}

function normalizeDateValue(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return String(value)
}

function normalizeDeleted(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function normalizeAudit(row: Record<string, unknown>): AuditColumns {
  return {
    create_by: String(row['create_by'] ?? 'system'),
    creator_id: row['creator_id'] == null || row['creator_id'] === '' ? null : String(row['creator_id']),
    creator_type: row['creator_type'] == null || row['creator_type'] === '' ? null : String(row['creator_type']),
    update_by: String(row['update_by'] ?? 'system'),
    updater_id: row['updater_id'] == null || row['updater_id'] === '' ? null : String(row['updater_id']),
    updater_type: row['updater_type'] == null || row['updater_type'] === '' ? null : String(row['updater_type']),
  }
}

function normalizeApiKeyRow(row: Record<string, unknown>): ApiKeyRow {
  return {
    ...normalizeAudit(row),
    id: String(row['id']),
    name: String(row['name']),
    key_hash: String(row['key_hash']),
    key_prefix: String(row['key_prefix']),
    flow_id: row['flow_id'] == null ? null : String(row['flow_id']),
    scopes_json: row['scopes_json'] == null ? null : String(row['scopes_json']),
    project_id: row['project_id'] == null ? '' : String(row['project_id']),
    access_level: row['access_level'] === 'system' ? 'system' : 'project',
    create_time: normalizeDateValue(row['create_time']) ?? '',
    update_time: normalizeDateValue(row['update_time']) ?? '',
    deleted: normalizeDeleted(row['deleted']),
    last_used_at: normalizeDateValue(row['last_used_at']),
    expires_at: normalizeDateValue(row['expires_at']),
    allowed_tools_json: row['allowed_tools_json'] == null ? null : String(row['allowed_tools_json']),
  }
}

function normalizeFlowRow(row: Record<string, unknown>): FlowRow {
  return {
    ...normalizeAudit(row),
    id: String(row['id']),
    name: String(row['name']),
    description: String(row['description'] ?? ''),
    langflow_flow_id: row['langflow_flow_id'] == null ? null : String(row['langflow_flow_id']),
    binding_status: String(row['binding_status'] ?? 'pending'),
    cube_revision: Number(row['cube_revision'] ?? 0),
    create_time: normalizeDateValue(row['create_time']) ?? '',
    update_time: normalizeDateValue(row['update_time']) ?? '',
    lf_snapshot_json: row['lf_snapshot_json'] == null ? null : String(row['lf_snapshot_json']),
    project_id: String(row['project_id'] ?? ''),
  }
}

function normalizeProjectRow(row: Record<string, unknown>): ProjectRow {
  return {
    ...normalizeAudit(row),
    id: String(row['id']),
    project_id: String(row['project_id'] ?? ''),
    name: String(row['name']),
    description: String(row['description'] ?? ''),
    create_time: normalizeDateValue(row['create_time']) ?? '',
    update_time: normalizeDateValue(row['update_time']) ?? '',
  }
}

function normalizePlaygroundSessionRow(row: Record<string, unknown>): PlaygroundSessionRow {
  return {
    ...normalizeAudit(row),
    id: String(row['id']),
    flow_id: String(row['flow_id']),
    title: row['title'] == null ? null : String(row['title']),
    is_default: Number(row['is_default'] ?? 0),
    user_id: row['user_id'] == null ? null : String(row['user_id']),
    chat_history: row['chat_history'] == null ? null : String(row['chat_history']),
    last_message: row['last_message'] == null ? null : String(row['last_message']),
    create_time: normalizeDateValue(row['create_time']) ?? '',
    update_time: normalizeDateValue(row['update_time']) ?? '',
  }
}

function normalizePlaygroundMessageRow(row: Record<string, unknown>): PlaygroundMessageRow {
  return {
    ...normalizeAudit(row),
    id: String(row['id']),
    session_id: String(row['session_id']),
    role: String(row['role']),
    content: String(row['content']),
    seq: Number(row['seq']),
    create_time: normalizeDateValue(row['create_time']) ?? '',
    update_time: normalizeDateValue(row['update_time']) ?? '',
  }
}

function normalizeTemplateRow(row: Record<string, unknown>): CustomComponentTemplateRow {
  return {
    ...normalizeAudit(row),
    id: String(row['id']),
    display_name: String(row['display_name']),
    dsl_json: String(row['dsl_json']),
    create_time: normalizeDateValue(row['create_time']) ?? '',
    update_time: normalizeDateValue(row['update_time']) ?? '',
    project_id: String(row['project_id'] ?? ''),
  }
}

function normalizeAuthUserRow(row: Record<string, unknown>): AuthUserRow {
  return {
    ...normalizeAudit(row),
    id: String(row['id']),
    username: String(row['username']),
    password_hash: String(row['password_hash']),
    password_algo: String(row['password_algo']),
    status: String(row['status']),
    role: String(row['role']),
    default_project_id: row['default_project_id'] == null ? null : String(row['default_project_id']),
    create_time: normalizeDateValue(row['create_time']) ?? '',
    update_time: normalizeDateValue(row['update_time']) ?? '',
  }
}

function normalizeAccessTokenRow(row: Record<string, unknown>): OAuthAccessTokenRow {
  return {
    ...normalizeAudit(row),
    id: String(row['id']),
    token_hash: String(row['token_hash']),
    user_id: String(row['user_id']),
    username: String(row['username']),
    role: String(row['role']),
    scope_json: row['scope_json'] == null ? null : String(row['scope_json']),
    expires_at: normalizeDateValue(row['expires_at']) ?? '',
    create_time: normalizeDateValue(row['create_time']) ?? '',
    update_time: normalizeDateValue(row['update_time']) ?? '',
    deleted: normalizeDeleted(row['deleted']),
  }
}

function normalizeRefreshTokenRow(row: Record<string, unknown>): OAuthRefreshTokenRow {
  return {
    ...normalizeAudit(row),
    id: String(row['id']),
    token_hash: String(row['token_hash']),
    user_id: String(row['user_id']),
    access_token_id: String(row['access_token_id']),
    expires_at: normalizeDateValue(row['expires_at']) ?? '',
    create_time: normalizeDateValue(row['create_time']) ?? '',
    update_time: normalizeDateValue(row['update_time']) ?? '',
    deleted: normalizeDeleted(row['deleted']),
  }
}

class MysqlRepositoryBase {
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

  protected projectScopeColumn(alias = ''): { sql: string; params: unknown[] } {
    if (isGlobalAccessEnabled()) return { sql: '', params: [] }
    const pid = currentTenantId()?.trim()
    if (!pid) return { sql: '', params: [] }
    const prefix = alias ? `${alias}.` : ''
    return { sql: `${prefix}project_id = ?`, params: [pid] }
  }
}

@Injectable()
export class MysqlFlowRepository extends MysqlRepositoryBase implements FlowRepository {
  public async ensureBootstrapData(seedConfig?: FlowRepositorySeedConfig): Promise<void> {
    const projectCount = await this.countProjectsInternal()
    if (projectCount === 0) {
      const defaultProjectAny = await this.one<{ id: string; deleted: number }>(
        'SELECT id, deleted FROM projects WHERE project_id = ? ORDER BY create_time ASC LIMIT 1',
        ['default'],
      )
      if (defaultProjectAny) {
        // `project_id` 全局唯一；若历史上软删过 default，则恢复它而不是重新插入。
        await this.exec(
          `UPDATE projects
           SET deleted = 0,
               name = CASE WHEN name IS NULL OR name = '' THEN ? ELSE name END,
               description = COALESCE(description, ?),
               update_time = ?
           WHERE id = ?`,
          ['默认项目', '', formatMysqlDateTimeShanghai(), String(defaultProjectAny.id)],
        )
      } else {
        await this.insertProjectInternal({
          id: SnowflakeUtil.nextId(),
          project_id: 'default',
          name: '默认项目',
          description: '',
        })
      }
    }
    const firstProject = await this.one<Record<string, unknown>>(
      'SELECT id, project_id FROM projects WHERE deleted = 0 ORDER BY create_time ASC LIMIT 1',
    )
    const defaultProjectTenantId = firstProject ? String(firstProject['project_id'] ?? '') : null

    const userCount = await this.one<{ c: number }>('SELECT COUNT(1) AS c FROM auth_users WHERE deleted = 0')
    if ((userCount?.c ?? 0) === 0) {
      await this.createAuthUser({
        id: SnowflakeUtil.nextId(),
        username: seedConfig?.superAdminUsername ?? 'admin',
        passwordHash: hashPassword(seedConfig?.superAdminPassword ?? 'ChangeMe123!'),
        passwordAlgo: 'pbkdf2_sha256',
        role: 'super_admin',
        status: 'active',
        defaultProjectId: defaultProjectTenantId,
      })
    }

    const secret = seedConfig?.builtinSystemApiKey ?? 'sk_cube_builtin_system_ChangeMeInProduction'
    const secretHash = hashApiKey(secret)
    const builtinBySecret = await this.one<{ id: string; deleted: number | string | null }>(
      'SELECT id, deleted FROM api_keys WHERE key_hash = ? AND access_level = ? LIMIT 1',
      [secretHash, 'system'],
    )
    if (builtinBySecret) {
      const deleted = Number(builtinBySecret.deleted ?? 0)
      if (deleted !== 0) {
        const now = formatMysqlDateTimeShanghai()
        await this.exec(
          `UPDATE api_keys
           SET deleted = 0,
               project_id = '',
               access_level = 'system',
               update_time = ?
           WHERE id = ?`,
          [now, String(builtinBySecret.id)],
        )
      }
    } else {
      // 兼容历史：若固定 id 已存在（含软删），则恢复并刷新为系统 key。
      const legacyBuiltinById = await this.one<{ id: string }>(
        'SELECT id FROM api_keys WHERE id = ? LIMIT 1',
        [BUILTIN_SYSTEM_API_KEY_ID],
      )
      if (legacyBuiltinById) {
        const now = formatMysqlDateTimeShanghai()
        await this.exec(
          `UPDATE api_keys
           SET deleted = 0,
               name = ?,
               key_hash = ?,
               key_prefix = ?,
               flow_id = NULL,
               scopes_json = ?,
               access_level = 'system',
               project_id = '',
               expires_at = NULL,
               allowed_tools_json = NULL,
               update_time = ?
           WHERE id = ?`,
          [
            'Built-in system',
            secretHash,
            secret.slice(0, 10),
            JSON.stringify(['run', 'kb', 'search', 'documents']),
            now,
            BUILTIN_SYSTEM_API_KEY_ID,
          ],
        )
      } else {
      await this.insertApiKey({
        id: BUILTIN_SYSTEM_API_KEY_ID,
        name: 'Built-in system',
        key_hash: secretHash,
        key_prefix: secret.slice(0, 10),
        flow_id: null,
        scopes_json: JSON.stringify(['run', 'kb', 'search', 'documents']),
        project_id: '',
        access_level: 'system',
        create_time: nowIso(),
        expires_at: null,
        allowed_tools_json: null,
      })
      }
    }
  }

  private async countProjectsInternal(): Promise<number> {
    const row = await this.one<{ c: number }>('SELECT COUNT(1) AS c FROM projects WHERE deleted = 0')
    return row?.c ?? 0
  }

  private async insertProjectInternal(row: { id: string; project_id: string; name: string; description: string }): Promise<void> {
    const now = formatMysqlDateTimeShanghai()
    await this.exec(
      `INSERT INTO projects
      (id, project_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, name, description)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?)`,
      [row.id, row.project_id, now, now, row.name, row.description],
    )
  }

  public async createFlow(tenantId: string, row: Omit<FlowRow, 'lf_snapshot_json' | 'project_id'> & { lf_snapshot_json?: string | null }, graphJson: string): Promise<void> {
    const now = formatMysqlDateTimeShanghai()
    await this.exec(
      `INSERT INTO flows
      (id, project_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, name, description, langflow_flow_id, binding_status, cube_revision, lf_snapshot_json)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, tenantId, now, now, row.name, row.description, row.langflow_flow_id, row.binding_status, row.cube_revision, row.lf_snapshot_json ?? null],
    )
    await this.exec(
      `INSERT INTO flow_graphs
      (flow_id, project_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, graph_json)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?)`,
      [row.id, tenantId, now, now, graphJson],
    )
  }

  public async updateFlowMeta(tenantId: string, id: string, patch: Partial<Pick<FlowRow, 'name' | 'description' | 'langflow_flow_id' | 'binding_status'>>, bumpRevision: boolean): Promise<void> {
    const row = await this.getFlow(id, tenantId)
    if (!row) return
    const rev = bumpRevision ? row.cube_revision + 1 : row.cube_revision
    await this.exec(
      `UPDATE flows
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           langflow_flow_id = COALESCE(?, langflow_flow_id),
           binding_status = COALESCE(?, binding_status),
           cube_revision = ?,
           update_time = ?
       WHERE id = ? AND project_id = ? AND deleted = 0`,
      [
        patch.name ?? null,
        patch.description ?? null,
        patch.langflow_flow_id ?? null,
        patch.binding_status ?? null,
        rev,
        formatMysqlDateTimeShanghai(),
        id,
        tenantId,
      ],
    )
  }

  public async setLfSnapshot(tenantId: string, id: string, json: string | null): Promise<void> {
    await this.exec(
      'UPDATE flows SET lf_snapshot_json = ?, update_time = ? WHERE id = ? AND project_id = ? AND deleted = 0',
      [json, formatMysqlDateTimeShanghai(), id, tenantId],
    )
  }

  public async updateGraph(tenantId: string, id: string, graphJson: string): Promise<void> {
    const now = formatMysqlDateTimeShanghai()
    await this.exec(
      'UPDATE flow_graphs SET graph_json = ?, update_time = ? WHERE flow_id = ? AND project_id = ? AND deleted = 0',
      [graphJson, now, id, tenantId],
    )
    await this.exec(
      'UPDATE flows SET cube_revision = cube_revision + 1, update_time = ? WHERE id = ? AND project_id = ? AND deleted = 0',
      [now, id, tenantId],
    )
  }

  public async deleteFlow(tenantId: string, id: string): Promise<void> {
    const del = deletedValue()
    const now = formatMysqlDateTimeShanghai()
    await this.exec('UPDATE flows SET deleted = ?, update_time = ? WHERE id = ? AND project_id = ? AND deleted = 0', [del, now, id, tenantId])
    await this.exec('UPDATE flow_graphs SET deleted = ?, update_time = ? WHERE flow_id = ? AND project_id = ? AND deleted = 0', [del, now, id, tenantId])
    await this.exec('UPDATE playground_sessions SET deleted = ?, update_time = ? WHERE flow_id = ? AND project_id = ? AND deleted = 0', [del, now, id, tenantId])
    await this.exec(
      'UPDATE playground_messages SET deleted = ?, update_time = ? WHERE session_id IN (SELECT id FROM playground_sessions WHERE flow_id = ? AND project_id = ?) AND deleted = 0',
      [del, now, id, tenantId],
    )
  }

  public async listFlows(tenantId?: string | null): Promise<FlowRow[]> {
    const params: unknown[] = []
    let sql = 'SELECT * FROM flows WHERE deleted = 0'
    if (tenantId && tenantId.trim() !== '') {
      sql += ' AND project_id = ?'
      params.push(tenantId)
    }
    sql += ' ORDER BY update_time DESC'
    return (await this.q<Record<string, unknown>>(sql, params)).map(normalizeFlowRow)
  }

  public async getFlow(id: string, tenantId?: string | null): Promise<FlowRow | null> {
    const params: unknown[] = [id]
    let sql = 'SELECT * FROM flows WHERE id = ? AND deleted = 0'
    if (tenantId && tenantId.trim() !== '') {
      sql += ' AND project_id = ?'
      params.push(tenantId)
    }
    const row = await this.one<Record<string, unknown>>(sql, params)
    return row ? normalizeFlowRow(row) : null
  }

  public async getFlowInProject(id: string, tenantId: string): Promise<FlowRow | null> {
    return this.getFlow(id, tenantId)
  }

  public async countFlowsInProject(tenantId: string): Promise<number> {
    const row = await this.one<{ n: number }>('SELECT COUNT(1) AS n FROM flows WHERE project_id = ? AND deleted = 0', [tenantId])
    return row?.n ?? 0
  }

  public async countApiKeysInProject(tenantId: string): Promise<number> {
    const row = await this.one<{ n: number }>(
      'SELECT COUNT(1) AS n FROM api_keys WHERE project_id = ? AND deleted = 0',
      [tenantId],
    )
    return row?.n ?? 0
  }

  public async countCustomTemplatesInProject(tenantId: string): Promise<number> {
    const row = await this.one<{ n: number }>('SELECT COUNT(1) AS n FROM custom_component_templates WHERE project_id = ? AND deleted = 0', [tenantId])
    return row?.n ?? 0
  }

  public async getGraphJson(flowId: string): Promise<string | null> {
    const row = await this.one<{ graph_json: string }>('SELECT graph_json FROM flow_graphs WHERE flow_id = ? AND deleted = 0', [flowId])
    return row?.graph_json ?? null
  }

  public async getPlaygroundSession(flowId: string, sessionId: string): Promise<PlaygroundSessionRow | null> {
    const row = await this.one<Record<string, unknown>>(
      'SELECT * FROM playground_sessions WHERE id = ? AND flow_id = ? AND deleted = 0',
      [sessionId, flowId],
    )
    return row ? normalizePlaygroundSessionRow(row) : null
  }

  public async listPlaygroundSessions(flowId: string): Promise<PlaygroundSessionRow[]> {
    return (await this.q<Record<string, unknown>>(
      'SELECT * FROM playground_sessions WHERE flow_id = ? AND deleted = 0 ORDER BY is_default DESC, update_time DESC',
      [flowId],
    )).map(normalizePlaygroundSessionRow)
  }

  public async ensurePlaygroundDefaultSession(flowId: string): Promise<string> {
    const row = await this.one<{ id: string }>(
      'SELECT id FROM playground_sessions WHERE flow_id = ? AND is_default = 1 AND deleted = 0 LIMIT 1',
      [flowId],
    )
    if (row?.id) return row.id
    const created = await this.createPlaygroundSession(flowId, { title: null, asDefault: true })
    return created
  }

  public async createPlaygroundSession(flowId: string, opts: { title?: string | null; asDefault: boolean; userId?: string | null }): Promise<string> {
    const flow = await this.getFlow(flowId, null)
    if (!flow) throw new Error(`flow not found: ${flowId}`)
    const id = SnowflakeUtil.nextId()
    const now = formatMysqlDateTimeShanghai()
    if (opts.asDefault) {
      await this.exec('UPDATE playground_sessions SET is_default = 0, update_time = ? WHERE flow_id = ? AND deleted = 0', [now, flowId])
    }
    await this.exec(
      `INSERT INTO playground_sessions
      (id, project_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, flow_id, title, user_id, is_default, chat_history, last_message)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        flow.project_id,
        now,
        now,
        flowId,
        opts.title ?? null,
        opts.userId ?? null,
        opts.asDefault ? 1 : 0,
        null,
        null,
      ],
    )
    return id
  }

  public async updatePlaygroundSession(flowId: string, sessionId: string, patch: Partial<{ title: string | null; is_default: number; user_id: string | null; chat_history: string | null; last_message: string | null; update_time: string }>): Promise<void> {
    const sets: string[] = []
    const params: unknown[] = []
    if ('title' in patch) { sets.push('title = ?'); params.push(patch.title ?? null) }
    if ('is_default' in patch) { sets.push('is_default = ?'); params.push(patch.is_default ?? 0) }
    if ('user_id' in patch) { sets.push('user_id = ?'); params.push(patch.user_id ?? null) }
    if ('chat_history' in patch) { sets.push('chat_history = ?'); params.push(patch.chat_history ?? null) }
    if ('last_message' in patch) { sets.push('last_message = ?'); params.push(patch.last_message ?? null) }
    sets.push('update_time = ?')
    params.push(formatMysqlDateTimeShanghai())
    if (sets.length === 1) return
    await this.exec(`UPDATE playground_sessions SET ${sets.join(', ')} WHERE id = ? AND flow_id = ? AND deleted = 0`, [...params, sessionId, flowId])
  }

  public async deletePlaygroundSession(flowId: string, sessionId: string): Promise<void> {
    const del = deletedValue()
    const now = formatMysqlDateTimeShanghai()
    await this.exec('UPDATE playground_sessions SET deleted = ?, update_time = ? WHERE id = ? AND flow_id = ? AND deleted = 0', [del, now, sessionId, flowId])
    await this.exec('UPDATE playground_messages SET deleted = ?, update_time = ? WHERE session_id = ? AND deleted = 0', [del, now, sessionId])
  }

  public async countPlaygroundMessages(sessionId: string): Promise<number> {
    const row = await this.one<{ n: number }>('SELECT COUNT(1) AS n FROM playground_messages WHERE session_id = ? AND deleted = 0', [sessionId])
    return row?.n ?? 0
  }

  public async appendPlaygroundMessage(sessionId: string, role: 'user' | 'bot', content: string): Promise<void> {
    const session = await this.one<Record<string, unknown>>('SELECT project_id FROM playground_sessions WHERE id = ? AND deleted = 0', [sessionId])
    const tenantId = session ? String(session['project_id']) : ''
    const now = formatMysqlDateTimeShanghai()
    const seqRow = await this.one<{ m: number }>('SELECT COALESCE(MAX(seq), -1) AS m FROM playground_messages WHERE session_id = ? AND deleted = 0', [sessionId])
    const seq = (seqRow?.m ?? -1) + 1
    const msgId = SnowflakeUtil.nextId()
    await this.exec(
      `INSERT INTO playground_messages
      (id, project_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, session_id, role, content, seq)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?, ?, ?)`,
      [msgId, tenantId, now, now, sessionId, role, content, seq],
    )
    await this.exec('UPDATE playground_sessions SET last_message = ?, update_time = ? WHERE id = ? AND deleted = 0', [content, now, sessionId])
  }

  public async listPlaygroundMessages(sessionId: string): Promise<PlaygroundMessageRow[]> {
    return (await this.q<Record<string, unknown>>(
      'SELECT id, session_id, role, content, seq, create_time FROM playground_messages WHERE session_id = ? AND deleted = 0 ORDER BY seq ASC',
      [sessionId],
    )).map(normalizePlaygroundMessageRow)
  }

  public async archiveDefaultPlaygroundSession(flowId: string, demotedTitle: string): Promise<void> {
    const def = await this.one<{ id: string }>(
      'SELECT id FROM playground_sessions WHERE flow_id = ? AND is_default = 1 AND deleted = 0 LIMIT 1',
      [flowId],
    )
    if (!def?.id) {
      await this.ensurePlaygroundDefaultSession(flowId)
      return
    }
    const count = await this.countPlaygroundMessages(def.id)
    if (count === 0) return
    const now = formatMysqlDateTimeShanghai()
    await this.exec(
      `UPDATE playground_sessions
       SET is_default = 0, title = COALESCE(NULLIF(TRIM(title), ''), ?), update_time = ?
       WHERE id = ? AND deleted = 0`,
      [demotedTitle, now, def.id],
    )
    await this.createPlaygroundSession(flowId, { title: null, asDefault: true })
  }


  public async listCustomComponentTemplates(tenantId?: string | null): Promise<CustomComponentTemplateRow[]> {
    const params: unknown[] = []
    let sql = 'SELECT id, display_name, dsl_json, create_time, update_time, project_id FROM custom_component_templates WHERE deleted = 0'
    if (tenantId && tenantId.trim() !== '') {
      sql += ' AND project_id = ?'
      params.push(tenantId)
    }
    sql += ' ORDER BY update_time DESC'
    return (await this.q<Record<string, unknown>>(sql, params)).map(normalizeTemplateRow)
  }

  public async getCustomComponentTemplate(id: string, tenantId?: string | null): Promise<CustomComponentTemplateRow | null> {
    const params: unknown[] = [id]
    let sql = 'SELECT id, display_name, dsl_json, create_time, update_time, project_id FROM custom_component_templates WHERE id = ? AND deleted = 0'
    if (tenantId && tenantId.trim() !== '') {
      sql += ' AND project_id = ?'
      params.push(tenantId)
    }
    const row = await this.one<Record<string, unknown>>(sql, params)
    return row ? normalizeTemplateRow(row) : null
  }

  public async insertCustomComponentTemplate(tenantId: string, row: Omit<CustomComponentTemplateRow, 'create_time' | 'update_time' | 'project_id' | keyof AuditColumns>): Promise<void> {
    const now = formatMysqlDateTimeShanghai()
    await this.exec(
      `INSERT INTO custom_component_templates
      (id, project_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, display_name, dsl_json)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?)`,
      [row.id, tenantId, now, now, row.display_name, row.dsl_json],
    )
  }

  public async updateCustomComponentTemplate(tenantId: string, id: string, patch: Partial<Pick<CustomComponentTemplateRow, 'display_name' | 'dsl_json'>>): Promise<void> {
    const row = await this.getCustomComponentTemplate(id, tenantId)
    if (!row) return
    const now = formatMysqlDateTimeShanghai()
    await this.exec(
      `UPDATE custom_component_templates
       SET display_name = ?, dsl_json = ?, update_time = ?
       WHERE id = ? AND project_id = ? AND deleted = 0`,
      [patch.display_name ?? row.display_name, patch.dsl_json ?? row.dsl_json, now, id, tenantId],
    )
  }

  public async deleteCustomComponentTemplate(tenantId: string, id: string): Promise<void> {
    await this.exec('UPDATE custom_component_templates SET deleted = ?, update_time = ? WHERE id = ? AND project_id = ? AND deleted = 0', [deletedValue(), formatMysqlDateTimeShanghai(), id, tenantId])
  }

  public async insertApiKey(row: Omit<ApiKeyRow, 'last_used_at' | 'deleted' | 'update_time' | keyof AuditColumns>): Promise<void> {
    const now = formatMysqlDateTimeShanghai(new Date(row.create_time))
    await this.exec(
      `INSERT INTO api_keys
      (id, project_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, name, key_hash, key_prefix, flow_id, scopes_json, access_level, last_used_at, expires_at, allowed_tools_json)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [row.id, row.project_id || null, now, now, row.name, row.key_hash, row.key_prefix, row.flow_id, row.scopes_json, row.access_level, toDateTime(row.expires_at), row.allowed_tools_json],
    )
  }

  public async listApiKeys(tenantId?: string | null): Promise<ApiKeyRow[]> {
    const params: unknown[] = []
    let sql = 'SELECT * FROM api_keys WHERE deleted = 0'
    if (tenantId && tenantId.trim() !== '') {
      sql += ' AND project_id = ?'
      params.push(tenantId)
    }
    sql += ' ORDER BY create_time DESC'
    return (await this.q<Record<string, unknown>>(sql, params)).map(normalizeApiKeyRow)
  }

  public async getApiKeyById(id: string, tenantId?: string | null): Promise<ApiKeyRow | null> {
    const params: unknown[] = [id]
    let sql = 'SELECT * FROM api_keys WHERE id = ? AND deleted = 0'
    if (tenantId && tenantId.trim() !== '') {
      sql += ' AND project_id = ?'
      params.push(tenantId)
    }
    const row = await this.one<Record<string, unknown>>(sql, params)
    return row ? normalizeApiKeyRow(row) : null
  }

  public async revokeApiKey(tenantId: string | null | undefined, id: string): Promise<void> {
    const now = formatMysqlDateTimeShanghai()
    const del = deletedValue()
    if (!tenantId || tenantId.trim() === '') {
      await this.exec('UPDATE api_keys SET deleted = ?, update_time = ? WHERE id = ? AND deleted = 0', [del, now, id])
      return
    }
    await this.exec('UPDATE api_keys SET deleted = ?, update_time = ? WHERE id = ? AND project_id = ? AND deleted = 0', [
      del,
      now,
      id,
      tenantId,
    ])
  }

  public async touchApiKeyUsage(id: string): Promise<void> {
    const now = formatMysqlDateTimeShanghai()
    await this.exec('UPDATE api_keys SET last_used_at = ?, update_time = ? WHERE id = ? AND deleted = 0', [now, now, id])
  }

  public async verifyApiKeyRaw(rawSecret: string): Promise<ApiKeyRow | null> {
    const row = await this.one<Record<string, unknown>>('SELECT * FROM api_keys WHERE key_hash = ? AND deleted = 0', [hashApiKey(rawSecret)])
    if (!row) return null
    const normalized = normalizeApiKeyRow(row)
    if (normalized.expires_at) {
      const exp = Date.parse(normalized.expires_at)
      if (Number.isFinite(exp) && exp < Date.now()) return null
    }
    await this.touchApiKeyUsage(normalized.id)
    return normalized
  }

  public async listAuthUsers(): Promise<AuthUserRow[]> {
    return (await this.q<Record<string, unknown>>(
      'SELECT id, username, password_hash, password_algo, status, role, default_project_id, create_time, update_time FROM auth_users WHERE deleted = 0 ORDER BY create_time ASC',
    )).map(normalizeAuthUserRow)
  }

  public async createAuthUser(row: { id: string; username: string; passwordHash: string; passwordAlgo: string; role: string; status: string; defaultProjectId: string | null }): Promise<void> {
    const now = formatMysqlDateTimeShanghai()
    await this.exec(
      `INSERT INTO auth_users
      (id, project_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, username, password_hash, password_algo, status, role, default_project_id)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, currentTenantId() ?? null, now, now, row.username, row.passwordHash, row.passwordAlgo, row.status, row.role, row.defaultProjectId],
    )
  }

  public async updateAuthUser(id: string, fields: Partial<{ role: string; status: string; defaultProjectId: string | null }>): Promise<void> {
    const sets: string[] = ['update_time = ?']
    const now = formatMysqlDateTimeShanghai()
    const params: unknown[] = [now]
    if (fields.role !== undefined) { sets.push('role = ?'); params.push(fields.role) }
    if (fields.status !== undefined) { sets.push('status = ?'); params.push(fields.status) }
    if ('defaultProjectId' in fields) { sets.push('default_project_id = ?'); params.push(fields.defaultProjectId ?? null) }
    await this.exec(`UPDATE auth_users SET ${sets.join(', ')} WHERE id = ? AND deleted = 0`, [...params, id])
  }

  public async updateAuthUserPassword(id: string, passwordHash: string, passwordAlgo: string): Promise<void> {
    const now = formatMysqlDateTimeShanghai()
    await this.exec('UPDATE auth_users SET password_hash = ?, password_algo = ?, update_time = ? WHERE id = ? AND deleted = 0', [passwordHash, passwordAlgo, now, id])
  }

  public async deleteAuthUser(id: string): Promise<void> {
    await this.exec('UPDATE auth_users SET deleted = ?, update_time = ? WHERE id = ? AND deleted = 0', [deletedValue(), formatMysqlDateTimeShanghai(), id])
  }

  public async getAuthUserByUsername(username: string): Promise<AuthUserRow | null> {
    const row = await this.one<Record<string, unknown>>(
      'SELECT id, username, password_hash, password_algo, status, role, default_project_id, create_time, update_time FROM auth_users WHERE username = ? AND deleted = 0',
      [username],
    )
    return row ? normalizeAuthUserRow(row) : null
  }

  public async getAuthUserById(id: string): Promise<AuthUserRow | null> {
    const row = await this.one<Record<string, unknown>>(
      'SELECT id, username, password_hash, password_algo, status, role, default_project_id, create_time, update_time FROM auth_users WHERE id = ? AND deleted = 0',
      [id],
    )
    return row ? normalizeAuthUserRow(row) : null
  }

  public async createAccessToken(row: Omit<OAuthAccessTokenRow, 'deleted' | 'update_time' | keyof AuditColumns>): Promise<void> {
    const now = formatMysqlDateTimeShanghai(new Date(row.create_time))
    await this.exec(
      `INSERT INTO oauth_access_tokens
      (id, project_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, token_hash, user_id, username, role, scope_json, expires_at)
      VALUES (?, NULL, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, now, now, row.token_hash, row.user_id, row.username, row.role, row.scope_json, toDateTime(row.expires_at)],
    )
  }

  public async createRefreshToken(row: Omit<OAuthRefreshTokenRow, 'deleted' | 'update_time' | keyof AuditColumns>): Promise<void> {
    const now = formatMysqlDateTimeShanghai(new Date(row.create_time))
    await this.exec(
      `INSERT INTO oauth_refresh_tokens
      (id, project_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, token_hash, user_id, access_token_id, expires_at)
      VALUES (?, NULL, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?, ?, ?)`,
      [row.id, now, now, row.token_hash, row.user_id, row.access_token_id, toDateTime(row.expires_at)],
    )
  }

  public async verifyAccessToken(rawToken: string): Promise<AuthUserRow | null> {
    const row = await this.one<Record<string, unknown>>('SELECT * FROM oauth_access_tokens WHERE token_hash = ? AND deleted = 0', [hashOpaqueToken(rawToken)])
    if (!row) return null
    const token = normalizeAccessTokenRow(row)
    const exp = Date.parse(token.expires_at)
    if (Number.isFinite(exp) && exp < Date.now()) return null
    const user = await this.getAuthUserById(token.user_id)
    if (!user || user.status !== 'active') return null
    return user
  }

  public async verifyRefreshToken(rawToken: string): Promise<{ refresh: OAuthRefreshTokenRow; user: AuthUserRow } | null> {
    const row = await this.one<Record<string, unknown>>('SELECT * FROM oauth_refresh_tokens WHERE token_hash = ? AND deleted = 0', [hashOpaqueToken(rawToken)])
    if (!row) return null
    const refresh = normalizeRefreshTokenRow(row)
    const exp = Date.parse(refresh.expires_at)
    if (Number.isFinite(exp) && exp < Date.now()) return null
    const user = await this.getAuthUserById(refresh.user_id)
    if (!user || user.status !== 'active') return null
    return { refresh, user }
  }

  public async revokeAccessToken(accessTokenId: string): Promise<void> {
    const now = formatMysqlDateTimeShanghai()
    await this.exec('UPDATE oauth_access_tokens SET deleted = ?, update_time = ? WHERE id = ? AND deleted = 0', [
      deletedValue(),
      now,
      accessTokenId,
    ])
  }

  public async revokeRefreshToken(refreshTokenId: string): Promise<void> {
    const now = formatMysqlDateTimeShanghai()
    await this.exec('UPDATE oauth_refresh_tokens SET deleted = ?, update_time = ? WHERE id = ? AND deleted = 0', [
      deletedValue(),
      now,
      refreshTokenId,
    ])
  }

  public async insertWebhookInvocation(row: { id: string; flow_id: string; project_id: string; source: string | null; payload_json: string; status: string; create_time: string }): Promise<void> {
    const now = formatMysqlDateTimeShanghai(new Date(row.create_time))
    await this.exec(
      `INSERT INTO webhook_invocations
      (id, project_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, flow_id, source, payload_json, status)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?, ?, ?)`,
      [row.id, row.project_id, now, now, row.flow_id, row.source, row.payload_json, row.status],
    )
  }

  public async getKv(key: string): Promise<string | null> {
    const row = await this.one<{ value_json: string }>('SELECT value_json FROM app_kv WHERE kv_key = ? AND deleted = 0', [key])
    return row?.value_json ?? null
  }

  public async setKv(key: string, value: unknown): Promise<void> {
    const now = formatMysqlDateTimeShanghai()
    await this.exec(
      `INSERT INTO app_kv
      (kv_key, project_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, value_json)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?)
      ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), update_time = VALUES(update_time), deleted = 0`,
      [key, currentTenantId() ?? null, now, now, JSON.stringify(value)],
    )
  }

  public async deleteKv(key: string): Promise<void> {
    await this.exec('UPDATE app_kv SET deleted = ?, update_time = ? WHERE kv_key = ? AND deleted = 0', [deletedValue(), formatMysqlDateTimeShanghai(), key])
  }

  public async listKvByPrefix(prefix: string): Promise<Array<{ key: string; value_json: string }>> {
    return (await this.q<Record<string, unknown>>(
      'SELECT kv_key, value_json FROM app_kv WHERE kv_key LIKE ? AND deleted = 0 ORDER BY kv_key',
      [`${prefix}%`],
    )).map((row) => ({ key: String(row['kv_key']), value_json: String(row['value_json']) }))
  }
}

@Injectable()
export class MysqlProjectRepository extends MysqlRepositoryBase implements ProjectRepository {
  public async listProjects(): Promise<ProjectRow[]> {
    return (await this.q<Record<string, unknown>>(
      'SELECT id, project_id, name, description, create_time, update_time FROM projects WHERE deleted = 0 ORDER BY create_time ASC',
    )).map(normalizeProjectRow)
  }

  public async getProject(key: string): Promise<ProjectRow | null> {
    const row = await this.one<Record<string, unknown>>(
      'SELECT id, project_id, name, description, create_time, update_time FROM projects WHERE deleted = 0 AND (id = ? OR project_id = ?)',
      [key, key],
    )
    return row ? normalizeProjectRow(row) : null
  }

  public async allocateUniqueTenantProjectId(_name: string): Promise<string> {
    for (let attempt = 0; attempt < 64; attempt++) {
      const id = generateTenantProjectId()
      const taken = await this.one<{ c: number }>(
        'SELECT COUNT(1) AS c FROM projects WHERE project_id = ? AND deleted = 0',
        [id],
      )
      if ((taken?.c ?? 0) === 0) return id
    }
    throw new Error('could not allocate unique tenant project_id')
  }

  public async insertProject(row: { id: string; project_id: string; name: string; description: string }): Promise<void> {
    const now = formatMysqlDateTimeShanghai()
    await this.exec(
      `INSERT INTO projects
      (id, project_id, deleted, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, name, description)
      VALUES (?, ?, 0, 'system', NULL, NULL, ?, 'system', NULL, NULL, ?, ?, ?)`,
      [row.id, row.project_id, now, now, row.name, row.description],
    )
  }

  public async updateProject(internalId: string, patch: Partial<Pick<ProjectRow, 'name' | 'description'>>): Promise<void> {
    const now = formatMysqlDateTimeShanghai()
    await this.exec(
      'UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description), update_time = ? WHERE id = ? AND deleted = 0',
      [patch.name ?? null, patch.description ?? null, now, internalId],
    )
  }

  public async deleteProject(internalId: string): Promise<void> {
    const now = formatMysqlDateTimeShanghai()
    await this.exec('UPDATE projects SET deleted = ?, update_time = ? WHERE id = ? AND deleted = 0', [
      deletedValue(),
      now,
      internalId,
    ])
  }

  public async countProjects(): Promise<number> {
    const row = await this.one<{ n: number }>('SELECT COUNT(1) AS n FROM projects WHERE deleted = 0')
    return row?.n ?? 0
  }
}
