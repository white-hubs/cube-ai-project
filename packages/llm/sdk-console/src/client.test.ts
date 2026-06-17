import { describe, expect, test } from 'bun:test';
import { createLlmConsoleClient } from './client';

describe('LlmConsoleClient', () => {
  test('listProviders GET /llm/console/providers', async () => {
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

    expect(capturedUrl).toBe('http://ai-center.test/llm/console/providers');
    expect(providers[0]?.providerCode).toBe('openai');
  });

  test('listProviders preserves admin fields from GET /llm/console/providers', async () => {
    const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
      expect(init?.method).toBe('GET');
      return Response.json([
        {
          id: 'p1',
          providerCode: 'openai',
          typeCode: 'openai',
          apiBaseUrl: 'https://api.openai.com/v1',
          enabled: true,
          name: 'OpenAI',
          iconUrl: 'https://cdn.example/icon.png',
          apiKey: 'sk-***',
          systemProviderId: 'sys-1',
          isCustom: false,
          remark: 'tenant default',
        },
      ]);
    };

    const client = createLlmConsoleClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const providers = await client.listProviders();

    expect(providers[0]).toMatchObject({
      id: 'p1',
      providerCode: 'openai',
      name: 'OpenAI',
      iconUrl: 'https://cdn.example/icon.png',
      apiKey: 'sk-***',
      systemProviderId: 'sys-1',
      isCustom: false,
      remark: 'tenant default',
    });
  });

  test('listEndpointTypes GET /llm/console/endpoint-types', async () => {
    let capturedUrl = '';
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      expect(init?.method).toBe('GET');
      return Response.json([
        { code: 'openai', displayName: 'OpenAI', description: 'OpenAI Chat Completions 兼容协议' },
      ]);
    };

    const client = createLlmConsoleClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const types = await client.listEndpointTypes();

    expect(capturedUrl).toBe('http://ai-center.test/llm/console/endpoint-types');
    expect(types).toEqual([
      { code: 'openai', displayName: 'OpenAI', description: 'OpenAI Chat Completions 兼容协议' },
    ]);
  });
});
