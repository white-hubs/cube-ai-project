import type { AccessTokenReader, DeveloperApiKeyReader } from '@cube-ai/ai-center/platform/server-base'
import type { SecurityContextHolder } from './security-context'
import type { SessionContextHolder } from './session-context'
import { createJwtAuthMiddleware } from './jwt-auth'
import { createSessionContextMiddleware } from './session-context'
import { createTenantValidationMiddleware } from './tenant-validation'
import { createJwtKeyLoader } from './jwt-key-loader'
import { securityContextHolder } from './security-context'
import { sessionContextHolder } from './session-context'

/**
 * Maps ghcloud JWT principal (already validated by {@link createJwtAuthMiddleware})
 * into cube-ai {@link AccessTokenReader} record for {@link createExecutionAuthMiddleware}.
 */
export function createGhcloudAccessTokenReader(
  securityHolder: SecurityContextHolder,
  sessionHolder: SessionContextHolder,
): AccessTokenReader {
  return {
    async verifyAccessToken(rawToken: string) {
      const ctx = securityHolder.getContext()
      if (!ctx?.principal) return null

      const session = sessionHolder.getContext()
      const bearer = session?.authorization?.replace(/^Bearer\s+/i, '').trim()
      if (bearer && bearer !== rawToken.trim()) return null

      return {
        userId: String(ctx.principal.id),
        username: ctx.principal.account || ctx.principal.name,
        role: ctx.principal.admin ? 'admin' : 'user',
        isSuperAdmin: ctx.principal.admin,
      }
    },
  }
}

/**
 * Host PAT reader seam. Grants (scopes/flow binding) remain in flow DB — delegate to flow reader when provided.
 */
export function createHostPatReader(fallback?: DeveloperApiKeyReader): DeveloperApiKeyReader {
  if (fallback) {
    return fallback
  }
  return {
    async verifyApiKeyRaw() {
      return null
    },
  }
}

export interface GhcloudIdentityMiddlewareOptions {
  jwtKeyUrl: string
  securityHolder?: SecurityContextHolder
  sessionHolder?: SessionContextHolder
}

/** HTTP middleware chain: session → JWT RS256 → tenant validation (matches ai-server wiring). */
export function createGhcloudIdentityMiddleware(options: GhcloudIdentityMiddlewareOptions) {
  const securityHolder = options.securityHolder ?? securityContextHolder
  const sessionHolder = options.sessionHolder ?? sessionContextHolder
  const keyLoader = createJwtKeyLoader(options.jwtKeyUrl)

  return [
    createSessionContextMiddleware(sessionHolder),
    createJwtAuthMiddleware({ holder: securityHolder, keyLoader }),
    createTenantValidationMiddleware(securityHolder, sessionHolder),
  ] as const
}

export function createGhcloudExecutionAuthReaders(options: {
  securityHolder?: SecurityContextHolder
  sessionHolder?: SessionContextHolder
  apiKeyFallback?: DeveloperApiKeyReader
}) {
  const securityHolder = options.securityHolder ?? securityContextHolder
  const sessionHolder = options.sessionHolder ?? sessionContextHolder
  return {
    accessTokenReader: createGhcloudAccessTokenReader(securityHolder, sessionHolder),
    apiKeyReader: createHostPatReader(options.apiKeyFallback),
  }
}
