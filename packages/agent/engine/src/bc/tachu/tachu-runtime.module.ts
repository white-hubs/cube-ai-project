import { Module, type Container } from '@dangao/bun-server';
import type { MemorySystem } from '@tachu/core';
import {
  AGENTIC_MEMORY_SYSTEM_TOKEN,
  TACHU_VECTOR_INDEX_TOKEN,
} from '@cube-ai/agent-engine/adapters/tokens';
import { TachuProviderModule } from '@cube-ai/agent-engine/adapters';
import { InMemoryStore, RedisMemoryStore, MysqlProjectionOutbox, RedisProjectedMemorySystem } from '@cube-ai/agent-engine/adapters/memory';
import { CubeQdrantMemoryIndex } from '@cube-ai/agent-engine/adapters/vector';
import { createTurnAwareEmbeddingRuntime } from '@cube-ai/agent-engine/adapters/embedding';
import { OutboxExtModule } from '@cube-ai/bun-server-ext-outbox';
import {
  AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN,
  type LlmProviderPort,
} from '@cube-ai/contracts/platform';
import { createEngineMysqlPool } from '../session/mysql-pool';
import { createTurnContextHolder } from './turn-context-holder';
import {
  TURN_CONTEXT_HOLDER_TOKEN,
  TURN_AWARE_EMBEDDING_RUNTIME_TOKEN,
  MEMORY_PROJECTION_RELAY_TOKEN,
} from './tachu.tokens';
import { resolveSkillEmbeddingModelCode } from '../skill-activation/skill-embedding-config';
import { resolveNonEmptyModel } from './tachu.tokens';
import { MemoryProjectionRelayService } from '../../infra/memory-projection/memory-projection-relay.service';
import { sharedSfidService } from '../../infra/sfid/shared-sfid';

const memoryKind = process.env['AGENTIC_ENGINE_MEMORY_KIND'] ?? 'in-memory';

function createMemorySystem(): MemorySystem {
  if (memoryKind !== 'redis') {
    return new InMemoryStore();
  }

  const store = new RedisMemoryStore({
    redisUrl: process.env['AGENTIC_ENGINE_REDIS_URL'] ?? 'redis://localhost:6379',
    keyPrefix: 'agentic:engine:memory:',
    ttlSeconds: Number(process.env['AGENTIC_ENGINE_MEMORY_TTL_SECONDS'] ?? '604800'),
    tenantId: Number(process.env['AGENTIC_ENGINE_MEMORY_TENANT_ID'] ?? '1'),
  });

  const pool = createEngineMysqlPool();
  const outbox =
    pool !== null
      ? new MysqlProjectionOutbox({
          pool,
          tenantId: Number(process.env['AGENTIC_ENGINE_MEMORY_TENANT_ID'] ?? '1'),
          nextId: () => BigInt(sharedSfidService.next()),
        })
      : undefined;

  return new RedisProjectedMemorySystem({
    store,
    ...(outbox !== undefined ? { outbox } : {}),
  });
}

/**
 * Unified tachu runtime wiring: memory + vector index + projection relay.
 * Replaces legacy {@link TachuVectorModule} + {@link TachuMemoryModule}.
 */
@Module({
  imports: [TachuProviderModule, OutboxExtModule],
  providers: [
    {
      provide: TURN_CONTEXT_HOLDER_TOKEN,
      useFactory: () => createTurnContextHolder(),
    },
    {
      provide: AGENTIC_MEMORY_SYSTEM_TOKEN,
      useFactory: () => createMemorySystem(),
    },
    {
      provide: TACHU_VECTOR_INDEX_TOKEN,
      useFactory: () =>
        new CubeQdrantMemoryIndex({
          url: process.env['AGENTIC_ENGINE_QDRANT_URL'] ?? 'http://localhost:6333',
          apiKey: process.env['AGENTIC_ENGINE_QDRANT_API_KEY'],
          vectorSize: Number(process.env['AGENTIC_ENGINE_MEMORY_VECTOR_SIZE'] ?? '1536'),
          searchTenant: Number(process.env['AGENTIC_ENGINE_MEMORY_TENANT_ID'] ?? '1'),
        }),
    },
    {
      provide: TURN_AWARE_EMBEDDING_RUNTIME_TOKEN,
      useFactory: (c: Container) => {
        const llm = c.resolve(AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN) as LlmProviderPort;
        const turnContext = c.resolve(TURN_CONTEXT_HOLDER_TOKEN) as ReturnType<
          typeof createTurnContextHolder
        >;
        const defaultModel =
          resolveSkillEmbeddingModelCode() ??
          resolveNonEmptyModel(
            process.env['AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL'],
            'text-embedding-3-small',
          );
        const memoryVectorSize = Number(process.env['AGENTIC_ENGINE_MEMORY_VECTOR_SIZE'] ?? '1536');
        const memoryTenant = Number(process.env['AGENTIC_ENGINE_MEMORY_TENANT_ID'] ?? '1');
        return createTurnAwareEmbeddingRuntime({
          provider: llm,
          defaultModel,
          getTurnContext: () => turnContext.callContext,
          resolveModelCode: () =>
            resolveSkillEmbeddingModelCode({
              turnModelCode: turnContext.embeddingModelCode,
            }),
          tenant: memoryTenant,
          dimension: memoryVectorSize,
        });
      },
    },
    MemoryProjectionRelayService,
    {
      provide: MEMORY_PROJECTION_RELAY_TOKEN,
      useExisting: MemoryProjectionRelayService,
    },
  ],
  exports: [
    TURN_CONTEXT_HOLDER_TOKEN,
    AGENTIC_MEMORY_SYSTEM_TOKEN,
    TACHU_VECTOR_INDEX_TOKEN,
    TURN_AWARE_EMBEDDING_RUNTIME_TOKEN,
    MEMORY_PROJECTION_RELAY_TOKEN,
    MemoryProjectionRelayService,
  ],
})
export class TachuRuntimeModule {}
