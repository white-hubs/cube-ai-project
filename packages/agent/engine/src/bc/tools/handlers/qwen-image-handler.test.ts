import { describe, expect, test } from 'bun:test';
import type { ImageGenerationPort, ImageGenerationRequest, ImageGenerationResult } from '@cube-ai/contracts';
import { QwenImageHandler } from './qwen-image-handler';

class MockImagePort implements ImageGenerationPort {
  constructor(private readonly result: ImageGenerationResult | null) {}

  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.result) {
      throw new Error('No catalog entry for tenant=' + req.tenant + ' model=' + req.modelCode);
    }
    return this.result;
  }
}

const testCtx = {
  auth: { tenant: 1, user: { userId: 'u1', scopes: [] as string[] } },
  traceId: 't1',
  session: { id: '281474976710655', turnId: '281474976710656' },
  signal: new AbortController().signal,
};

describe('QwenImageHandler', () => {
  test('delegates to ImageGenerationPort and returns result', async () => {
    const handler = new QwenImageHandler(
      new MockImagePort({
        requestId: 'req-1',
        model: 'qwen-image-2.0-pro',
        images: [{ url: 'https://example.com/result.png' }],
      }),
    );

    const out = await handler.invoke({ prompt: 'a red circle' }, testCtx);

    expect(out.model).toBe('qwen-image-2.0-pro');
    expect(out.requestId).toBe('req-1');
    expect(out.images).toEqual([{ url: 'https://example.com/result.png' }]);
  });

  test('passes through all optional fields to ImageGenerationPort', async () => {
    let capturedReq: ImageGenerationRequest | null = null;
    const capturingPort: ImageGenerationPort = {
      async generate(req) {
        capturedReq = req;
        return { requestId: null, model: req.modelCode, images: [{ url: 'x' }] };
      },
    };

    const handler = new QwenImageHandler(capturingPort);
    await handler.invoke(
      {
        prompt: 'a mountain',
        modelRef: 'wan2.2-t2i',
        referenceImages: ['https://ref.example.com/img.png'],
        n: 2,
        size: '1024x1024',
        negativePrompt: 'blurry',
        seed: 42,
      },
      testCtx,
    );

    expect(capturedReq?.modelCode).toBe('wan2.2-t2i');
    expect(capturedReq?.n).toBe(2);
    expect(capturedReq?.size).toBe('1024x1024');
    expect(capturedReq?.negativePrompt).toBe('blurry');
    expect(capturedReq?.seed).toBe(42);
    expect(capturedReq?.referenceImages?.[0]).toBe('https://ref.example.com/img.png');
    expect(capturedReq?.tenant).toBe(1);
  });

  test('rejects empty prompt', async () => {
    const handler = new QwenImageHandler(new MockImagePort(null));
    await expect(handler.invoke({ prompt: '  ' }, testCtx)).rejects.toThrow(/prompt/);
  });

  test('rejects more than 3 referenceImages', async () => {
    const handler = new QwenImageHandler(
      new MockImagePort({ requestId: null, model: 'x', images: [{ url: 'y' }] }),
    );
    await expect(
      handler.invoke(
        {
          prompt: 'test',
          referenceImages: ['a', 'b', 'c', 'd'],
        },
        testCtx,
      ),
    ).rejects.toThrow(/referenceImages/);
  });

  test('uses QWEN_IMAGE_MODEL env as default model when no modelRef', async () => {
    let capturedModelCode = '';
    const port: ImageGenerationPort = {
      async generate(req) {
        capturedModelCode = req.modelCode;
        return { requestId: null, model: req.modelCode, images: [{ url: 'x' }] };
      },
    };

    const handler = new QwenImageHandler(port);
    process.env.QWEN_IMAGE_MODEL = 'qwen-image-test-model';
    try {
      await handler.invoke({ prompt: 'sky' }, testCtx);
    } finally {
      delete process.env.QWEN_IMAGE_MODEL;
    }

    expect(capturedModelCode).toBe('qwen-image-test-model');
  });
});
