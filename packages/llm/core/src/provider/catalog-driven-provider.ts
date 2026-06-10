import type {
  LlmCatalogPort,
  LlmChatRequest,
  LlmChatResponse,
  LlmEmbedRequest,
  LlmEmbedResult,
  LlmModelRuntimeConfig,
  LlmProviderPort,
  LlmStreamChunk,
} from '@cube-ai/contracts';
import { DoubaoMultimodalEmbedProvider } from './doubao-multimodal-embed';
import { LlmProviderError, OpenAiCompatProvider } from './openai-compat-provider';
import { AnthropicProvider } from './anthropic-provider';
import {
  isDoubaoMultimodalEmbed,
  normalizeDashscopeOpenAiBaseUrl,
} from './catalog-provider-routing';
import { llmDebug } from './debug-log';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TtlLruCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (!oldest) break;
      this.map.delete(oldest);
    }
  }
}

export interface InnerLlmProvider extends LlmProviderPort {
  readonly id: string;
}

export function createInnerProviderFromCatalogRuntimeConfig(cfg: LlmModelRuntimeConfig): InnerLlmProvider {
  if (isDoubaoMultimodalEmbed(cfg)) {
    const embedder = new DoubaoMultimodalEmbedProvider({
      baseURL: cfg.apiBaseUrl,
      apiKey: cfg.apiKey,
      model: cfg.modelCode,
    });
    return {
      id: 'doubao-multimodal-embed',
      chat: async () => {
        throw new LlmProviderError('UPSTREAM_LLM_UNAVAILABLE', 'Doubao embed model does not support chat');
      },
      chatStream: async function* () {
        throw new LlmProviderError('UPSTREAM_LLM_UNAVAILABLE', 'Doubao embed model does not support chatStream');
      },
      embed: (req, signal) => embedder.embed(req, signal),
    };
  }

  const baseURL =
    cfg.endpointType === 'dashscope'
      ? normalizeDashscopeOpenAiBaseUrl(cfg.apiBaseUrl)
      : cfg.apiBaseUrl;

  const openai = new OpenAiCompatProvider({
    baseURL,
    apiKey: cfg.apiKey,
    model: cfg.modelCode,
  });

  switch (cfg.endpointType) {
    case 'openai':
    case 'openai_response':
    case 'azure_openai':
    case 'new_api':
    case 'ollama':
    case 'dashscope':
    case 'volcengine_ark':
      return {
        id: 'openai-compat',
        chat: (req, signal) => openai.chat(req, signal),
        chatStream: (req, signal) => openai.chatStream(req, signal),
        embed: (req, signal) => openai.embed(req, signal),
      };
    case 'anthropic': {
      const anthropic = new AnthropicProvider({
        baseURL: cfg.apiBaseUrl,
        apiKey: cfg.apiKey,
        model: cfg.modelCode,
      });
      return {
        id: 'anthropic',
        chat: (req, signal) => anthropic.chat(req, signal),
        chatStream: (req, signal) => anthropic.chatStream(req, signal),
        embed: (req, signal) => anthropic.embed(req, signal),
      };
    }
    case 'openai_image':
    case 'dashscope_text2image':
      throw new LlmProviderError(
        'UPSTREAM_LLM_UNAVAILABLE',
        `image generation endpointType '${cfg.endpointType}' must use ImageGenerationPort, not chat provider`,
      );
    case 'gemini':
    case 'jina_rerank':
      throw new LlmProviderError(
        'UPSTREAM_LLM_UNAVAILABLE',
        `endpointType ${cfg.endpointType} not yet supported (out of scope for current workstream)`,
      );
    case 'geekai':
      throw new LlmProviderError(
        'UPSTREAM_LLM_UNAVAILABLE',
        `endpointType 'geekai' is an image-only provider; use ImageGenerationPort`,
      );
    default: {
      const exhaustive: never = cfg.endpointType;
      throw new LlmProviderError('UPSTREAM_LLM_UNAVAILABLE', `unknown endpointType ${String(exhaustive)}`);
    }
  }
}

function runtimeConfigHash(cfg: LlmModelRuntimeConfig): string {
  return JSON.stringify([
    cfg.modelCode,
    cfg.endpointType,
    cfg.apiBaseUrl,
    cfg.apiKey,
    cfg.providerCode,
    cfg.isFree,
    [...cfg.modelTypes].sort(),
  ]);
}

