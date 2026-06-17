/**
 * 仅挂载 FlowModule（无 assistant / kb），默认端口 3320。
 * NOTE: 鉴权/project 上下文由 host 注入；此入口仅用于本地开发/测试。
 */
import 'reflect-metadata'
import { Application } from '@dangao/bun-server'
import { loadAppConfig } from '@cube-ai/ai-center/platform/server-base'
import { registerMockInterceptor } from './mock/index'
import { createDeveloperRateLimitMiddleware } from './middleware/developer-rate-limit.middleware'
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
  app.use(createDeveloperRateLimitMiddleware({ maxPerMin: config.devApiRateLimitPerMin }))
  await app.listen()
  console.log(`[@cube-ai/flow single] http://localhost:${config.port}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
