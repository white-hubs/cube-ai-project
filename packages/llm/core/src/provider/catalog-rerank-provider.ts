import {
  type LlmCatalogPort,
  type LlmModelRuntimeConfig,
  type RerankPort,
  type RerankRequest,
  type RerankResultItem,
} from "@cube-ai/contracts";

import { LlmProviderError } from "./openai-compat-provider";
import { OpenAiCompatRerankProvider } from "./openai-compat-rerank-provider";

export interface InnerRerankProvider extends RerankPort {
  readonly id: string;
}

/**
 * Creates a rerank provider from catalog runtime config.
 * Production path: `endpointType === "openai_rerank"` (qwen3-rerank OpenAI-compatible wire protocol).
 * `jina_rerank` remains unsupported (different path `/v1/rerank`).
 */
export function createRerankProviderFromRuntimeConfig(cfg: LlmModelRuntimeConfig): InnerRerankProvider {
  if (cfg.endpointType === "openai_rerank") {
    if (cfg.modelCode === "qwen3-vl-rerank") {
      throw new LlmProviderError(
        "UPSTREAM_LLM_UNAVAILABLE",
        "createRerankProviderFromRuntimeConfig: qwen3-vl-rerank uses the native DashScope text-rerank protocol and cannot use openai_rerank",
      );
    }
    const provider = new OpenAiCompatRerankProvider({
      apiBaseUrl: cfg.apiBaseUrl,
      apiKey: cfg.apiKey,
      modelCode: cfg.modelCode,
    });
    return { id: "openai-compat-rerank", rerank: (req, signal) => provider.rerank(req, signal) };
  }

  if (cfg.endpointType === "jina_rerank") {
    throw new LlmProviderError(
      "UPSTREAM_LLM_UNAVAILABLE",
      `createRerankProviderFromRuntimeConfig: endpointType 'jina_rerank' is not supported; use openai_rerank (DashScope qwen3-rerank)`,
    );
  }

  throw new LlmProviderError(
    "UPSTREAM_LLM_UNAVAILABLE",
    `createRerankProviderFromRuntimeConfig: unsupported endpointType='${cfg.endpointType}' for rerank`,
  );
}

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
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.map.set(key, { expiresAt: Date.now() + this.ttlMs, value });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (!oldest) {
        break;
      }
      this.map.delete(oldest);
    }
  }
}

export interface CatalogRerankProviderOpts {
  catalog: LlmCatalogPort;
  providerFactory?: (cfg: LlmModelRuntimeConfig) => InnerRerankProvider;
  cacheTtlMs?: number;
  cacheMax?: number;
}

/**
 * Catalog-driven RerankPort: resolve model runtime then delegate to OpenAI-compat rerank.
 */
export class CatalogRerankProvider implements RerankPort {
  private readonly cache: TtlLruCache<InnerRerankProvider>;
  private readonly factory: (cfg: LlmModelRuntimeConfig) => InnerRerankProvider;

  constructor(private readonly opts: CatalogRerankProviderOpts) {
    this.factory = opts.providerFactory ?? createRerankProviderFromRuntimeConfig;
    this.cache = new TtlLruCache(opts.cacheTtlMs ?? 60_000, opts.cacheMax ?? 256);
  }

  async rerank(req: RerankRequest, signal?: AbortSignal): Promise<RerankResultItem[]> {
    const cfg = await this.opts.catalog.resolveModelRuntime(req.tenant, req.modelCode, signal ?? new AbortController().signal);

    if (!cfg) {
      throw new LlmProviderError(
        "UPSTREAM_LLM_UNAVAILABLE",
        `CatalogRerankProvider: no catalog entry for tenant=${req.tenant} model=${req.modelCode}`,
      );
    }

    const key = `${req.tenant}:${req.modelCode}:${cfg.endpointType}:${cfg.apiBaseUrl}:${cfg.apiKey}`;
    let inner = this.cache.get(key);
    if (!inner) {
      inner = this.factory(cfg);
      this.cache.set(key, inner);
    }

    return inner.rerank(req, signal);
  }
}
