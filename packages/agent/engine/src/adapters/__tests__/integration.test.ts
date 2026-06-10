/**
 * Integration smoke tests — P1-04 Adapters
 *
 * 依赖真实外部服务（Qdrant / Redis / BullMQ）。
 * 本文件在 CI 中默认跳过（SKIP_INTEGRATION=true）。
 */
import { describe, it, expect } from 'bun:test';
import { DEFAULT_ADAPTER_CALL_CONTEXT } from '@tachu/core';

const SKIP = process.env['SKIP_INTEGRATION'] !== 'false';

describe('CubeQdrantMemoryIndex [integration]', () => {
  it.skipIf(SKIP)(
    'IT-V1: searchVector against real Qdrant',
    async () => {
      const { CubeQdrantMemoryIndex } = await import('../vector/cube-qdrant-memory-index');
      const index = new CubeQdrantMemoryIndex({
        url: process.env['AGENTIC_ENGINE_QDRANT_URL'] ?? 'http://localhost:6333',
        vectorSize: 4,
        searchTenant: 1,
      });
      const ctx = { ...DEFAULT_ADAPTER_CALL_CONTEXT, tenant: 1 };
      const vec = [0.25, 0.25, 0.25, 0.25];
      const id = `it-${Date.now()}`;
      await index.upsert([{ id, vector: vec, payload: { text: 'hello' } }], ctx);
      const hits = await index.searchVector(vec, 3, { must: { tenant: 1 } }, ctx);
      expect(Array.isArray(hits)).toBe(true);
    },
  );
});

describe('RedisMemoryStore [integration]', () => {
  it.skipIf(SKIP)(
    'IT-M1: R18 — Redis connection is lazy (store instantiates without network)',
    async () => {
      const { RedisMemoryStore } = await import('../memory/redis-memory-store');
      const store = new RedisMemoryStore({
        redisUrl: process.env['AGENTIC_ENGINE_REDIS_URL'] ?? 'redis://localhost:6379',
      });
      expect(store._redisForTest).toBeUndefined();
      await store.dispose();
    },
  );
});

describe('BullMQExecutionBackendAdapter [integration]', () => {
  it.skipIf(SKIP)(
    'IT-B1: R18 — BullMQ Queue is lazy (no connection at construction)',
    async () => {
      const { BullMQExecutionBackendAdapter, BULLMQ_DEFAULT_QUEUE } =
        await import('../backend/bullmq-backend');
      const backend = new BullMQExecutionBackendAdapter({
        redisUrl: process.env['AGENTIC_ENGINE_REDIS_URL'] ?? 'redis://localhost:6379',
        queueName: BULLMQ_DEFAULT_QUEUE,
      });
      expect(backend._queuesForTest.size).toBe(0);
      await backend.dispose();
    },
  );
});
