import { describe, test, expect } from 'bun:test';
import { InMemoryStore } from '@cube-ai/agent-engine/adapters/memory';
import { TurnAwareEmbeddingRuntime } from '@cube-ai/agent-engine/adapters/embedding';
import type {
  AdapterCallContext,
  ProviderAdapter,
  VectorHit,
  VectorIndexAdapter,
} from '@tachu/core';
import { MemoryHandler } from './memory-handler';
import type { ToolHandlerCtx } from '../tool-context';

const ctx: ToolHandlerCtx = {
  traceId: 'x',
  signal:  new AbortController().signal,
  auth:    { tenant: 1, user: { userId: 'u', scopes: [] } },
  session: { id: '1234567890123456789', turnId: '1234567890123456788' },
};

const turnCtx: AdapterCallContext = {
  correlation: {
    traceId: 'x',
    requestId: 'x',
    sessionId: ctx.session.id,
    turnId: ctx.session.turnId,
  },
  tenant: 1,
  subject: { tenant: '1', userId: 'u' },
};

function createMocks() {
  const provider: ProviderAdapter = {
    id: 'test',
    name: 'Test',
    async listAvailableModels() {
      return [];
    },
    async chat() {
      return { content: 'ok', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    },
    async *chatStream() {
      yield { type: 'text-delta', delta: 'ok' } as const;
      yield { type: 'finish', finishReason: 'stop' } as const;
    },
    async embed() {
      return { embeddings: [[1, 0, 0]] };
    },
  };

  const embedding = new TurnAwareEmbeddingRuntime({
    embeddingPort: {
      dimension: 3,
      async embed(inputs) {
        return inputs.map(() => ({ dense: [1, 0, 0], sparse: null }));
      },
    },
    defaultModel: 'embed-model',
    getTurnContext: () => turnCtx,
    resolveModelCode: () => 'embed-model',
  });

  const vectorIndex: VectorIndexAdapter = {
    async upsert() {},
    async searchVector(_query, topK, filters) {
      const sessionId = filters.must?.['sessionId'];
      const hits: VectorHit[] = [
        {
          id: 'hit-1',
          score: 0.91,
          metadata: {
            sessionId,
            timestamp: 1_700_000_000_000,
            snippet: 'hello memory',
          },
        },
      ];
      return hits.slice(0, topK);
    },
    async delete() {},
  };

  return { embedding, vectorIndex };
}

describe('MemoryHandler', () => {
  test('set + get 同 key 能取回', async () => {
    const { embedding, vectorIndex } = createMocks();
    const h = new MemoryHandler(new InMemoryStore(), vectorIndex, embedding);
    await h.invoke({ operation: 'set', key: 'k1', value: { v: 1 } }, ctx);
    const out = await h.invoke({ operation: 'get', key: 'k1' }, ctx);
    expect(out.success).toBe(true);
    expect(out.value).toEqual({ v: 1 });
  });

  test('search embed + searchVector 返回 snippet/score/occurredAt', async () => {
    const { embedding, vectorIndex } = createMocks();
    const h = new MemoryHandler(new InMemoryStore(), vectorIndex, embedding);
    const out = await h.invoke(
      {
        operation: 'search',
        query: 'hello',
        topK: 3,
        scope: 'CURRENT_SESSION',
      },
      ctx,
    );
    expect(out.success).toBe(true);
    expect(out.hits?.length).toBe(1);
    expect(out.hits?.[0]?.snippet).toBe('hello memory');
    expect(out.hits?.[0]?.score).toBeCloseTo(0.91);
    expect(out.hits?.[0]?.occurredAt).toBe(1_700_000_000_000);
    expect(out.hits?.[0]?.sessionId).toBe(ctx.session.id);
  });
});
