import { describe, expect, test } from 'bun:test';
import { createKbClient } from './client';

describe('KbClient', () => {
  test('search POST /kb/search — 返回 kb-core {items} 格式', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({
        items: [{ text: 'hello', score: 0.9, headingPath: ['Section 1'], keywords: ['hello'] }],
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
    expect(result.items[0]?.text).toBe('hello');
    expect(result.items[0]?.score).toBe(0.9);
    expect(result.items[0]?.headingPath).toEqual(['Section 1']);
  });

  test('searchByDocuments POST /kb/search/by-documents — 返回 kb-core {items} 格式', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({
        items: [{ text: 'matched chunk', score: 0.85, headingPath: [], keywords: [] }],
      });
    };

    const client = createKbClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await client.searchByDocuments({
      query: 'test',
      documents: [{ documentId: 'doc-1', topK: 5 }],
    });

    expect(capturedUrl).toBe('http://ai-center.test/kb/search/by-documents');
    expect(capturedInit?.method).toBe('POST');
    expect(result.items[0]?.text).toBe('matched chunk');
    expect(result.items[0]?.score).toBe(0.85);
  });

  test('searchByDirectory POST /kb/search/by-directory — 返回 kb-core {items} 格式', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;
      return Response.json({
        items: [{ text: 'dir chunk', score: 0.7, headingPath: null, keywords: null }],
      });
    };

    const client = createKbClient({
      baseUrl: 'http://ai-center.test',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await client.searchByDirectory({
      query: 'dir query',
      directoryId: 'dir-1',
      topK: 3,
    });

    expect(capturedUrl).toBe('http://ai-center.test/kb/search/by-directory');
    expect(capturedInit?.method).toBe('POST');
    expect(result.items[0]?.text).toBe('dir chunk');
    expect(result.items[0]?.score).toBe(0.7);
  });
});
