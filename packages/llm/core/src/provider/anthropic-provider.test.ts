import { describe, expect, it } from 'bun:test';
import { AnthropicProvider } from './anthropic-provider';

function fakeFetch(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

function fakeFetchError(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('AnthropicProvider', () => {
  it('maps a non-stream messages response to LlmChatResponse', async () => {
    const provider = new AnthropicProvider({
      baseURL: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      model: 'claude-3-5-sonnet',
      fetchImpl: fakeFetch({
        content: [{ type: 'text', text: 'hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 2 },
      }),
    });
    const res = await provider.chat({
      tenant: 1,
      modelCode: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.content).toContain('hello');
    expect(res.finishReason).toBe('stop');
    expect(res.usage?.promptTokens).toBe(3);
    expect(res.usage?.completionTokens).toBe(2);
  });

  it('extracts system message as top-level field', async () => {
    let capturedBody: unknown;
    const capturingFetch: typeof fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const provider = new AnthropicProvider({
      baseURL: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      model: 'claude-3-opus',
      fetchImpl: capturingFetch,
    });
    await provider.chat({
      tenant: 1,
      modelCode: 'claude-3-opus',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'hello' },
      ],
    });
    const body = capturedBody as Record<string, unknown>;
    expect(body.system).toBe('You are helpful.');
    expect(Array.isArray(body.messages)).toBe(true);
    const msgs = body.messages as Array<{ role: string }>;
    expect(msgs.every((m) => m.role !== 'system')).toBe(true);
  });

  it('streams content_block_delta events as text-delta chunks', async () => {
    const sse = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join('');

    const streamFetch: typeof fetch = (async () =>
      new Response(new TextEncoder().encode(sse), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as unknown as typeof fetch;

    const provider = new AnthropicProvider({
      baseURL: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      model: 'claude-3-5-sonnet',
      fetchImpl: streamFetch,
    });

    const chunks: Array<{ type: string; delta?: string }> = [];
    for await (const chunk of provider.chatStream({
      tenant: 1,
      modelCode: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(chunk as { type: string; delta?: string });
    }

    const textDeltas = chunks.filter((c) => c.type === 'text-delta');
    expect(textDeltas.length).toBeGreaterThan(0);
    expect(textDeltas[0]?.delta).toBe('world');

    const finish = chunks.find((c) => c.type === 'finish');
    expect(finish).toBeDefined();
    expect((finish as { finishReason?: string })?.finishReason).toBe('stop');
  });

  it('flushes a final SSE data line that lacks a trailing newline', async () => {
    // Same latent bug as the OpenAI-compat provider: if the final SSE event has
    // no terminating newline, the reader must still flush the buffered line on
    // stream end instead of silently dropping it.
    const sse =
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"tail"}}';

    const streamFetch: typeof fetch = (async () =>
      new Response(new TextEncoder().encode(sse), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as unknown as typeof fetch;

    const provider = new AnthropicProvider({
      baseURL: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      model: 'claude-3-5-sonnet',
      fetchImpl: streamFetch,
    });

    const chunks: Array<{ type: string; delta?: string }> = [];
    for await (const chunk of provider.chatStream({
      tenant: 1,
      modelCode: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      chunks.push(chunk as { type: string; delta?: string });
    }

    const text = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => c.delta)
      .join('');
    expect(text).toBe('tail');
  });

  it('maps tool_use blocks to toolCalls', async () => {
    const provider = new AnthropicProvider({
      baseURL: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      model: 'claude-3-5-sonnet',
      fetchImpl: fakeFetch({
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'demo',
            input: { q: '1' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 5, output_tokens: 3 },
      }),
    });
    const res = await provider.chat({
      tenant: 1,
      modelCode: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'call tool' }],
    });
    expect(res.toolCalls?.[0]?.name).toBe('demo');
    expect(res.finishReason).toBe('tool_calls');
  });

  it('sends tools in request body when tools are provided', async () => {
    let capturedBody: unknown;
    const capturingFetch: typeof fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const provider = new AnthropicProvider({
      baseURL: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      model: 'claude-3-5-sonnet',
      fetchImpl: capturingFetch,
    });
    await provider.chat({
      tenant: 1,
      modelCode: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'demo', description: 'd', inputSchema: { type: 'object' } }],
    });
    const body = capturedBody as { tools?: unknown[] };
    expect(body.tools?.length).toBe(1);
  });

  it('streams tool_use blocks as tool-call chunks', async () => {
    const sse = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_1","name":"demo"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"1\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":2}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join('');

    const streamFetch: typeof fetch = (async () =>
      new Response(new TextEncoder().encode(sse), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as unknown as typeof fetch;

    const provider = new AnthropicProvider({
      baseURL: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      model: 'claude-3-5-sonnet',
      fetchImpl: streamFetch,
    });

    const chunks: Array<{ type: string }> = [];
    for await (const chunk of provider.chatStream({
      tenant: 1,
      modelCode: 'claude-3-5-sonnet',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'demo', inputSchema: { type: 'object' } }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === 'tool-call-delta')).toBe(true);
    expect(chunks.some((c) => c.type === 'tool-call-complete')).toBe(true);
    const complete = chunks.find((c) => c.type === 'tool-call-complete') as {
      type: string;
      call?: { name: string; arguments: Record<string, unknown> };
    };
    expect(complete?.call?.name).toBe('demo');
    expect(complete?.call?.arguments).toEqual({ q: '1' });
  });

  it('embed throws UPSTREAM_LLM_UNAVAILABLE', async () => {
    const provider = new AnthropicProvider({
      baseURL: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      model: 'claude-3-5-sonnet',
      fetchImpl: fakeFetch({}),
    });
    await expect(
      provider.embed({ tenant: 1, modelCode: 'claude-3-5-sonnet', input: ['test'] }),
    ).rejects.toThrow(/embed/i);
  });

  it('throws LlmProviderError on 401', async () => {
    const provider = new AnthropicProvider({
      baseURL: 'https://api.anthropic.com',
      apiKey: 'bad-key',
      model: 'claude-3-5-sonnet',
      fetchImpl: fakeFetchError(401, { error: { message: 'unauthorized' } }),
    });
    await expect(
      provider.chat({
        tenant: 1,
        modelCode: 'claude-3-5-sonnet',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_LLM_AUTH_FAILED' });
  });
});
