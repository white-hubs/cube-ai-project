import {
  BadRequestException,
  NotFoundException,
  type Context,
  type Middleware,
  type NextFunction,
} from '@dangao/bun-server'
import {
  authenticatedUserAls,
  tenantContextAls,
} from '@cube-ai/server-shared'
import type { ProjectLookup } from './middleware-types'

function matchesAnyPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => {
    if (path === prefix) return true
    return path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
  })
}

function isReadonlyMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

/**
 * 注入 tenantContextAls。
 * 超管可在管理面缺省 tenant 时启用全局可见模式。
 */
export function createProjectContextMiddleware(deps: {
  projectLookup: ProjectLookup
  skipPrefixes?: string[]
}): Middleware {
  const skipPrefixes = deps.skipPrefixes ?? [
    '/health',
    '/run/',
    '/webhook/',
    '/search',
    '/documents',
    '/projects',
    '/components',
    '/swagger',
    '/oauth2/',
    '/auth/',
  ]
  return async (ctx: Context, next: NextFunction) => {
    const path = ctx.path
    if (matchesAnyPrefix(path, skipPrefixes)) {
      return next()
    }

    const raw = ctx.request.headers.get('x-project-id')?.trim()
    if (raw) {
      if (!(await deps.projectLookup.hasProject(raw))) {
        throw new NotFoundException(`tenant not found: ${raw}`)
      }
      return tenantContextAls.run({ tenantId: raw, bypassTenantIsolation: false }, () => next())
    }

    const auth = authenticatedUserAls.getStore()
    if (auth?.isSuperAdmin && isReadonlyMethod(ctx.request.method.toUpperCase())) {
      return tenantContextAls.run({ tenantId: '', bypassTenantIsolation: true }, () => next())
    }

    const allTenantIds = await deps.projectLookup.listProjectIds()
    if (allTenantIds.length === 1) {
      const only = allTenantIds[0]
      if (!only) throw new BadRequestException('invalid tenant state')
      return tenantContextAls.run({ tenantId: only, bypassTenantIsolation: false }, () => next())
    }
    if (allTenantIds.length === 0) {
      throw new BadRequestException('no tenants configured')
    }
    throw new BadRequestException('X-Project-Id header is required when multiple tenants exist')
  }
}
