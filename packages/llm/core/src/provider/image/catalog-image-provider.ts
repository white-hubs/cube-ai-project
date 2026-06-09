import type {
  ImageGenerationPort,
  ImageGenerationRequest,
  ImageGenerationResult,
  LlmCatalogPort,
  LlmModelRuntimeConfig,
} from '@cube-ai/contracts';
import { LlmProviderError } from '../openai-compat-provider';
import { shouldUseGeekaiNanoBananaImageProvider, isDashscopeText2Image } from '../catalog-provider-routing';
import { DashscopeText2ImageProvider } from './dashscope-text2image-provider';
import { GeekaiNanoBananaProvider } from './geekai-nano-banana-provider';

export interface InnerImageProvider extends ImageGenerationPort {
  readonly id: string;
}

/**
 * Creates the appropriate image generation provider from a resolved catalog runtime config.
 * Throws LlmProviderError if the endpointType cannot be routed to a known image provider.
 */
export function createImageProviderFromRuntimeConfig(cfg: LlmModelRuntimeConfig): InnerImageProvider {
  if (isDashscopeText2Image(cfg)) {
    const provider = new DashscopeText2ImageProvider({
      apiBaseUrl: cfg.apiBaseUrl,
      apiKey: cfg.apiKey,
      modelCode: cfg.modelCode,
    });
    return { id: 'dashscope-text2image', generate: (req, signal) => provider.generate(req, signal) };
  }

  if (shouldUseGeekaiNanoBananaImageProvider(cfg)) {
    const provider = new GeekaiNanoBananaProvider({
      apiBaseUrl: cfg.apiBaseUrl,
      apiKey: cfg.apiKey,
      modelCode: cfg.modelCode,
    });
    return { id: 'geekai-nano-banana', generate: (req, signal) => provider.generate(req, signal) };
  }

  throw new LlmProviderError(
    'UPSTREAM_LLM_UNAVAILABLE',
    `createImageProviderFromRuntimeConfig: unsupported endpointType='${cfg.endpointType}' providerCode='${cfg.providerCode}' for image generation`,
  );
}

// ── TTL LRU cache (same pattern as catalog-driven-provider.ts) ─────────────

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

export interface CatalogImageProviderOpts {
  catalog: LlmCatalogPort;
  providerFactory?: (cfg: LlmModelRuntimeConfig) => InnerImageProvider;
  cacheTtlMs?: number;
  cacheMax?: number;
}

/**
 * Catalog-driven image generation provider.
 * Resolves model runtime config from catalog and delegates to the appropriate image provider.
 */
export class CatalogImageProvider implements ImageGenerationPort {
  private readonly cache: TtlLruCache<InnerImageProvider>;
  private readonly factory: (cfg: LlmModelRuntimeConfig) => InnerImageProvider;

  constructor(private readonly opts: CatalogImageProviderOpts) {
    this.factory = opts.providerFactory ?? createImageProviderFromRuntimeConfig;
    this.cache = new TtlLruCache(opts.cacheTtlMs ?? 60_000, opts.cacheMax ?? 256);
  }

  async generate(req: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    const cfg = await this.opts.catalog.resolveModelRuntime(
      req.tenant,
      req.modelCode,
      signal ?? new AbortController().signal,
    );

    if (!cfg) {
      throw new LlmProviderError(
        'UPSTREAM_LLM_UNAVAILABLE',
        `CatalogImageProvider: no catalog entry for tenant=${req.tenant} model=${req.modelCode}`,
      );
    }

    const key = `${req.tenant}:${req.modelCode}:${cfg.endpointType}:${cfg.apiBaseUrl}:${cfg.apiKey}`;
    let inner = this.cache.get(key);
    if (!inner) {
      inner = this.factory(cfg);
      this.cache.set(key, inner);
    }

    return inner.generate(req, signal);
  }
}
