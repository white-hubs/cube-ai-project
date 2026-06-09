import type {
  ApiKeyRow,
  ApiKeySummary,
  AuditColumns,
  AuthUserRow,
  CustomComponentTemplateRow,
  FlowRepositorySeedConfig,
  FlowRow,
  OAuthAccessTokenRow,
  OAuthRefreshTokenRow,
  PlaygroundMessageRow,
  PlaygroundSessionRow,
  ProjectRow,
} from './sqlite'

export type Awaitable<T> = T | Promise<T>

export const FLOW_REPOSITORY_TOKEN = Symbol('FlowRepository')
export const PROJECT_REPOSITORY_TOKEN = Symbol('ProjectRepository')

export interface FlowRepository {
  createFlow(
    tenantId: string,
    row: Omit<FlowRow, 'lf_snapshot_json' | 'tenant_id'> & { lf_snapshot_json?: string | null },
    graphJson: string,
  ): Awaitable<void>
  updateFlowMeta(
    tenantId: string,
    id: string,
    patch: Partial<Pick<FlowRow, 'name' | 'description' | 'langflow_flow_id' | 'binding_status'>>,
    bumpRevision: boolean,
  ): Awaitable<void>
  setLfSnapshot(tenantId: string, id: string, json: string | null): Awaitable<void>
  updateGraph(tenantId: string, id: string, graphJson: string): Awaitable<void>
  deleteFlow(tenantId: string, id: string): Awaitable<void>
  listFlows(tenantId?: string | null): Awaitable<FlowRow[]>
  getFlow(id: string, tenantId?: string | null): Awaitable<FlowRow | null>
  getFlowInProject(id: string, tenantId: string): Awaitable<FlowRow | null>
  countFlowsInProject(tenantId: string): Awaitable<number>
  countApiKeysInProject(tenantId: string): Awaitable<number>
  countCustomTemplatesInProject(tenantId: string): Awaitable<number>
  getGraphJson(flowId: string): Awaitable<string | null>

  getPlaygroundSession(flowId: string, sessionId: string): Awaitable<PlaygroundSessionRow | null>
  listPlaygroundSessions(flowId: string): Awaitable<PlaygroundSessionRow[]>
  ensurePlaygroundDefaultSession(flowId: string): Awaitable<string>
  createPlaygroundSession(
    flowId: string,
    opts: { title?: string | null; asDefault: boolean; userId?: string | null },
  ): Awaitable<string>
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
  ): Awaitable<void>
  deletePlaygroundSession(flowId: string, sessionId: string): Awaitable<void>
  countPlaygroundMessages(sessionId: string): Awaitable<number>
  appendPlaygroundMessage(sessionId: string, role: 'user' | 'bot', content: string): Awaitable<void>
  listPlaygroundMessages(sessionId: string): Awaitable<PlaygroundMessageRow[]>
  archiveDefaultPlaygroundSession(flowId: string, demotedTitle: string): Awaitable<void>


  listCustomComponentTemplates(tenantId?: string | null): Awaitable<CustomComponentTemplateRow[]>
  getCustomComponentTemplate(id: string, tenantId?: string | null): Awaitable<CustomComponentTemplateRow | null>
  insertCustomComponentTemplate(
    tenantId: string,
    row: Omit<CustomComponentTemplateRow, 'create_time' | 'update_time' | 'tenant_id' | keyof AuditColumns>,
  ): Awaitable<void>
  updateCustomComponentTemplate(
    tenantId: string,
    id: string,
    patch: Partial<Pick<CustomComponentTemplateRow, 'display_name' | 'dsl_json'>>,
  ): Awaitable<void>
  deleteCustomComponentTemplate(tenantId: string, id: string): Awaitable<void>

  insertApiKey(row: Omit<ApiKeyRow, 'last_used_at' | 'deleted' | 'update_time' | keyof AuditColumns>): Awaitable<void>
  listApiKeys(tenantId?: string | null): Awaitable<ApiKeyRow[]>
  getApiKeyById(id: string, tenantId?: string | null): Awaitable<ApiKeyRow | null>
  revokeApiKey(tenantId: string | null | undefined, id: string): Awaitable<void>
  touchApiKeyUsage(id: string): Awaitable<void>
  verifyApiKeyRaw(rawSecret: string): Awaitable<ApiKeyRow | null>

  listAuthUsers(): Awaitable<AuthUserRow[]>
  createAuthUser(row: {
    id: string
    username: string
    passwordHash: string
    passwordAlgo: string
    role: string
    status: string
    defaultProjectId: string | null
  }): Awaitable<void>
  updateAuthUser(id: string, fields: Partial<{ role: string; status: string; defaultProjectId: string | null }>): Awaitable<void>
  updateAuthUserPassword(id: string, passwordHash: string, passwordAlgo: string): Awaitable<void>
  deleteAuthUser(id: string): Awaitable<void>
  getAuthUserByUsername(username: string): Awaitable<AuthUserRow | null>
  getAuthUserById(id: string): Awaitable<AuthUserRow | null>

  createAccessToken(row: Omit<OAuthAccessTokenRow, 'deleted' | 'update_time' | keyof AuditColumns>): Awaitable<void>
  createRefreshToken(row: Omit<OAuthRefreshTokenRow, 'deleted' | 'update_time' | keyof AuditColumns>): Awaitable<void>
  verifyAccessToken(rawToken: string): Awaitable<AuthUserRow | null>
  verifyRefreshToken(rawToken: string): Awaitable<{ refresh: OAuthRefreshTokenRow; user: AuthUserRow } | null>
  revokeAccessToken(accessTokenId: string): Awaitable<void>
  revokeRefreshToken(refreshTokenId: string): Awaitable<void>

  insertWebhookInvocation(row: {
    id: string
    flow_id: string
    tenant_id: string
    source: string | null
    payload_json: string
    status: string
    create_time: string
  }): Awaitable<void>

  getKv(key: string): Awaitable<string | null>
  setKv(key: string, value: unknown): Awaitable<void>
  deleteKv(key: string): Awaitable<void>
  listKvByPrefix(prefix: string): Awaitable<Array<{ key: string; value_json: string }>>
}

export interface ProjectRepository {
  listProjects(): Awaitable<ProjectRow[]>
  /** 通过内部 id 或租户 project_id 解析（未删除）。 */
  getProject(idOrTenantKey: string): Awaitable<ProjectRow | null>
  /** 分配唯一租户 `project_id`（`prj_` + 21 位 Base62）。`name` 保留供将来扩展，当前未参与生成。 */
  allocateUniqueTenantProjectId(name: string): Awaitable<string>
  insertProject(row: { id: string; tenant_id: string; name: string; description: string }): Awaitable<void>
  updateProject(internalId: string, patch: Partial<Pick<ProjectRow, 'name' | 'description'>>): Awaitable<void>
  deleteProject(internalId: string): Awaitable<void>
  countProjects(): Awaitable<number>
}

export interface FlowRepositoryBundle {
  flowRepo: FlowRepository
  projectRepo: ProjectRepository
}

export type { ApiKeySummary, FlowRepositorySeedConfig }
