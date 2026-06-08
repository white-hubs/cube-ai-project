/**
 * KB client smoke — ai-console wires `@cube-ai/kb-sdk-client` to `POST /kb/search`.
 */
import { describe, expect, test } from 'bun:test';
import { createKbClient } from '@cube-ai/kb-sdk-client';
import { sdkConfig } from '../config';

describe('ai-console kb client smoke', () => {
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
          hits: [{ docId: 'd1', snippet: 'hello', score: 0.9 }],
          truncated: false,
        });
      }) as typeof fetch,
    });

    const result = await client.search({ query: 'hello', topK: 3 });
    expect(capturedUrl).toBe(`${cfg.baseUrl}/kb/search`);
    expect(result.hits[0]?.docId).toBe('d1');
  });
});
