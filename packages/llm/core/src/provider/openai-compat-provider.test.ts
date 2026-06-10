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

  it('chat parses tool_calls from OpenAI-compatible response', async () => {
    stubFetch(async () =>
      Response.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'weather', arguments: '{"city":"SH"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
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
      messages: [{ role: 'user', content: '天气' }],
      tools: [
        {
          name: 'weather',
          description: '查天气',
          inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
    });
    expect(res.toolCalls?.[0]?.arguments).toEqual({ city: 'SH' });
    expect(res.finishReason).toBe('tool_calls');
  });

  it('chatStream yields tool-call chunks from streaming tool_calls deltas', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"weather","arguments":"{\\"city\\":"}}]}}]}',
      '',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"SH\\"}"}}]}}]}',
      '',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    stubFetch(async () =>
      new Response(sse, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const provider = new OpenAiCompatProvider({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });

    const chunks: Array<{ type: string }> = [];
    for await (const ch of provider.chatStream({
      tenant: 1,
      modelCode: 'gpt-4o',
      messages: [{ role: 'user', content: '天气' }],
      tools: [{ name: 'weather', inputSchema: { type: 'object' } }],
    })) {
      chunks.push(ch);
    }

    expect(chunks.some((c) => c.type === 'tool-call-delta')).toBe(true);
    expect(chunks.some((c) => c.type === 'tool-call-complete')).toBe(true);
    const complete = chunks.find((c) => c.type === 'tool-call-complete') as {
      type: string;
      call?: { name: string; arguments: Record<string, unknown> };
    };
    expect(complete?.call?.name).toBe('weather');
    expect(complete?.call?.arguments).toEqual({ city: 'SH' });
  });

  it('chatStream parses tool_calls from message field (gateway compatibility)', async () => {
    const sse = [
      'data: {"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"weather","arguments":"{\\"city\\":\\"SH\\"}"}}]},"finish_reason":"tool_calls"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    stubFetch(async () =>
      new Response(sse, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const provider = new OpenAiCompatProvider({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });

    const chunks: Array<{ type: string }> = [];
    for await (const ch of provider.chatStream({
      tenant: 1,
      modelCode: 'gpt-4o',
      messages: [{ role: 'user', content: '天气' }],
      tools: [{ name: 'weather', inputSchema: { type: 'object' } }],
    })) {
      chunks.push(ch);
    }

    const complete = chunks.find((c) => c.type === 'tool-call-complete') as {
      type: string;
      call?: { name: string; arguments: Record<string, unknown> };
    };
    expect(complete?.call?.name).toBe('weather');
    expect(complete?.call?.arguments).toEqual({ city: 'SH' });
    const finish = chunks.find((c) => c.type === 'finish') as { finishReason?: string };
    expect(finish?.finishReason).toBe('tool_calls');
  });

  it('sends tools in request body when tools are provided', async () => {
    let capturedBody: unknown;
    const capturingFetch: FetchLike = async (_input, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return Response.json({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      });
    };

    const provider = new OpenAiCompatProvider({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      fetch: capturingFetch as typeof fetch,
    });
    await provider.chat({
      tenant: 1,
      modelCode: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'demo', description: 'd', inputSchema: { type: 'object' } }],
    });

    const body = capturedBody as { tools?: unknown[]; tool_choice?: string };
    expect(body.tools?.length).toBe(1);
    expect(body.tool_choice).toBe('auto');
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
