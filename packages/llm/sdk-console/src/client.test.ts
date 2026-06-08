import { describe, expect, test } from 'bun:test';
import { createLlmConsoleClient } from './client';

describe('LlmConsoleClient', () => {
  test('listProviders GET /llm/providers', async () => {
    let capturedUrl = '';
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      expect(init?.method).toBe('GET');
      return Response.json([
        {
          id: 'p1',
          providerCode: 'openai',
          typeCode: 'openai',
          apiBaseUrl: 'https://api.openai.com/v1',
          enabled: true,
        },
      ]);
    };

    const client = createLlmConsoleClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const providers = await client.listProviders();

    expect(capturedUrl).toBe('http://ai-center.test/llm/providers');
    expect(providers[0]?.providerCode).toBe('openai');
  });
});
