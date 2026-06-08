import { describe, expect, test } from 'bun:test';
import { createKbConsoleClient } from './client';

describe('KbConsoleClient', () => {
  test('listDocuments GET /kb/documents', async () => {
    let capturedUrl = '';
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      expect(init?.method).toBe('GET');
      return Response.json({ items: [{ id: 'doc-1', name: 'readme.md' }] });
    };

    const client = createKbConsoleClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await client.listDocuments();

    expect(capturedUrl).toBe('http://ai-center.test/kb/documents');
    expect(result.items?.[0]?.name).toBe('readme.md');
  });
});
