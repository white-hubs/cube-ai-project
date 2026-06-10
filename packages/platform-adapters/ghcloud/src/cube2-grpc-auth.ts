import type { Interceptor } from '@connectrpc/connect'
import { readCube2OutboundAuthContext } from './cube2-outbound-auth-context'
import { getCube2InternalAccessToken } from './cube2-internal-rpc-auth'
import { createGrpcInnerInvokeSignature } from './grpc-inner-invoke'

function readEnv(key: string): string | undefined {
  const raw = Bun.env[key] ?? process.env[key]
  const trimmed = raw?.trim()
  return trimmed ? trimmed : undefined
}

function readInnerInvokeTimeoutSec(): number {
  const raw =
    readEnv('CUBE2_INTERNAL_INVOKE_TIMEOUT_SEC') ??
    readEnv('GHCLOUD_INTERNAL_INVOKE_TIMEOUT_SEC') ??
    readEnv('INTERNAL_INVOKE_TIMEOUT_SEC')
  if (!raw) {
    return 60
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60
}

function appendHeaderIfMissing(headers: Headers, key: string, value: string | null | undefined): void {
  if (!value || value.trim() === '' || headers.has(key)) {
    return
  }
  headers.set(key, value.trim())
}

/** Mirrors ghcloud ai-server-base GrpcClientAuthService header augmentation. */
export function createCube2GrpcAuthInterceptor(): Interceptor {
  return (next) => async (req) => {
    const auth = readCube2OutboundAuthContext()
    appendHeaderIfMissing(req.header, 'tenant', auth.tenant)
    appendHeaderIfMissing(req.header, 'terminal', auth.terminal)
    if (auth.authorization && !req.header.has('authorization')) {
      req.header.set('authorization', auth.authorization)
    }

    const secretKey =
      readEnv('CUBE2_INTERNAL_INVOKE_SECRET_KEY') ??
      readEnv('GHCLOUD_INTERNAL_INVOKE_SECRET_KEY') ??
      readEnv('INTERNAL_INVOKE_SECRET_KEY')
    if (secretKey && !req.header.has('feign_inner_invoke')) {
      const expiresAtMs = Date.now() + readInnerInvokeTimeoutSec() * 1000
      req.header.set('feign_inner_invoke', createGrpcInnerInvokeSignature(secretKey, expiresAtMs))
    }

    if (!req.header.has('authorization')) {
      const accessToken = await getCube2InternalAccessToken()
      if (accessToken) {
        req.header.set('authorization', `Bearer ${accessToken}`)
      }
    }

    return next(req)
  }
}
