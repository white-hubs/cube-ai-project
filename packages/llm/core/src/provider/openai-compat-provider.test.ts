import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { OpenAiCompatProvider } from './openai-compat-provider';

const ORIGINAL_FETCH = globalThis.fetch.bind(globalThis);

type FetchLike = (input: URL | Request | string, init?: RequestInit) => Promise<Response>;

function stubFetch(impl: FetchLike) {
  globalThis.fetch = impl as typeof fetch;
}

beforeEach(() => {
  stubFetch(ORIGINAL_FETCH as FetchLike);
});

afterEach(() => {
  stubFetch(ORIGINAL_FETCH as FetchLike);
});

describe('OpenAiCompatProvider', () => {
  it('chat parses content and usage from OpenAI-compatible response', async () => {
    stubFetch(async () =>
      Response.json({
        choices: [{ message: { role: 'assistant', content: '你好' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    );

    const provider = new OpenAiCompatProvider({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const res = await provider.chat({
      tenant: 1,
      modelCode: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.content).toBe('你好');
    expect(res.usage?.totalTokens).toBe(5);
  });

  it('embed returns dense vectors (G3 sparse optional on openai path)', async () => {
    const embeddingFetch: FetchLike = async () =>
      Response.json({
        object: 'list',
        data: [{ object: 'embedding', embedding: [0.1, 0.2, 0.3], index: 0 }],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      });

    const provider = new OpenAiCompatProvider({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
      fetch: embeddingFetch as typeof fetch,
    });
    const res = await provider.embed({
      tenant: 1,
      modelCode: 'text-embedding-3-small',
      input: ['hello world'],
    });
    expect(res).toEqual([{ dense: [0.1, 0.2, 0.3] }]);
    expect(res[0]?.sparse).toBeUndefined();
  });
});
