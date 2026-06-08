/**
 * 仅知识库 HTTP（无 JWT/Nacos/MySQL 等宿主能力），默认端口 3322。复杂能力请用 bootstrap。
 */
import 'reflect-metadata'
import { Application } from '@dangao/bun-server'
import { loadAppConfig } from '@/config/app.config'
import { registerMockInterceptor } from '@/infra/mock-endpoint'
import { AiKbModule } from './modules/ai-kb.module'
import './mock/index'

async function main(): Promise<void> {
  const config = await loadAppConfig()
  const app = new Application({
    port: config.port,
    hostname: config.hostname ?? '0.0.0.0',
    idleTimeout: config.serverIdleTimeoutMs,
  })
  registerMockInterceptor(app.getContainer())
  app.registerModule(AiKbModule)
  await app.listen()
  console.log(`[@cube-ai/kb single] http://localhost:${config.port}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
