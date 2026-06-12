import { Module, type Container } from '@dangao/bun-server';
import { AGENTIC_PLATFORM_LLM_CATALOG_TOKEN } from '@cube-ai/contracts/platform';
import {
  InMemoryCatalogStore,
  InMemoryLlmCatalogPort,
  MysqlLlmCatalogPort,
  createDefaultCatalogSeed,
  type CatalogMysqlPool,
} from '@cube-ai/llm-core';
import { MYSQL_POOL_TOKEN } from '../../infra/mysql/mysql.tokens';

/**
 * 真实 LLM catalog 装配，与 engine/flow 共用同一 MySQL（库 `cube_ai_center`）：
 *   1. 有 MySQL 连接（`AGENTIC_ENGINE_MYSQL_URL`）→ `MysqlLlmCatalogPort`，
 *      数据由 `tools/migration/catalog-migrate.ts --target mysql` 从 ghcloud
 *      `cube_base_ai_application` 迁入真实 provider/model/凭据。
 *   2. 无 MySQL 且 `CUBE_AI_CATALOG_DEV_SEED=1` → 内置占位种子（离线联调，密钥占位）。
 *   3. 否则空目录（chat/embed 解析阶段报无目录条目）。
 *
 * 不再使用独立 SQLite catalog —— catalog 与其余领域同库持久化，避免多数据源/无写回。
 */
@Module({
  providers: [
    {
      provide: AGENTIC_PLATFORM_LLM_CATALOG_TOKEN,
      useFactory: (c: Container) => {
        // 兜底：某些组合上下文里 MysqlModule 可能未注册到当前容器链，resolve 会抛错。
        let pool: CatalogMysqlPool | null = null;
        try {
          pool = c.resolve(MYSQL_POOL_TOKEN) as CatalogMysqlPool | null;
        } catch {
          pool = null;
        }
        if (pool) {
          return new MysqlLlmCatalogPort(pool);
        }
        if (process.env['CUBE_AI_CATALOG_DEV_SEED'] === '1') {
          return new InMemoryLlmCatalogPort(new InMemoryCatalogStore(createDefaultCatalogSeed()));
        }
        return new InMemoryLlmCatalogPort(new InMemoryCatalogStore());
      },
    },
  ],
  exports: [AGENTIC_PLATFORM_LLM_CATALOG_TOKEN],
})
export class LlmCatalogModule {}
