import {
  BadRequestException,
  type Context,
  type Middleware,
  type NextFunction,
} from '@dangao/bun-server'
import {
  authenticatedUserAls,
  tenantContextAls,
} from '@cube-ai/ai-center/platform/server-shared'

function matchesAnyPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => {
    if (path === prefix) return true
    return path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
  })
}

function isReadonlyMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

/** 与 execution-auth / CubeGateway 对齐：`tenant` 为主，`x-tenant-id` 作兼容兜底。 */
function resolveTenantHeader(ctx: Context): string {
  return (
    ctx.request.headers.get('tenant')?.trim() ??
    ctx.request.headers.get('x-tenant-id')?.trim() ??
    ''
  )
}

/**
 * 注入 tenantContextAls（用于管理面路由）。
 * tenant 来自 `tenant` 请求头（CubeGateway 标准），由上游身份中间件预先验证；不再查询 projects 表。
 * 超管在无 tenant 头时可启用全局可见模式（只读）。
 */
export function createTenantContextMiddleware(deps?: {
  skipPrefixes?: string[]
}): Middleware {
  const skipPrefixes = deps?.skipPrefixes ?? [
    '/health',
    '/flow/run/',
    '/flow/webhook/',
    '/kb',
    '/swagger',
    '/oauth2/',
    '/auth/',
  ]
  return async (ctx: Context, next: NextFunction) => {
    const path = ctx.path
    if (matchesAnyPrefix(path, skipPrefixes)) {
      return next()
    }

    // execution-auth 已注入时直接透传，避免重复解析/覆盖。
    if (tenantContextAls.getStore()) {
      return next()
    }

    const raw = resolveTenantHeader(ctx)
    if (raw) {
      return tenantContextAls.run({ tenantId: raw, bypassTenantIsolation: false }, () => next())
    }

    const auth = authenticatedUserAls.getStore()
    if (auth?.isSuperAdmin && isReadonlyMethod(ctx.request.method.toUpperCase())) {
      return tenantContextAls.run({ tenantId: '', bypassTenantIsolation: true }, () => next())
    }

    throw new BadRequestException('tenant header is required')
  }
}
