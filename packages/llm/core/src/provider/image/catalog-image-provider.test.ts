import { describe, expect, it } from 'bun:test';
import { createImageProviderFromRuntimeConfig } from './catalog-image-provider';

describe('createImageProviderFromRuntimeConfig', () => {
  it('routes dashscope_text2image to the dashscope provider', () => {
    const p = createImageProviderFromRuntimeConfig({
      modelCode: 'wan2.2-t2i',
      displayName: 'wan',
      endpointType: 'dashscope_text2image',
      apiBaseUrl: 'https://dashscope.aliyuncs.com',
      apiKey: 'k',
      modelTypes: ['image_generation'],
      isFree: false,
      providerCode: 'dashscope',
    });
    expect(p.id).toBe('dashscope-text2image');
  });

  it('routes geekai nano-banana to the geekai provider', () => {
    const p = createImageProviderFromRuntimeConfig({
      modelCode: 'nano-banana',
      displayName: 'nb',
      endpointType: 'geekai',
      apiBaseUrl: 'https://geekai.co',
      apiKey: 'k',
      modelTypes: ['image_generation'],
      isFree: false,
      providerCode: 'geekai',
    });
    expect(p.id).toBe('geekai-nano-banana');
  });

  it('routes openai_image + geekai host nano-banana to geekai provider', () => {
    const p = createImageProviderFromRuntimeConfig({
      modelCode: 'nano-banana',
      displayName: 'nb',
      endpointType: 'openai_image',
      apiBaseUrl: 'https://geekai.co/v1',
      apiKey: 'k',
      modelTypes: ['image_generation'],
      isFree: false,
      providerCode: 'geekai',
    });
    expect(p.id).toBe('geekai-nano-banana');
  });

  it('throws on unsupported endpointType for image', () => {
    expect(() =>
      createImageProviderFromRuntimeConfig({
        modelCode: 'some-model',
        displayName: 'test',
        endpointType: 'openai',
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: 'k',
        modelTypes: ['image_generation'],
        isFree: false,
        providerCode: 'openai',
      }),
    ).toThrow();
  });
});
