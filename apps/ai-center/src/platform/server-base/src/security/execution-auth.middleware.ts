import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  type Context,
  type Middleware,
  type NextFunction,
} from '@dangao/bun-server'
import {
  authenticatedUserAls,
  developerApiAls,
  projectContextAls,
} from '@cube-ai/server-shared'
import type {
  AccessTokenReader,
  AccessTokenRecord,
  DeveloperApiAccessLevel,
  DeveloperApiKeyReader,
  ProjectLookup,
} from './middleware-types'

function parseBearerAuth(headerValue: string | null): string | null {
  const raw = headerValue?.trim() ?? ''
  if (!raw || !raw.toLowerCase().startsWith('bearer ')) return null
  const token = raw.slice(7).trim()
  return token !== '' ? token : null
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function normalizeAccessLevel(raw: string | null | undefined): DeveloperApiAccessLevel {
  return raw === 'system' ? 'system' : 'project'
}

function isReadonlyMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

function isPublicPath(path: string): boolean {
  return path === '/health' || path.startsWith('/health/') || path === '/metrics'
}

function readRequestedProjectId(ctx: Context): string | null {
  const xProjectId = ctx.request.headers.get('x-project-id')?.trim() ?? ''
  if (xProjectId) return xProjectId
  const compatProjectId = ctx.request.headers.get('project_id')?.trim() ?? ''
  return compatProjectId || null
}

async function resolveAuthenticatedProjectContext(input: {
  requestedProjectId: string | null
  auth: AccessTokenRecord
  projectLookup: ProjectLookup
  method: string
}): Promise<{ projectId: string; bypassProjectIsolation: boolean }> {
  const requestedProjectId = input.requestedProjectId?.trim() ?? ''
  if (requestedProjectId) {
    if (!(await input.projectLookup.hasProject(requestedProjectId))) {
      throw new NotFoundException(`project not found: ${requestedProjectId}`)
    }
    return { projectId: requestedProjectId, bypassProjectIsolation: false }
  }

  if (input.auth.isSuperAdmin && !requestedProjectId) {
    return { projectId: '', bypassProjectIsolation: true }
  }

  const allProjectIds = await input.projectLookup.listProjectIds()
  if (allProjectIds.length === 1) {
    const only = allProjectIds[0]
    if (!only) throw new BadRequestException('invalid projects state')
    return { projectId: only, bypassProjectIsolation: false }
  }
  if (allProjectIds.length === 0) {
    throw new BadRequestException('no projects exist; create one via POST /projects')
  }
  throw new BadRequestException('X-Project-Id header is required when multiple projects exist')
}

function assertApiKeyScopeAllowed(path: string, scopesJson: string | null): void {
  const scopes = parseStringArray(scopesJson)
  const isWebhook = path.startsWith('/webhook/')
  const isKbRoute =
    path === '/search' ||
    path.startsWith('/search/') ||
    path === '/documents' ||
    path.startsWith('/documents/')
  const scopeOk =
    scopes.length === 0 ||
    scopes.includes('*') ||
    (isWebhook
      ? scopes.includes('webhook') || scopes.includes('run')
      : isKbRoute
        ? scopes.includes('kb') || scopes.includes('search') || scopes.includes('documents') || scopes.includes('run')
        : scopes.includes('run'))
  if (!scopeOk) {
    throw new UnauthorizedException('api key scope does not allow this operation')
  }
}

export function createExecutionAuthMiddleware(deps: {
  accessTokenReader: AccessTokenReader
  apiKeyReader: DeveloperApiKeyReader
  projectLookup: ProjectLookup
  prefixes?: string[]
}): Middleware {
  const prefixes = deps.prefixes ?? ['/oauth2']
  return async (ctx: Context, next: NextFunction) => {
    if (isPublicPath(ctx.path) || prefixes.some((prefix) => ctx.path.startsWith(prefix))) {
      return next()
    }
    const rawToken = parseBearerAuth(ctx.request.headers.get('authorization'))
    if (rawToken) {
      const auth = await deps.accessTokenReader.verifyAccessToken(rawToken)
      if (auth) {
        const projectContext = await resolveAuthenticatedProjectContext({
          requestedProjectId: readRequestedProjectId(ctx),
          auth,
          projectLookup: deps.projectLookup,
          method: ctx.request.method.toUpperCase(),
        })
        return authenticatedUserAls.run(auth, () =>
          projectContextAls.run(projectContext, () => next()),
        )
      }
    }

    const rawApiKey = ctx.request.headers.get('x-api-key')?.trim()
    if (!rawApiKey) {
      throw new UnauthorizedException('missing bearer token or x-api-key')
    }
    const row = await deps.apiKeyReader.verifyApiKeyRaw(rawApiKey)
    if (!row) {
      throw new UnauthorizedException('invalid, revoked, or expired api key')
    }

    assertApiKeyScopeAllowed(ctx.path, row.scopes_json)

    const accessLevel = normalizeAccessLevel(row.access_level)
    const allowedToolsRaw = parseStringArray(row.allowed_tools_json)
    const allowedTools = allowedToolsRaw.length > 0 ? allowedToolsRaw : null
    const baseContext = {
      apiKeyId: row.id,
      flowIdScope: row.flow_id,
      allowedTools,
      accessLevel,
    } as const

    if (accessLevel === 'system') {
      return developerApiAls.run(
        { ...baseContext, projectId: null },
        () => projectContextAls.run({ projectId: '', bypassProjectIsolation: true }, () => next()),
      )
    }

    const keyProjectId = row.project_id?.trim() ?? ''
    if (!keyProjectId) {
      throw new UnauthorizedException('API key has no project_id; re-issue the key')
    }
    const requestedProjectId = readRequestedProjectId(ctx)
    if (!requestedProjectId) {
      throw new UnauthorizedException('missing X-Project-Id header for project-scoped api key')
    }
    if (!(await deps.projectLookup.hasProject(requestedProjectId))) {
      throw new NotFoundException(`project not found: ${requestedProjectId}`)
    }
    if (requestedProjectId !== keyProjectId) {
      throw new UnauthorizedException('x-api-key does not belong to requested project')
    }

    return developerApiAls.run(
      { ...baseContext, projectId: keyProjectId },
      () => projectContextAls.run({ projectId: keyProjectId, bypassProjectIsolation: false }, () => next()),
    )
  }
}
