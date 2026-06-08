import { describe, expect, test } from 'bun:test';
import { createKbClient } from './client';

describe('KbClient', () => {
  test('search POST /kb/search', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({
        hits: [{ docId: 'd1', snippet: 'hello', score: 0.9 }],
        truncated: false,
      });
    };

    const client = createKbClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await client.search({ query: 'hello', topK: 3 });

    expect(capturedUrl).toBe('http://ai-center.test/kb/search');
    expect(capturedInit?.method).toBe('POST');
    expect(JSON.parse(String(capturedInit?.body))).toEqual({ query: 'hello', topK: 3 });
    expect(result.hits[0]?.docId).toBe('d1');
  });
});