export interface CatalogDrivenProviderOpts {
  catalog: LlmCatalogPort;
  providerFactory?: (cfg: LlmModelRuntimeConfig) => InnerLlmProvider;
  cacheTtlMs?: number;
  cacheMax?: number;
  onLegacyKeyFallback?: (event: { tenant: number; modelCode: string }) => void;
}

export class CatalogDrivenProvider implements LlmProviderPort {
  private readonly cache: TtlLruCache<InnerLlmProvider>;
  private readonly factory: (cfg: LlmModelRuntimeConfig) => InnerLlmProvider;
  private readonly onLegacyKeyFallback?: CatalogDrivenProviderOpts['onLegacyKeyFallback'];

  constructor(private readonly opts: CatalogDrivenProviderOpts) {
    this.factory = opts.providerFactory ?? createInnerProviderFromCatalogRuntimeConfig;
    this.cache = new TtlLruCache(opts.cacheTtlMs ?? 60_000, opts.cacheMax ?? 256);
    this.onLegacyKeyFallback = opts.onLegacyKeyFallback;
  }

  chat(req: LlmChatRequest, signal?: AbortSignal): Promise<LlmChatResponse> {
    return this.resolve(req.tenant, req.modelCode, req.legacyApiKey, req.legacyApiBaseUrl, signal).then(
      (inner) => inner.chat(req, signal),
    );
  }

  async *chatStream(req: LlmChatRequest, signal?: AbortSignal): AsyncIterable<LlmStreamChunk> {
    const inner = await this.resolve(
      req.tenant,
      req.modelCode,
      req.legacyApiKey,
      req.legacyApiBaseUrl,
      signal,
    );
    yield* inner.chatStream(req, signal);
  }

  embed(req: LlmEmbedRequest, signal?: AbortSignal): Promise<LlmEmbedResult[]> {
    return this.resolve(
      req.tenant,
      req.modelCode,
      req.legacyApiKey,
      req.legacyApiBaseUrl,
      signal,
    ).then((inner) => inner.embed(req, signal));
  }

  async listAvailableModels(tenant: number, signal?: AbortSignal): Promise<string[]> {
    const providers = await this.opts.catalog.listProviders(tenant, signal ?? new AbortController().signal);
    return providers.filter((p) => p.enabled).map((p) => p.providerCode);
  }

  private async resolve(
    tenant: number,
    modelCode: string,
    legacyApiKey?: string,
    legacyApiBaseUrl?: string,
    signal?: AbortSignal,
  ): Promise<InnerLlmProvider> {
    const cfg = await this.opts.catalog.resolveModelRuntime(
      tenant,
      modelCode,
      signal ?? new AbortController().signal,
    );

    if (!cfg && legacyApiKey) {
      this.onLegacyKeyFallback?.({ tenant, modelCode });
      const fallbackCfg: LlmModelRuntimeConfig = {
        modelCode,
        displayName: modelCode,
        endpointType: 'openai',
        apiBaseUrl: legacyApiBaseUrl ?? 'https://api.openai.com/v1',
        apiKey: legacyApiKey,
        modelTypes: [],
        isFree: false,
        providerCode: 'legacy-inline-key',
      };
      llmDebug('catalog.resolve.legacyFallback', {
        tenant,
        modelCode,
        apiBaseUrl: fallbackCfg.apiBaseUrl,
        endpointType: fallbackCfg.endpointType,
      });
      return this.factory(fallbackCfg);
    }

    if (!cfg) {
      llmDebug('catalog.resolve.miss', { tenant, modelCode });
      throw new LlmProviderError(
        'UPSTREAM_LLM_UNAVAILABLE',
        `CatalogDrivenProvider: no catalog entry for tenant=${tenant} model=${modelCode}`,
      );
    }

    const key = `${tenant}:${modelCode}:${runtimeConfigHash(cfg)}`;
    const cached = this.cache.get(key);
    if (cached) {
      llmDebug('catalog.resolve.hit', {
        tenant,
        modelCode,
        providerCode: cfg.providerCode,
        endpointType: cfg.endpointType,
        apiBaseUrl: cfg.apiBaseUrl,
        cached: true,
      });
      return cached;
    }
    llmDebug('catalog.resolve.hit', {
      tenant,
      modelCode,
      providerCode: cfg.providerCode,
      endpointType: cfg.endpointType,
      apiBaseUrl: cfg.apiBaseUrl,
      cached: false,
    });
    const inner = this.factory(cfg);
    this.cache.set(key, inner);
    return inner;
  }
}
