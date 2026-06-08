import { describe, expect, it } from 'bun:test';
import type { LlmCatalogPort, LlmModelRuntimeConfig } from '@cube-ai/contracts';
import { CatalogDrivenProvider, createInnerProviderFromCatalogRuntimeConfig } from './catalog-driven-provider';

describe('CatalogDrivenProvider', () => {
  it('resolves catalog runtime and delegates chat to inner openai-compat provider', async () => {
    const runtime: LlmModelRuntimeConfig = {
      modelCode: 'gpt-4o',
      displayName: 'GPT-4o',
      endpointType: 'openai',
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-catalog',
      modelTypes: ['chat'],
      isFree: false,
      providerCode: 'openai-official',
    };
    const catalog: LlmCatalogPort = {
      listProviders: async () => [],
      resolveModelRuntime: async () => runtime,
    };

    const provider = new CatalogDrivenProvider({
      catalog,
      providerFactory: (cfg) => ({
        id: 'mock',
        chat: async () => ({
          content: `ok:${cfg.apiKey}`,
          finishReason: 'stop',
        }),
        chatStream: async function* () {
          yield { type: 'finish', finishReason: 'stop' };
        },
        embed: async () => [{ dense: [1] }],
      }),
    });

    const res = await provider.chat({
      tenant: 1,
      modelCode: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.content).toBe('ok:sk-catalog');
  });

  it('uses legacy key fallback when catalog misses (M1.T8 soft transition)', async () => {
    const fallbackEvents: Array<{ tenant: number; modelCode: string }> = [];
    const catalog: LlmCatalogPort = {
      listProviders: async () => [],
      resolveModelRuntime: async () => null,
    };
    const provider = new CatalogDrivenProvider({
      catalog,
      onLegacyKeyFallback: (event) => fallbackEvents.push(event),
      providerFactory: (cfg) => ({
        id: 'legacy',
        chat: async () => ({ content: cfg.apiKey, finishReason: 'stop' }),
        chatStream: async function* () {
          yield { type: 'finish', finishReason: 'stop' };
        },
        embed: async () => [{ dense: [0.5] }],
      }),
    });

    const res = await provider.chat({
      tenant: 9,
      modelCode: 'legacy-model',
      messages: [{ role: 'user', content: 'x' }],
      legacyApiKey: 'sk-inline',
    });
    expect(res.content).toBe('sk-inline');
    expect(fallbackEvents).toEqual([{ tenant: 9, modelCode: 'legacy-model' }]);
  });

  it('createInnerProviderFromCatalogRuntimeConfig routes volcengine embedding to doubao multimodal', () => {
    const inner = createInnerProviderFromCatalogRuntimeConfig({
      modelCode: 'doubao-embedding-vision-251215',
      displayName: 'Doubao',
      endpointType: 'volcengine_ark',
      apiBaseUrl: 'https://ark.example.com/api/v3',
      apiKey: 'sk-volc',
      modelTypes: ['embedding', 'multimodal'],
      isFree: false,
      providerCode: 'volc-doubao',
    });
    expect(inner.id).toBe('doubao-multimodal-embed');
  });
});
