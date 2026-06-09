import { describe, expect, it } from 'bun:test';
import { DashscopeText2ImageProvider } from './dashscope-text2image-provider';

describe('DashscopeText2ImageProvider', () => {
  it('returns images directly when no task_id (sync response)', async () => {
    const mockFetch: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          request_id: 'req-1',
          output: {
            choices: [{ message: { content: [{ image: 'https://example.com/img.png' }] } }],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const provider = new DashscopeText2ImageProvider({
      apiBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      apiKey: 'sk-test',
      modelCode: 'qwen-image-2.0-pro',
      fetchImpl: mockFetch,
    });

    const result = await provider.generate({ tenant: 1, modelCode: 'qwen-image-2.0-pro', prompt: 'a cat' });
    expect(result.images[0]?.url).toBe('https://example.com/img.png');
    expect(result.requestId).toBe('req-1');
    expect(result.model).toBe('qwen-image-2.0-pro');
  });

  it('polls until SUCCEEDED when async task_id returned', async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = (async (url: Parameters<typeof fetch>[0]) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      callCount++;

      if (urlStr.includes('generation')) {
        return new Response(
          JSON.stringify({ request_id: 'req-2', output: { task_id: 'task-abc', task_status: 'PENDING' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (urlStr.includes('tasks')) {
        if (callCount < 4) {
          return new Response(
            JSON.stringify({ output: { task_id: 'task-abc', task_status: 'RUNNING' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            request_id: 'req-2-done',
            output: {
              task_id: 'task-abc',
              task_status: 'SUCCEEDED',
              results: [{ url: 'https://result.example.com/done.png' }],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const provider = new DashscopeText2ImageProvider({
      apiBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      apiKey: 'sk-test',
      modelCode: 'wan2.2-t2i',
      fetchImpl: mockFetch,
      pollIntervalMs: 0,
    });

    const result = await provider.generate({ tenant: 1, modelCode: 'wan2.2-t2i', prompt: 'a mountain' });
    expect(result.images[0]?.url).toBe('https://result.example.com/done.png');
    expect(result.requestId).toBe('req-2-done');
  });

  it('throws on FAILED task', async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = (async (url: Parameters<typeof fetch>[0]) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
      callCount++;
      if (urlStr.includes('generation')) {
        return new Response(
          JSON.stringify({ request_id: 'req-3', output: { task_id: 'task-fail', task_status: 'PENDING' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ output: { task_status: 'FAILED', code: 'ERR_001', message: 'Model error' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const provider = new DashscopeText2ImageProvider({
      apiBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      apiKey: 'sk-test',
      modelCode: 'wan2.2-t2i',
      fetchImpl: mockFetch,
      pollIntervalMs: 0,
    });

    await expect(provider.generate({ tenant: 1, modelCode: 'wan2.2-t2i', prompt: 'a cloud' })).rejects.toThrow(
      /failed/i,
    );
  });

  it('throws UPSTREAM_LLM_AUTH_FAILED on 401', async () => {
    const mockFetch: typeof fetch = (async () =>
      new Response('Unauthorized', { status: 401 })) as unknown as typeof fetch;

    const provider = new DashscopeText2ImageProvider({
      apiBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      apiKey: 'bad-key',
      modelCode: 'x',
      fetchImpl: mockFetch,
    });

    await expect(provider.generate({ tenant: 1, modelCode: 'x', prompt: 'test' })).rejects.toMatchObject({
      code: 'UPSTREAM_LLM_AUTH_FAILED',
    });
  });
});
