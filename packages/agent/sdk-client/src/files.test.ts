import { describe, expect, test } from 'bun:test';
import { createAgenticClient } from './client';

describe('FilesApi', () => {
  test('upload POSTs /files and parses response', async () => {
    let path = '';
    let body: unknown;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      path = new URL(url).pathname;
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return Response.json(
        {
          fileId: 'file_abc',
          status: 'UNBOUND',
          mimeType: 'image/png',
          size: 8,
          sha256: 'a'.repeat(64),
          previewUrl: '/files/file_abc/preview',
        },
        { status: 200 },
      );
    };

    const client = createAgenticClient({
      baseUrl: 'http://engine.test',
      auth: { provider: () => 'tok' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const uploaded = await client.files.upload({
      mimeType: 'image/png',
      base64: 'iVBORw0KGgo=',
      fileName: 'tiny.png',
    });

    expect(path).toBe('/files');
    expect(body).toEqual({
      mimeType: 'image/png',
      base64: 'iVBORw0KGgo=',
      fileName: 'tiny.png',
    });
    expect(uploaded).toEqual({
      fileId: 'file_abc',
      status: 'UNBOUND',
      mimeType: 'image/png',
      size: 8,
      sha256: 'a'.repeat(64),
      previewUrl: '/files/file_abc/preview',
    });
  });
});
