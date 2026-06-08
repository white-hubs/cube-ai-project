/**
 * 仅挂载 FlowModule（无 assistant / kb），默认端口 3320。
 */
import 'reflect-metadata'
import { Application } from '@dangao/bun-server'
import { loadAppConfig } from '@cube-ai/server-base'
import { registerMockInterceptor } from './mock/index'
import { createExecutionAuthMiddleware } from '@cube-ai/server-base'
import { createDeveloperRateLimitMiddleware } from './middleware/developer-rate-limit.middleware'
import { createProjectContextMiddleware } from './middleware/project-context.middleware'
import {
  createFlowAccessTokenReader,
  createFlowDeveloperApiKeyReader,
  createFlowProjectLookup,
} from './auth/flow-auth-adapters'
import { FlowModule } from './flow.module'

async function main(): Promise<void> {
  const config = await loadAppConfig()
  const app = new Application({
    port: config.port,
    hostname: config.hostname ?? '0.0.0.0',
    idleTimeout: config.serverIdleTimeoutMs,
    sseKeepAlive: { intervalMs: 15_000 },
  })
  registerMockInterceptor(app.getContainer())
  app.registerModule(FlowModule)
  app.use(
    createExecutionAuthMiddleware({
      accessTokenReader: createFlowAccessTokenReader(),
      apiKeyReader: createFlowDeveloperApiKeyReader(),
      projectLookup: createFlowProjectLookup(),
    }),
  )
  app.use(createDeveloperRateLimitMiddleware({ maxPerMin: config.devApiRateLimitPerMin }))
  app.use(createProjectContextMiddleware())
  await app.listen()
  console.log(`[@cube-ai/flow single] http://localhost:${config.port}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
