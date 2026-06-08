import {
  DATABASE_SERVICE_TOKEN,
  DatabaseService,
  Global,
  LoggerModule,
  Module,
  type Container,
  type DatabaseModuleOptions,
} from '@dangao/bun-server';
import {
  AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN,
  EMBEDDING_PORT_TOKEN,
  type LlmProviderPort,
} from '@cube-ai/contracts/platform';
import { LlmProviderModule } from '@cube-ai/agent-engine/adapters/platform';
import { LlmProviderEmbeddingPort } from '@cube-ai/embedding';
import {
  AiKbModule,
  APP_CONFIG_TOKEN as KB_APP_CONFIG_TOKEN,
  KbDatabaseBootstrap,
  loadAppConfigSync as loadKbAppConfigSync,
} from '@cube-ai/kb-core';

function buildDatabaseOptionsFromEnv(): DatabaseModuleOptions {
  const raw = (Bun.env.CUBE_LOCAL_DEV ?? process.env.CUBE_LOCAL_DEV ?? '').trim().toLowerCase();
  const localDev = raw === '1' || raw === 'true' || raw === 'yes';
  if (localDev) {
    const sqlitePath =
      Bun.env.CUBE_AI_SQLITE_PATH?.trim() ||
      process.env.CUBE_AI_SQLITE_PATH?.trim() ||
      'cube-ai.local.sqlite';
    return {
      database: {
        type: 'sqlite',
        config: { path: sqlitePath },
      },
      enableHealthCheck: false,
    };
  }
  return {
    database: {
      type: 'mysql',
      config: {
        host: process.env.MYSQL_HOST ?? 'localhost',
        port: Number(process.env.MYSQL_PORT ?? '3306'),
        database: process.env.MYSQL_DATABASE ?? 'cube_ai',
        user: process.env.MYSQL_USER ?? 'root',
        password: process.env.MYSQL_PASSWORD ?? '',
      },
    },
    pool: {
      maxConnections: 10,
      connectionTimeout: 30000,
      retryCount: 3,
      retryDelay: 1000,
    },
    enableHealthCheck: true,
  };
}

function resolveKbEmbeddingModel(
  kbConfig: ReturnType<typeof loadKbAppConfigSync>,
): string {
  return (
    Bun.env.KB_EMBEDDING_MODEL?.trim() ||
    process.env.KB_EMBEDDING_MODEL?.trim() ||
    kbConfig.embeddingModel
  );
}

function resolveKbEmbeddingTenant(): number {
  const raw = Bun.env.KB_EMBEDDING_TENANT ?? process.env.KB_EMBEDDING_TENANT ?? '0';
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Full kb HTTP surface for `/kb/*` domain prefix (AiKbModule + ORM bootstrap). */
@Global()
@Module({
  imports: [LlmProviderModule, LoggerModule.forRoot(), AiKbModule],
  providers: [
    {
      provide: DATABASE_SERVICE_TOKEN,
      useFactory: () => new DatabaseService(buildDatabaseOptionsFromEnv()),
    },
    {
      provide: DatabaseService,
      useFactory: (container: Container) => container.resolve(DATABASE_SERVICE_TOKEN) as DatabaseService,
    },
    KbDatabaseBootstrap,
    {
      provide: KB_APP_CONFIG_TOKEN,
      useFactory: () => loadKbAppConfigSync(),
    },
    {
      provide: EMBEDDING_PORT_TOKEN,
      useFactory: (container: Container) => {
        const kbConfig = loadKbAppConfigSync();
        return new LlmProviderEmbeddingPort({
          provider: container.resolve(AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN) as LlmProviderPort,
          modelCode: resolveKbEmbeddingModel(kbConfig),
          tenant: resolveKbEmbeddingTenant(),
          dimension: kbConfig.qdrantVectorSize,
        });
      },
    },
  ],
  exports: [DATABASE_SERVICE_TOKEN, DatabaseService, KB_APP_CONFIG_TOKEN, EMBEDDING_PORT_TOKEN],
})
export class AiCenterKbHttpModule {}
