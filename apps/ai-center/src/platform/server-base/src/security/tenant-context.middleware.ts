import {
  BadRequestException,
  type Context,
  type Middleware,
  type NextFunction,
} from '@dangao/bun-server'
import {
  authenticatedUserAls,
  tenantContextAls,
} from '@cube-ai/server-shared'

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
 * 注入 tenantContextAls（用于管理面路由）。
 * tenant 来自 X-Tenant-Id 请求头，由上游身份中间件预先验证；不再查询 projects 表。
 * 超管在无 tenant 头时可启用全局可见模式（只读）。
 */
export function createTenantContextMiddleware(deps?: {
  skipPrefixes?: string[]
}): Middleware {
  const skipPrefixes = deps?.skipPrefixes ?? [
    '/health',
    '/run/',
    '/webhook/',
    '/search',
    '/documents',
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

    const raw = ctx.request.headers.get('x-tenant-id')?.trim()
    if (raw) {
      return tenantContextAls.run({ tenantId: raw, bypassTenantIsolation: false }, () => next())
    }

    const auth = authenticatedUserAls.getStore()
    if (auth?.isSuperAdmin && isReadonlyMethod(ctx.request.method.toUpperCase())) {
      return tenantContextAls.run({ tenantId: '', bypassTenantIsolation: true }, () => next())
    }

    throw new BadRequestException('X-Tenant-Id header is required')
  }
}
