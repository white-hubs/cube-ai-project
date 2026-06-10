/**
 * Storage 真实依赖集成测试（默认 skip；需本地 Qdrant + Redis）
 */
import { describe, it, expect } from 'bun:test';
import { DEFAULT_ADAPTER_CALL_CONTEXT } from '@tachu/core';

const SKIP = process.env['SKIP_INTEGRATION'] !== 'false';

describe('storage adapters [integration]', () => {
  it.skipIf(SKIP)(
    'ST-I1：Qdrant upsert + searchVector 命中 tenant 过滤',
    async () => {
      const { CubeQdrantMemoryIndex } = await import(
        '../../vector/cube-qdrant-memory-index'
      );
      const dim = 4;
      const index = new CubeQdrantMemoryIndex({
        url: process.env['AGENTIC_ENGINE_QDRANT_URL'] ?? 'http://localhost:6333',
        apiKey: process.env['AGENTIC_ENGINE_QDRANT_API_KEY'],
        vectorSize: dim,
        searchTenant: 9013,
      });

      const id = `${Date.now()}0000000001`.slice(0, 19);
      const vec = [0.25, 0.25, 0.25, 0.25];
      const memCtx = { ...DEFAULT_ADAPTER_CALL_CONTEXT, tenant: 9013 };
      await index.upsert(
        [{ id, vector: vec, payload: { text: 'integration-hit', sessionId: 'sess-int' } }],
        memCtx,
      );

      const hits = await index.searchVector(vec, 5, { must: { tenant: 9013 } }, memCtx);
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits.some((h) => h.id === id)).toBe(true);
    },
  );

  it.skipIf(SKIP)(
    'ST-I2：Redis append / read 顺序（LPUSH → LRANGE 还原）',
    async () => {
      const { RedisMemoryStore } = await import(
        '../../memory/redis-memory-store'
      );
      const store = new RedisMemoryStore({
        redisUrl: process.env['AGENTIC_ENGINE_REDIS_URL'] ?? 'redis://localhost:6379',
        tenantId: 9013,
        ttlSeconds: 3600,
      });
      const sid = `int-${Date.now()}`;
      const mctx = { ...DEFAULT_ADAPTER_CALL_CONTEXT, tenant: 9013 };
      await store.append(
        sid,
        {
          role: 'user',
          content: 'first',
          timestamp: Date.now(),
          anchored: false,
        },
        mctx,
      );
      await store.append(
        sid,
        {
          role: 'assistant',
          content: 'second',
          timestamp: Date.now(),
          anchored: false,
        },
        mctx,
      );
      const win = await store.load(sid, mctx);
      expect(win.entries.map((e) => e.content)).toEqual(['first', 'second']);
      await store.clear(sid);
      await store.dispose();
    },
  );
});
