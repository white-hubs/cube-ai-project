/**
 * 仅挂载 FlowModule（无 assistant / kb），默认端口 3320。
 * NOTE: 鉴权/project 上下文由 host 注入；此入口仅用于本地开发/测试。
 */
import "reflect-metadata";
import { Application } from "@dangao/bun-server";

import { loadAppConfig } from "@cube-ai/ai-center/platform/server-base";

import { FlowModule } from "./flow.module";
import { createDeveloperRateLimitMiddleware } from "./middleware/developer-rate-limit.middleware";
import { registerMockInterceptor } from "./mock/index";

async function main(): Promise<void> {
  const config = await loadAppConfig();
  const app = new Application({
    hostname: config.hostname ?? "0.0.0.0",
    idleTimeout: config.serverIdleTimeoutMs,
    port: config.port,
    sseKeepAlive: { intervalMs: 15_000 },
  });
  registerMockInterceptor(app.getContainer());
  app.registerModule(FlowModule);
  app.use(createDeveloperRateLimitMiddleware({ maxPerMin: config.devApiRateLimitPerMin }));
  await app.listen();
  console.log(`[@cube-ai/flow single] http://localhost:${config.port}`);
}

try {
  await main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
