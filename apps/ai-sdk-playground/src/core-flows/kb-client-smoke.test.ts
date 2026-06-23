/**
 * KB client smoke — ai-sdk-playground wires `@cube-ai/kb-sdk-client` to `POST /kb/search`.
 */
import { describe, expect, test } from 'bun:test';
import { createKbClient } from '@cube-ai/kb-sdk-client';
import { sdkConfig } from '../config';

describe('ai-sdk-playground kb client smoke', () => {
  test('createKbClient.search() POST /kb/search', async () => {
    let capturedUrl = '';
    const cfg = sdkConfig();
    const client = createKbClient({
      baseUrl: cfg.baseUrl,
      headers: cfg.headers,
      fetchImpl: (async (url, init) => {
        capturedUrl = typeof url === 'string' ? url : url.toString();
        expect(init?.method).toBe('POST');
        return Response.json({
          items: [{ text: 'hello', score: 0.9, documentId: 'd1' }],
        });
      }) as typeof fetch,
    });

    const result = await client.search({ query: 'hello', topK: 3 });
    expect(capturedUrl).toBe(`${cfg.baseUrl}/kb/search`);
    expect(result.items[0]?.documentId).toBe('d1');
  });
});
