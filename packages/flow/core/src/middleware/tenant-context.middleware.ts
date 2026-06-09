import { type Middleware } from '@dangao/bun-server'
import { createTenantContextMiddleware as createBaseTenantContextMiddleware } from '@cube-ai/server-base'

export function createTenantContextMiddleware(): Middleware {
  return createBaseTenantContextMiddleware()
}
