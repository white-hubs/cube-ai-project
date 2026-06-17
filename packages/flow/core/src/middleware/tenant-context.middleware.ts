import { type Middleware } from '@dangao/bun-server'
import { createTenantContextMiddleware as createBaseTenantContextMiddleware } from '@cube-ai/ai-center/platform/server-base'

export function createTenantContextMiddleware(): Middleware {
  return createBaseTenantContextMiddleware()
}
