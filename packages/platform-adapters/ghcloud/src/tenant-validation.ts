import { UnauthorizedException, type Context, type Middleware, type NextFunction } from '@dangao/bun-server'
import type { SecurityContextHolder } from './security-context'
import type { SessionContextHolder } from './session-context'

function normalizeTenant(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') return value.trim()
  return String(value)
}

function tenantsFromPayload(payload: Record<string, unknown> | undefined): string[] {
  const raw = payload?.tenants
  if (!Array.isArray(raw)) return []
  return raw.map((value) => normalizeTenant(value)).filter((value) => value !== '')
}

export function createTenantValidationMiddleware(
  securityHolder: SecurityContextHolder,
  sessionHolder: SessionContextHolder,
  options?: { whitelistPrefixes?: string[] },
): Middleware {
  const whitelistPrefixes = options?.whitelistPrefixes ?? ['/health', '/metrics']

  return async (ctx: Context, next: NextFunction) => {
    if (whitelistPrefixes.some((prefix) => ctx.path.startsWith(prefix))) {
      return next()
    }

    const session = sessionHolder.getContext()
    const tenantFromHeader =
      session?.tenant != null &&
      ((typeof session.tenant === 'number' && Number.isFinite(session.tenant)) || typeof session.tenant === 'string')
        ? normalizeTenant(session.tenant)
        : ctx.request.headers.get('tenant')?.trim() ?? ''

    if (tenantFromHeader === '') {
      throw new UnauthorizedException('missing or invalid tenant header')
    }

    const securityContext = securityHolder.getContext()
    if (!securityContext?.payload) {
      throw new UnauthorizedException('tenant check requires authenticated context')
    }

    const allowedTenants = tenantsFromPayload(securityContext.payload)
    if (!allowedTenants.some((tenant) => tenant === tenantFromHeader)) {
      throw new UnauthorizedException('tenant not in token tenants')
    }

    return next()
  }
}
