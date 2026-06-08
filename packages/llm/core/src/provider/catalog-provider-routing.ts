import type { LlmModelRuntimeConfig } from '@cube-ai/contracts';

const NANO_BANANA_MODEL = /^nano-banana(?:-hd|-pro|-2)?$/u;

export function isGeekaiHost(apiBaseUrl: string): boolean {
  try {
    const host = new URL(apiBaseUrl).hostname.toLowerCase();
    return host === 'geekai.co' || host.endsWith('.geekai.co');
  } catch {
    return apiBaseUrl.toLowerCase().includes('geekai.co');
  }
}

export function isNanoBananaModelCode(modelCode: string): boolean {
  return NANO_BANANA_MODEL.test(modelCode.trim());
}

export function shouldUseGeekaiNanoBananaImageProvider(cfg: LlmModelRuntimeConfig): boolean {
  if (!isNanoBananaModelCode(cfg.modelCode)) return false;
  if (cfg.endpointType === 'geekai') return isGeekaiHost(cfg.apiBaseUrl);
  if (cfg.endpointType === 'openai_image') {
    return isGeekaiHost(cfg.apiBaseUrl) && cfg.providerCode === 'geekai';
  }
  return false;
}

export function normalizeDashscopeOpenAiBaseUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.replace(/\/+$/, '');
  if (trimmed.includes('/compatible-mode/')) return trimmed;
  if (trimmed.endsWith('dashscope.aliyuncs.com')) return `${trimmed}/compatible-mode/v1`;
  if (trimmed.endsWith('dashscope-intl.aliyuncs.com')) return `${trimmed}/compatible-mode/v1`;
  return trimmed;
}

export function isDashscopeText2Image(cfg: LlmModelRuntimeConfig): boolean {
  return cfg.endpointType === 'dashscope_text2image';
}

export function isDoubaoMultimodalEmbed(cfg: LlmModelRuntimeConfig): boolean {
  return (
    cfg.endpointType === 'volcengine_ark' &&
    cfg.modelTypes.some((t) => t === 'embedding' || t === 'multimodal')
  );
}
