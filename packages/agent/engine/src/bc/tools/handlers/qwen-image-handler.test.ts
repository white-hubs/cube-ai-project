import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import type { LlmCatalogPort, LlmModelRuntimeConfig } from '@cube-ai/contracts';
import { QwenImageHandler } from './qwen-image-handler';

class MockCatalog implements LlmCatalogPort {
  constructor(private readonly runtime: LlmModelRuntimeConfig | null) {}

  async listProviders() {
    return [];
  }

  async resolveModelRuntime(): Promise<LlmModelRuntimeConfig | null> {
    return this.runtime;
  }
}

describe('QwenImageHandler', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.QWEN_IMAGE_MODEL = 'qwen-image-2.0-pro';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.QWEN_IMAGE_MODEL;
  });

  test('returns upstream DashScope image URLs via catalog-resolved credentials', async () => {
    const upstreamUrl = 'https://dashscope-result.example.com/a.png';
    const dashScopeBody = {
      request_id: 'req-1',
      output: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: [{ image: upstreamUrl }],
            },
          },
        ],
      },
    };

    globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => {
      const u =
        typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.toString()
            : url.url;
      if (u.includes('multimodal-generation')) {
        return new Response(JSON.stringify(dashScopeBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('unexpected fetch', { status: 500 });
    }) as typeof fetch;

    const handler = new QwenImageHandler(
      new MockCatalog({
        modelCode: 'qwen-image-2.0-pro',
        displayName: 'Qwen Image',
        endpointType: 'dashscope_text2image',
        apiBaseUrl: 'https://dashscope.example.com/api/v1',
        apiKey: 'sk-test',
        modelTypes: ['image_generation'],
        isFree: false,
        providerCode: 'dashscope',
      }),
    );

    const out = await handler.invoke(
      { prompt: 'a red circle' },
      {
        auth: { tenant: 1, user: { userId: 'u1', scopes: [] } },
        traceId: 't1',
        session: { id: '281474976710655', turnId: '281474976710656' },
        signal: new AbortController().signal,
      },
    );

    expect(out.model).toBe('qwen-image-2.0-pro');
    expect(out.requestId).toBe('req-1');
    expect(out.images).toEqual([{ url: upstreamUrl }]);
  });

  test('rejects empty prompt', async () => {
    const handler = new QwenImageHandler(new MockCatalog(null));
    await expect(
      handler.invoke(
        { prompt: '  ' },
        {
          auth: { tenant: 1, user: { userId: 'u1', scopes: [] } },
          traceId: 't1',
          session: { id: '281474976710655', turnId: '281474976710656' },
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow(/prompt/);
  });
});
