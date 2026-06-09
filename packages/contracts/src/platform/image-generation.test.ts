import { describe, expect, it } from 'bun:test';
import { ImageGenerationRequestSchema } from './image-generation';

describe('ImageGenerationRequestSchema', () => {
  it('parses a minimal text2image request', () => {
    const r = ImageGenerationRequestSchema.parse({ tenant: 1, modelCode: 'qwen-image', prompt: 'a cat' });
    expect(r.prompt).toBe('a cat');
    expect(r.modelCode).toBe('qwen-image');
    expect(r.tenant).toBe(1);
  });

  it('allows optional fields', () => {
    const r = ImageGenerationRequestSchema.parse({
      tenant: 2,
      modelCode: 'wanx-v1',
      prompt: 'a mountain',
      n: 2,
      size: '1024x1024',
      negativePrompt: 'blurry',
      seed: 42,
      referenceImages: ['https://example.com/ref.png'],
    });
    expect(r.n).toBe(2);
    expect(r.seed).toBe(42);
    expect(r.referenceImages?.[0]).toBe('https://example.com/ref.png');
  });

  it('rejects n > 4', () => {
    expect(() =>
      ImageGenerationRequestSchema.parse({ tenant: 1, modelCode: 'x', prompt: 'y', n: 5 }),
    ).toThrow();
  });

  it('rejects empty prompt', () => {
    expect(() =>
      ImageGenerationRequestSchema.parse({ tenant: 1, modelCode: 'x', prompt: '' }),
    ).toThrow();
  });
});
