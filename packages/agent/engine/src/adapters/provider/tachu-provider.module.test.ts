import { describe, expect, it } from 'bun:test';
import { NoopLlmProvider } from '@cube-ai/llm-core';
import { LlmProviderPortBridge } from './llm-provider-port-bridge';

describe('llm-core → tachu provider bridge', () => {
  it('chat delegates to LlmProviderPort via DI-shaped bridge', async () => {
    const bridge = new LlmProviderPortBridge(new NoopLlmProvider());
    const response = await bridge.chat(
      {
        model: 'noop-model',
        messages: [{ role: 'user', content: 'ping' }],
      },
      {
        correlation: { traceId: 't', requestId: 't', sessionId: 's', turnId: 'u' },
        subject: { tenant: '1', userId: 'u1' },
        tenant: 1,
      },
    );
    expect(response.content).toContain('noop');
  });

  it('embed maps dense vectors for tachu EmbeddingRuntime (dense-only contract)', async () => {
    const bridge = new LlmProviderPortBridge(new NoopLlmProvider());
    const response = await bridge.embed!(
      { model: 'embed-model', inputs: ['hello'] },
      {
        correlation: { traceId: 't', requestId: 't', sessionId: 's', turnId: 'u' },
        subject: { tenant: '2' },
        tenant: 2,
      },
    );
    expect(response.embeddings[0]?.length).toBeGreaterThan(0);
  });

  it('embed drops sparse vectors — engine memory bridge is dense-only per ADR-0005', async () => {
    const bridge = new LlmProviderPortBridge({
      async embed() {
        return [{ dense: [0.1, 0.2], sparse: { indices: [1], values: [0.5] } }];
      },
    } as never);
    const response = await bridge.embed!(
      { model: 'embed-model', inputs: ['hello'] },
      {
        correlation: { traceId: 't', requestId: 't', sessionId: 's', turnId: 'u' },
        tenant: 1,
      },
    );
    expect(response.embeddings[0]).toEqual([0.1, 0.2]);
    expect(Object.keys(response)).toEqual(['embeddings']);
  });
});
