import { type Middleware } from '@dangao/bun-server'
import { createProjectContextMiddleware as createBaseProjectContextMiddleware } from '@cube-ai/server-base'

export function createProjectContextMiddleware(): Middleware {
  return createBaseProjectContextMiddleware()
}
