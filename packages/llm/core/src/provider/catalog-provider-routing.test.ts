import { describe, expect, it } from 'bun:test';
import type { LlmModelRuntimeConfig } from '@cube-ai/contracts';
import {
  isNanoBananaModelCode,
  isVolcengineArk3dGeneration,
  normalizeDashscopeOpenAiBaseUrl,
  shouldUseGeekaiNanoBananaImageProvider,
} from './catalog-provider-routing';

function cfg(partial: Partial<LlmModelRuntimeConfig> & Pick<LlmModelRuntimeConfig, 'endpointType' | 'modelCode'>): LlmModelRuntimeConfig {
  return {
    displayName: 'x',
    apiBaseUrl: 'https://geekai.co/api/v1',
    apiKey: 'k',
    providerCode: 'geekai',
    modelTypes: ['image_generation'],
    isFree: false,
    ...partial,
  };
}

describe('catalog-provider-routing', () => {
  it('isNanoBananaModelCode matches nano-banana family only', () => {
    expect(isNanoBananaModelCode('nano-banana')).toBe(true);
    expect(isNanoBananaModelCode('nano-banana-hd')).toBe(true);
    expect(isNanoBananaModelCode('nano-banana-pro')).toBe(true);
    expect(isNanoBananaModelCode('nano-banana-2')).toBe(true);
    expect(isNanoBananaModelCode('jina-reader-v1')).toBe(false);
  });

  it('shouldUseGeekaiNanoBananaImageProvider for geekai endpoint + nano-banana', () => {
    expect(
      shouldUseGeekaiNanoBananaImageProvider(
        cfg({ endpointType: 'geekai', modelCode: 'nano-banana' }),
      ),
    ).toBe(true);
  });

  it('shouldUseGeekaiNanoBananaImageProvider for openai_image on geekai host', () => {
    expect(
      shouldUseGeekaiNanoBananaImageProvider(
        cfg({ endpointType: 'openai_image', modelCode: 'nano-banana-pro' }),
      ),
    ).toBe(true);
  });

  it('isVolcengineArk3dGeneration detects Seed3D models', () => {
    expect(
      isVolcengineArk3dGeneration(
        cfg({ endpointType: 'volcengine_ark', modelCode: 'seed3d', modelTypes: ['3d_generation'] }),
      ),
    ).toBe(true);
    expect(
      isVolcengineArk3dGeneration(
        cfg({ endpointType: 'openai', modelCode: 'doubao', modelTypes: ['chat'] }),
      ),
    ).toBe(false);
  });

  it('normalizeDashscopeOpenAiBaseUrl appends compatible-mode/v1', () => {
    expect(normalizeDashscopeOpenAiBaseUrl('https://dashscope.aliyuncs.com')).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    );
    expect(
      normalizeDashscopeOpenAiBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    ).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });
});
