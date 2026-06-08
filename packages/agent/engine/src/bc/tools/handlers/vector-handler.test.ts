import { describe, test, expect } from 'bun:test';
import type { AdapterCallContext, ProviderAdapter, VectorIndexAdapter } from '@tachu/core';
import { TurnAwareEmbeddingRuntime } from '@cube-ai/agent-engine/adapters/embedding';
import { VectorHandler } from './vector-handler';
import type { ToolHandlerCtx } from '../tool-context';

const ctx: ToolHandlerCtx = {
  traceId: 'x',
  signal:  new AbortController().signal,
  auth:    { tenant: 42, user: { userId: 'u1', scopes: [] } },
  session: { id: '1234567890123456789', turnId: '1234567890123456788' },
};

const turnCtx: AdapterCallContext = {
  correlation: {
    traceId: 'x',
    requestId: 'x',
    sessionId: ctx.session.id,
    turnId: ctx.session.turnId,
  },
  tenant: 42,
  subject: { tenant: '42', userId: 'u1' },
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
    async searchVector() {
      return [{ id: 'a', score: 0.99, metadata: { tenant: 42, foo: 'bar' } }];
    },
    async delete() {},
  };
  return { embedding, vectorIndex };
}

describe('VectorHandler', () => {
  test('search → 映射 VectorIndex.searchVector 结果', async () => {
    const { embedding, vectorIndex } = createMocks();
    const h = new VectorHandler(vectorIndex, embedding);
    const out = await h.invoke({ query: 'hello', topK: 5 }, ctx);
    expect(out.hits).toHaveLength(1);
    expect(out.hits[0]?.id).toBe('a');
  });

  test('缺少 query → INVALID_ARGUMENT_SCHEMA_VIOLATION', async () => {
    const { embedding, vectorIndex } = createMocks();
    const h = new VectorHandler(vectorIndex, embedding);
    await expect(h.invoke({ query: '' }, ctx)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT_SCHEMA_VIOLATION',
    });
  });
});
