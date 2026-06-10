import type { Context, Middleware, NextFunction } from '@dangao/bun-server'
import { cube2OutboundAuthAls } from './cube2-outbound-auth-context'

function resolveTenantHeader(ctx: Context): string | null {
  const headers = ctx.request.headers
  return (
    headers.get('tenant')?.trim() ||
    headers.get('x-tenant-id')?.trim() ||
    headers.get('x-project-id')?.trim() ||
    null
  )
}

/** Propagate inbound HTTP tenant/authorization to outbound cube2 gRPC calls within the same request. */
export function createCube2OutboundAuthMiddleware(): Middleware {
  return async (ctx: Context, next: NextFunction) => {
    const authorization = ctx.request.headers.get('authorization')
    const tenant = resolveTenantHeader(ctx)
    const terminal = ctx.request.headers.get('terminal')
    return cube2OutboundAuthAls.run(
      {
        tenant,
        authorization,
        terminal,
      },
      () => next(),
    )
  }
}
