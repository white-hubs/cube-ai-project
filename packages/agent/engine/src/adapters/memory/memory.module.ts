// ref: docs/technical-design/prompts/phase-1/P1-04-adapters.md §6
import { Module } from '@dangao/bun-server';
import { AGENTIC_MEMORY_SYSTEM_TOKEN } from '../tokens';
import { InMemoryStore } from './in-memory-store';
import { RedisMemoryStore } from './redis-memory-store';

/**
 * MemorySystem Adapter Module.
 *
 * 按 AGENTIC_ENGINE_MEMORY_KIND env 选择：
 *   - 'in-memory' → InMemoryStore（默认；开发/CI 免配置；无 Redis）
 *   - 'redis'     → RedisMemoryStore（L1+L2；需 AGENTIC_ENGINE_REDIS_URL）
 *
 * ref: docs/detailed-design/03-core-adapters/memory.md §7 DI
 */

const memoryKind = process.env['AGENTIC_ENGINE_MEMORY_KIND'] ?? 'in-memory';

function createMemorySystem() {
  if (memoryKind === 'redis') {
    return new RedisMemoryStore({
      redisUrl: process.env['AGENTIC_ENGINE_REDIS_URL'] ?? 'redis://localhost:6379',
      keyPrefix: 'agentic:engine:memory:',
      ttlSeconds: Number(process.env['AGENTIC_ENGINE_MEMORY_TTL_SECONDS'] ?? '604800'),
      tenantId: Number(process.env['AGENTIC_ENGINE_MEMORY_TENANT_ID'] ?? '1'),
    });
  }
  return new InMemoryStore();
}

@Module({
  providers: [
    {
      provide: AGENTIC_MEMORY_SYSTEM_TOKEN,
      useValue: createMemorySystem(),
    },
  ],
  exports: [AGENTIC_MEMORY_SYSTEM_TOKEN],
})
export class TachuMemoryModule {}
