import { Inject, Injectable } from '@dangao/bun-server'
import { BadRequestException, NotFoundException } from '@dangao/bun-server'
import {
  BUILTIN_SYSTEM_API_KEY_ID,
  randomApiKeySecret,
  hashApiKey,
  type ApiKeySummary,
} from '../db/sqlite'
import { SnowflakeUtil } from '@cube-ai/server-base'
import { FLOW_REPOSITORY_TOKEN, type FlowRepository } from '../db/repository-contracts'
import { currentProjectId, isGlobalAccessEnabled } from '@cube-ai/server-shared'

@Injectable()
export class ApiKeysService {
  private readonly repo: FlowRepository

  constructor(@Inject(FLOW_REPOSITORY_TOKEN) repo: FlowRepository) {
    this.repo = repo
  }

  private requireProjectId(): string {
    const p = currentProjectId() ?? ''
    if (!p) throw new BadRequestException('missing project context')
    return p
  }

  async list(): Promise<ApiKeySummary[]> {
    const projectId = isGlobalAccessEnabled() ? null : this.requireProjectId()
    return (await this.repo
      .listApiKeys(projectId)
    ).filter((r) => (r.access_level ?? 'project') !== 'system')
      .map((r) => ({
      id: r.id,
      name: r.name,
      key_prefix: r.key_prefix,
      flow_id: r.flow_id,
      scopes: (() => {
        if (!r.scopes_json) return []
        try {
          const p = JSON.parse(r.scopes_json) as unknown
          return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : []
        } catch {
          return []
        }
      })(),
      allowed_tools: (() => {
        if (!r.allowed_tools_json) return []
        try {
          const p = JSON.parse(r.allowed_tools_json) as unknown
          return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : []
        } catch {
          return []
        }
      })(),
      project_id: r.project_id || null,
      access_level: r.access_level === 'system' ? 'system' : 'project',
      expires_at: r.expires_at,
      create_time: r.create_time,
      last_used_at: r.last_used_at,
    }))
  }

  async create(body: {
    name?: string
    flow_id?: string | null
    scopes?: string[]
    project_id?: string | null
    expires_at?: string | null
    allowed_tools?: string[] | null
  }): Promise<{ summary: ApiKeySummary; secret: string }> {
    const scopedProjectId = this.requireProjectId()
    const name = body.name?.trim()
    if (!name) throw new BadRequestException('name is required')
    const secret = randomApiKeySecret()
    const prefix = secret.slice(0, 10)
    const id = SnowflakeUtil.nextId()
    const now = new Date().toISOString()
    const scopes = Array.isArray(body.scopes) ? body.scopes : ['run','webhook','search','documents']
    const expiresRaw = body.expires_at?.trim()
    const expires_at =
      expiresRaw && expiresRaw !== ''
        ? Number.isFinite(Date.parse(expiresRaw))
          ? new Date(expiresRaw).toISOString()
          : null
        : null
    if (expiresRaw && expiresRaw !== '' && !expires_at) {
      throw new BadRequestException('expires_at must be a valid ISO-8601 datetime')
    }
    const allowedTools = Array.isArray(body.allowed_tools)
      ? body.allowed_tools.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
      : []
    const allowed_tools_json = allowedTools.length > 0 ? JSON.stringify(allowedTools) : null

    const explicit = body.project_id?.trim() || ''
    const keyProjectId = explicit !== '' ? explicit : scopedProjectId
    if (keyProjectId !== scopedProjectId) {
      throw new BadRequestException('project_id on key must match current X-Project-Id')
    }

    await this.repo.insertApiKey({
      id,
      name,
      key_hash: hashApiKey(secret),
      key_prefix: prefix,
      flow_id: body.flow_id?.trim() || null,
      scopes_json: JSON.stringify(scopes),
      project_id: keyProjectId,
      access_level: 'project',
      expires_at,
      allowed_tools_json,
      create_time: now,
    })
    const row = await this.repo.getApiKeyById(id, scopedProjectId)
    if (!row) throw new BadRequestException('failed to create api key')
    const summary: ApiKeySummary = {
      id: row.id,
      name: row.name,
      key_prefix: row.key_prefix,
      flow_id: row.flow_id,
      scopes,
      allowed_tools: allowedTools,
      project_id: row.project_id || null,
      access_level: row.access_level === 'system' ? 'system' : 'project',
      expires_at: row.expires_at,
      create_time: row.create_time,
      last_used_at: row.last_used_at,
    }
    return { summary, secret }
  }

  async revoke(id: string): Promise<{ revoked: true }> {
    if (id === BUILTIN_SYSTEM_API_KEY_ID) {
      throw new BadRequestException('cannot revoke built-in system api key')
    }
    const projectId = isGlobalAccessEnabled() ? null : this.requireProjectId()
    const row = await this.repo.getApiKeyById(id, projectId)
    if (!row) throw new NotFoundException(`api key ${id} not found`)
    if (row.access_level === 'system' && !isGlobalAccessEnabled()) {
      throw new NotFoundException(`api key ${id} not found`)
    }
    await this.repo.revokeApiKey(row.access_level === 'system' ? null : row.project_id, id)
    return { revoked: true }
  }
}
