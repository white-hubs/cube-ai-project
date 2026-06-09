export type DeveloperApiAccessLevel = 'project' | 'system'
export type Awaitable<T> = T | Promise<T>

export type AccessTokenRecord = {
  userId: string
  username: string
  role: string
  isSuperAdmin: boolean
}

export interface AccessTokenReader {
  verifyAccessToken(rawToken: string): Awaitable<AccessTokenRecord | null>
}

export type DeveloperApiKeyRecord = {
  id: string
  flow_id: string | null
  scopes_json: string | null
  allowed_tools_json: string | null
  project_id: string | null
  access_level: DeveloperApiAccessLevel
}

export interface DeveloperApiKeyReader {
  verifyApiKeyRaw(rawSecret: string): Awaitable<DeveloperApiKeyRecord | null>
}

export interface ProjectLookup {
  listProjectIds(): Awaitable<string[]>
  hasProject(tenantId: string): Awaitable<boolean>
}
