import {
  DATABASE_SERVICE_TOKEN,
  DatabaseService,
  Global,
  LoggerModule,
  Module,
  type Container,
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
  PLATFORM_KB_SOURCE_PORT_TOKEN,
  createKbMysqlDatabaseServiceFromEnv,
  loadAppConfigSync as loadKbAppConfigSync,
} from '@cube-ai/kb-core';
import { Cube2PlatformKbSourcePort } from '../platform/cube2-platform-kb-source.port';

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
      useFactory: () => createKbMysqlDatabaseServiceFromEnv(),
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
    {
      provide: PLATFORM_KB_SOURCE_PORT_TOKEN,
      useFactory: () => new Cube2PlatformKbSourcePort(),
    },
  ],
  exports: [DATABASE_SERVICE_TOKEN, DatabaseService, KB_APP_CONFIG_TOKEN, EMBEDDING_PORT_TOKEN, PLATFORM_KB_SOURCE_PORT_TOKEN],
})
export class AiCenterKbHttpModule {}
