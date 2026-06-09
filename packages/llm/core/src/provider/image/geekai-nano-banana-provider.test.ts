import { describe, expect, it } from 'bun:test';
import { GeekaiNanoBananaProvider } from './geekai-nano-banana-provider';

describe('GeekaiNanoBananaProvider', () => {
  it('returns image URLs from OpenAI-image-compatible response', async () => {
    const mockFetch: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          created: 1718000000,
          data: [{ url: 'https://cdn.geekai.co/img.png' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const provider = new GeekaiNanoBananaProvider({
      apiBaseUrl: 'https://geekai.co',
      apiKey: 'gk-test',
      modelCode: 'nano-banana',
      fetchImpl: mockFetch,
    });

    const result = await provider.generate({ tenant: 1, modelCode: 'nano-banana', prompt: 'a sunrise' });
    expect(result.images[0]?.url).toBe('https://cdn.geekai.co/img.png');
    expect(result.model).toBe('nano-banana');
  });

  it('throws on empty data array', async () => {
    const mockFetch: typeof fetch = (async () =>
      new Response(
        JSON.stringify({ created: 1718000000, data: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const provider = new GeekaiNanoBananaProvider({
      apiBaseUrl: 'https://geekai.co',
      apiKey: 'gk-test',
      modelCode: 'nano-banana',
      fetchImpl: mockFetch,
    });

    await expect(provider.generate({ tenant: 1, modelCode: 'nano-banana', prompt: 'test' })).rejects.toThrow(
      /no image URLs/i,
    );
  });

  it('throws UPSTREAM_LLM_AUTH_FAILED on 401', async () => {
    const mockFetch: typeof fetch = (async () =>
      new Response('Unauthorized', { status: 401 })) as unknown as typeof fetch;

    const provider = new GeekaiNanoBananaProvider({
      apiBaseUrl: 'https://geekai.co',
      apiKey: 'bad',
      modelCode: 'nano-banana',
      fetchImpl: mockFetch,
    });

    await expect(provider.generate({ tenant: 1, modelCode: 'nano-banana', prompt: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM_LLM_AUTH_FAILED',
    });
  });
});
