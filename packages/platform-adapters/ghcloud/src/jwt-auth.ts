import { UnauthorizedException, type Context, type Middleware, type NextFunction } from '@dangao/bun-server'
import { PrincipalType, type Principal, type SecurityContext, type SecurityContextHolder } from './security-context'
import { type VerificationKey, verifyJwtRs256 } from './jwt-crypto'

function payloadToSecurityContext(payload: Record<string, unknown>): SecurityContext | null {
  const idRaw = payload.id ?? payload.sub
  const id =
    typeof idRaw === 'number'
      ? idRaw
      : typeof idRaw === 'string'
        ? Number.parseInt(idRaw, 10)
        : Number.NaN
  if (!Number.isFinite(id)) return null

  const typeRaw = payload.type
  let type: PrincipalType = PrincipalType.USER
  if (typeRaw === 'CLIENT' || typeRaw === PrincipalType.CLIENT) {
    type = PrincipalType.CLIENT
  }

  const adminRaw = payload.admin
  const admin = typeof adminRaw === 'boolean' ? adminRaw : adminRaw === 'true' || adminRaw === 1 || adminRaw === '1'
  const name = typeof payload.name === 'string' ? payload.name : typeof payload.username === 'string' ? payload.username : ''
  const account = typeof payload.account === 'string' ? payload.account : typeof payload.sub === 'string' ? payload.sub : ''
  const principal: Principal = { id, type, admin, name, account }
  return { principal, payload }
}

function assertJwtTemporalClaims(payload: Record<string, unknown>, nowSec = Math.floor(Date.now() / 1000)): void {
  const exp = payload.exp
  if (exp != null) {
    const expSec = typeof exp === 'number' ? exp : Number.parseInt(String(exp), 10)
    if (!Number.isFinite(expSec) || expSec <= nowSec) {
      throw new UnauthorizedException('token expired')
    }
  }

  const nbf = payload.nbf
  if (nbf != null) {
    const nbfSec = typeof nbf === 'number' ? nbf : Number.parseInt(String(nbf), 10)
    if (!Number.isFinite(nbfSec) || nbfSec > nowSec) {
      throw new UnauthorizedException('token not active')
    }
  }
}

export interface JwtAuthMiddlewareOptions {
  holder: SecurityContextHolder
  keyLoader?: { getVerificationKey: () => Promise<VerificationKey | null> }
  verifyJwt?: (token: string, key: VerificationKey) => Promise<Record<string, unknown>>
  whitelistPrefixes?: string[]
}

export function createJwtAuthMiddleware(options: JwtAuthMiddlewareOptions | SecurityContextHolder): Middleware {
  const holder = 'holder' in options ? options.holder : options
  const keyLoader = 'keyLoader' in options ? options.keyLoader : undefined
  const verifyJwt = 'verifyJwt' in options && options.verifyJwt ? options.verifyJwt : verifyJwtRs256
  const whitelistPrefixes =
    'whitelistPrefixes' in options && options.whitelistPrefixes
      ? options.whitelistPrefixes
      : ['/health', '/metrics']

  return async (ctx: Context, next: NextFunction) => {
    try {
      if (whitelistPrefixes.some((prefix) => ctx.path.startsWith(prefix))) {
        return next()
      }

      const auth = ctx.request.headers.get('authorization')
      if (!auth?.startsWith('Bearer ')) {
        throw new UnauthorizedException('missing Authorization: Bearer token')
      }

      const token = auth.slice('Bearer '.length).trim()
      if (!keyLoader) {
        throw new UnauthorizedException('JWT verification key loader is required')
      }
      const key = await keyLoader.getVerificationKey()
      if (!key) {
        throw new UnauthorizedException('JWT verification key is unavailable')
      }
      const payload = await verifyJwt(token, key)
      assertJwtTemporalClaims(payload)
      const securityContext = payloadToSecurityContext(payload)

      if (!securityContext) {
        throw new UnauthorizedException('invalid token')
      }

      holder.setContext(securityContext)
      return await next()
    } finally {
      holder.clearContext()
    }
  }
}
