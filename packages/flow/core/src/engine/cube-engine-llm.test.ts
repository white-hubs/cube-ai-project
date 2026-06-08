import { describe, expect, test } from 'bun:test';
import type { LlmChatRequest, LlmChatResponse, LlmEmbedRequest, LlmEmbedResult, LlmProviderPort, LlmStreamChunk } from '@cube-ai/contracts';
import { cubeLlmChatSync, resolveCubeEngineLlmConfig } from './cube-engine-llm';

class MockLlmProvider implements LlmProviderPort {
  lastRequest: LlmChatRequest | null = null;

  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    this.lastRequest = req;
    return {
      content: 'mock-reply',
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    };
  }

  async *chatStream(): AsyncIterable<LlmStreamChunk> {
    yield { type: 'text-delta', delta: 'x' };
  }

  async embed(_req: LlmEmbedRequest): Promise<LlmEmbedResult[]> {
    return [{ dense: [0] }];
  }
}

describe('cube-engine LlmProviderPort', () => {
  test('resolveCubeEngineLlmConfig prefers model_ref over model_name', () => {
    const cfg = resolveCubeEngineLlmConfig(
      { model_ref: 'catalog-model', model_name: 'legacy-name', api_key: 'sk-inline' },
      7,
    );
    expect(cfg.modelCode).toBe('catalog-model');
    expect(cfg.legacyApiKey).toBe('sk-inline');
    expect(cfg.tenant).toBe(7);
  });

  test('cubeLlmChatSync delegates to LlmProviderPort with legacy fallback fields', async () => {
    const mock = new MockLlmProvider();
    const llmCfg = resolveCubeEngineLlmConfig(
      { model_name: 'gpt-test', api_key: 'sk-test', openai_api_base: 'https://example/v1' },
      0,
    );
    const r = await cubeLlmChatSync(mock, 'hello', llmCfg);
    expect(r.text).toBe('mock-reply');
    expect(mock.lastRequest?.legacyApiKey).toBe('sk-test');
    expect(mock.lastRequest?.legacyApiBaseUrl).toBe('https://example/v1');
    expect(mock.lastRequest?.modelCode).toBe('gpt-test');
  });

  test('resolveCubeEngineLlmConfig without inline key still returns modelCode', () => {
    const cfg = resolveCubeEngineLlmConfig({ model_name: 'gpt-only' }, 1);
    expect(cfg.modelCode).toBe('gpt-only');
    expect(cfg.legacyApiKey).toBeUndefined();
  });
});
