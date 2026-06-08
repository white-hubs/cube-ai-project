import { describe, expect, it } from 'bun:test';
import type { AdapterCallContext } from '@tachu/core';
import type { EmbeddingPort } from '@cube-ai/contracts/platform';
import { TurnAwareEmbeddingRuntime } from './turn-aware-embedding-runtime';

const turnCtx: AdapterCallContext = {
  correlation: { traceId: 'tr1', requestId: 'rq1', sessionId: 's1', turnId: 't1' },
  tenant: 42,
};

function makeEmbeddingPort(
  impl?: EmbeddingPort['embed'],
  dimension = 1536,
): EmbeddingPort {
  return {
    dimension,
    embed:
      impl ??
      (async (inputs) => inputs.map(() => ({ dense: [1], sparse: null }))),
  };
}

describe('TurnAwareEmbeddingRuntime', () => {
  it('delegates to EmbeddingPort with query purpose for retrieval query tasks', async () => {
    let capturedPurpose: string | undefined;
    const embeddingPort = makeEmbeddingPort(async (_inputs, purpose) => {
      capturedPurpose = purpose;
      return [{ dense: [0.1, 0.2], sparse: null }];
    });
    const runtime = new TurnAwareEmbeddingRuntime({
      embeddingPort,
      defaultModel: 'default-embed',
      getTurnContext: () => turnCtx,
      resolveModelCode: () => 'turn-embed-model',
    });
    const result = await runtime.embed(
      { model: '', inputs: ['query'], taskType: 'RETRIEVAL_QUERY' },
      turnCtx,
    );
    expect(capturedPurpose).toBe('query');
    expect(result.embeddings).toEqual([[0.1, 0.2]]);
  });

  it('uses document purpose for non-query task types', async () => {
    let capturedPurpose: string | undefined;
    const embeddingPort = makeEmbeddingPort(async (_inputs, purpose) => {
      capturedPurpose = purpose;
      return [{ dense: [1], sparse: null }];
    });
    const runtime = new TurnAwareEmbeddingRuntime({
      embeddingPort,
      defaultModel: 'default-embed',
      getTurnContext: () => turnCtx,
      resolveModelCode: () => undefined,
    });
    await runtime.embed(
      { model: '', inputs: ['hello'], taskType: 'RETRIEVAL_DOCUMENT' },
      turnCtx,
    );
    expect(capturedPurpose).toBe('document');
  });

  it('throws when turn context is not set', async () => {
    const runtime = new TurnAwareEmbeddingRuntime({
      embeddingPort: makeEmbeddingPort(),
      defaultModel: 'm',
      getTurnContext: () => undefined,
      resolveModelCode: () => 'm',
    });
    await expect(
      runtime.embed({ model: 'm', inputs: ['x'], taskType: 'RETRIEVAL_QUERY' }, turnCtx),
    ).rejects.toThrow(/turn AdapterCallContext/);
  });

  it('describe() exposes embedding port dimension and resolved model', () => {
    const runtime = new TurnAwareEmbeddingRuntime({
      embeddingPort: makeEmbeddingPort(undefined, 1536),
      defaultModel: 'default-embed',
      getTurnContext: () => turnCtx,
      resolveModelCode: () => 'turn-model',
    });
    expect(runtime.describe()).toEqual({
      providerId: 'cube-ai-embedding-port',
      model: 'turn-model',
      dimensions: 1536,
    });
  });
});
