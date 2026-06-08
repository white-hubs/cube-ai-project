import 'reflect-metadata';
import { describe, expect, mock, test } from 'bun:test';
import { contextStore, type Context } from '@dangao/bun-server';
import { LocalFileController } from './local-file.controller';

function baseCtx(
  extra: Partial<Context> & {
    getBody?: () => Promise<unknown>;
    getParam?: (k: string) => string | undefined;
  } = {},
): Context {
  return {
    query: new URLSearchParams(),
    params: {},
    state: {
      subject: {
        tenant: 42,
        user: { userId: 'svc-user', tenant: 42, scopes: ['engine.use'] },
      },
    },
    getBody: extra.getBody ?? mock(async () => ({})),
    getParam: extra.getParam ?? mock(() => undefined),
    ...extra,
  } as unknown as Context;
}

describe('LocalFileController', () => {
  test('upload delegates to LocalFileService', async () => {
    const files = {
      upload: mock(async () => ({
        fileId: 'file_01',
        status: 'UNBOUND',
        mimeType: 'image/png',
        size: 3,
        sha256: 'a'.repeat(64),
        previewUrl: '/v1/files/file_01/preview',
      })),
    };
    const controller = new LocalFileController(files as never);
    const ctx = baseCtx({
      getBody: mock(async () => ({
        fileName: 'a.png',
        mimeType: 'image/png',
        base64: Buffer.from([1, 2, 3]).toString('base64'),
      })),
    });
    const result = await contextStore.run(ctx, async () => controller.upload());
    expect((result as { fileId: string }).fileId).toBe('file_01');
    expect(files.upload).toHaveBeenCalled();
  });

  test('preview delegates to LocalFileService', async () => {
    const files = {
      buildPreviewResponse: mock(async () => new Response('ok', { status: 200 })),
    };
    const controller = new LocalFileController(files as never);
    const ctx = baseCtx({
      getParam: mock((key: string) => (key === 'fileId' ? 'file_01' : undefined)),
    });
    const response = await contextStore.run(ctx, async () => controller.preview());
    expect(response.status).toBe(200);
    expect(files.buildPreviewResponse).toHaveBeenCalledWith('file_01', {
      tenant: 42,
      userId: 'svc-user',
    });
  });
});
