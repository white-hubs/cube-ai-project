import { describe, expect, test } from 'bun:test';
import type { AdapterCallContext, ResourceReference } from '@tachu/core';
import { LocalFileMultimodalResolver } from './local-file-multimodal-resolver';
import type { ImageAssetReader } from '../files/image-asset-reader';

const ctx: AdapterCallContext = {
  correlation: {
    traceId: 'trace-1',
    requestId: 'req-1',
    sessionId: 'sess-1',
    turnId: 'turn-1',
  },
  tenant: 42,
  subject: { userId: 'user-42', tenant: '42' },
};

const imageRef = (overrides: Partial<ResourceReference> = {}): ResourceReference => ({
  key: 'key-1',
  kind: 'image',
  uri: 'file_01',
  mimeType: 'image/png',
  displayLabel: '[Image #1]',
  ...overrides,
});

const okReader = (): ImageAssetReader => ({
  readImageAsset: async () => ({
    fileId: 'file_01',
    mimeType: 'image/png',
    sizeBytes: 3,
    sha256: 'a'.repeat(64),
    bytes: new Uint8Array([1, 2, 3]),
  }),
});

describe('LocalFileMultimodalResolver.resolveResources', () => {
  test('resolves an image ref to an image_url data URI carrier keyed by ref.key', async () => {
    const resolver = new LocalFileMultimodalResolver(okReader());
    const result = await resolver.resolveResources([imageRef()], ctx);
    const entry = result.get('key-1');
    expect(entry?.ok).toBe(true);
    if (!entry?.ok) return;
    expect(entry.part).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AQID' },
    });
  });

  test('degrades (no throw) when the reader fails', async () => {
    const reader: ImageAssetReader = {
      readImageAsset: async () => {
        throw new Error('not found');
      },
    };
    const resolver = new LocalFileMultimodalResolver(reader);
    const result = await resolver.resolveResources([imageRef({ uri: 'file_missing' })], ctx);
    const entry = result.get('key-1');
    expect(entry?.ok).toBe(false);
    if (entry?.ok) return;
    expect(entry?.reason).toBe('image-resolution-failed');
    expect(entry?.userVisibleReason).toContain('无法读取');
  });

  test('degrades when tenant is missing', async () => {
    const resolver = new LocalFileMultimodalResolver(okReader());
    const noTenantCtx: AdapterCallContext = { ...ctx, tenant: undefined };
    const result = await resolver.resolveResources([imageRef()], noTenantCtx);
    expect(result.get('key-1')?.ok).toBe(false);
  });

  test('degrades non-image kinds without calling the reader', async () => {
    const reader: ImageAssetReader = {
      readImageAsset: async () => {
        throw new Error('should not read');
      },
    };
    const resolver = new LocalFileMultimodalResolver(reader);
    const result = await resolver.resolveResources(
      [imageRef({ key: 'doc-1', kind: 'file', uri: 'file_doc' })],
      ctx,
    );
    const entry = result.get('doc-1');
    expect(entry?.ok).toBe(false);
    if (entry?.ok) return;
    expect(entry?.reason).toContain('unsupported resource kind');
  });

  test('isolates per-ref failures across a mixed batch', async () => {
    let call = 0;
    const reader: ImageAssetReader = {
      readImageAsset: async () => {
        call += 1;
        if (call === 1) throw new Error('first fails');
        return {
          fileId: 'file_ok',
          mimeType: 'image/jpeg',
          sizeBytes: 3,
          sha256: 'b'.repeat(64),
          bytes: new Uint8Array([4, 5, 6]),
        };
      },
    };
    const resolver = new LocalFileMultimodalResolver(reader);
    const result = await resolver.resolveResources(
      [
        imageRef({ key: 'bad', uri: 'file_bad' }),
        imageRef({ key: 'good', uri: 'file_ok', mimeType: 'image/jpeg' }),
      ],
      ctx,
    );
    expect(result.size).toBe(2);
    expect(result.get('bad')?.ok).toBe(false);
    const good = result.get('good');
    expect(good?.ok).toBe(true);
    if (!good?.ok) return;
    expect(good.part).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,BAUG' },
    });
  });
});
