import {
  UnauthorizedException,
  type Context,
  type Middleware,
  type NextFunction,
} from '@dangao/bun-server'
import {
  authenticatedUserAls,
  projectContextAls,
} from '@cube-ai/server-shared'
import type {
  AccessTokenReader,
} from './middleware-types'

function parseBearerAuth(headerValue: string | null): string | null {
  const raw = headerValue?.trim() ?? ''
  if (!raw || !raw.toLowerCase().startsWith('bearer ')) return null
  const token = raw.slice(7).trim()
  return token !== '' ? token : null
}

function isPublicPath(path: string): boolean {
  return path === '/health' || path.startsWith('/health/') || path === '/metrics'
}

/**
 * Verifies the incoming Bearer token and injects tenant context into ALS.
 * Tenant validity is guaranteed by the upstream tenant-validation middleware (JWT tenants[]).
 * API key path is retired (ADR-0012 addendum D3 — no self-managed auth in ability packages).
 */
export function createExecutionAuthMiddleware(deps: {
  accessTokenReader: AccessTokenReader
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
        const tenantRaw = ctx.request.headers.get('tenant')?.trim() ?? ''
        const bypassIsolation = auth.isSuperAdmin && tenantRaw === ''
        return authenticatedUserAls.run(auth, () =>
          projectContextAls.run(
            { projectId: tenantRaw, bypassProjectIsolation: bypassIsolation },
            () => next(),
          ),
        )
      }
    }

    throw new UnauthorizedException('missing or invalid bearer token')
  }
}
