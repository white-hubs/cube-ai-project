import type { RerankPort, RerankRequest, RerankResultItem } from "@cube-ai/contracts";

import { LlmProviderError } from "./openai-compat-provider";

export interface OpenAiCompatRerankConfig {
  /** Absolute rerank endpoint URL. The provider does not infer or append a path. */
  apiBaseUrl: string;
  apiKey: string;
  modelCode: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** OpenAI-compatible rerank wire DTO — kept private to llm-core. */
interface OpenAiRerankHttpResult {
  index?: number;
  relevance_score?: number;
}

interface OpenAiRerankHttpResponse {
  results?: OpenAiRerankHttpResult[];
}

/**
 * OpenAI-compatible rerank HTTP client (POSTs to the complete catalog endpoint).
 * Primary production target: Alibaba Cloud Model Studio `qwen3-rerank`.
 */
export class OpenAiCompatRerankProvider implements RerankPort {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: OpenAiCompatRerankConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = normalizeTimeoutMs(config.timeoutMs);
  }

  async rerank(req: RerankRequest, signal?: AbortSignal): Promise<RerankResultItem[]> {
    if (!this.config.apiKey) {
      throw new LlmProviderError("UPSTREAM_LLM_AUTH_FAILED", "OpenAiCompatRerankProvider: missing apiKey");
    }
    if (!this.config.apiBaseUrl) {
      throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", "OpenAiCompatRerankProvider: missing apiBaseUrl");
    }

    const url = normalizeEndpointUrl(this.config.apiBaseUrl);
    const startedAt = Date.now();
    const logContext = {
      documentCount: req.documents.length,
      endpointHost: safeEndpointHost(url),
      modelCode: this.config.modelCode,
      ns: "llm.provider.rerank-http",
      provider: "openai-compatible",
      topN: req.topN ?? null,
    };
    const body: Record<string, unknown> = {
      documents: req.documents,
      model: this.config.modelCode,
      query: req.query,
    };
    if (req.topN !== undefined) {
      body.top_n = req.topN;
    }

    const abort = createRequestAbortContext(signal, this.timeoutMs);
    let upstreamStatus: number | undefined;
    console.info(JSON.stringify({ ...logContext, event: "started" }));
    try {
      const resp = await this.fetchImpl(url, {
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: abort.signal,
      });
      upstreamStatus = resp.status;

      if (!resp.ok) {
        const txt = await resp.text();
        throw mapHttpError(resp.status, txt);
      }

      const raw = (await resp.json()) as OpenAiRerankHttpResponse;
      const results = raw.results ?? [];
      const mapped: RerankResultItem[] = [];
      for (const item of results) {
        if (typeof item.index !== "number" || typeof item.relevance_score !== "number") {
          continue;
        }
        mapped.push({ index: item.index, relevanceScore: item.relevance_score });
      }

      if (mapped.length === 0) {
        throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", "OpenAiCompatRerankProvider: empty or invalid results from upstream");
      }

      const sorted = mapped.toSorted((a, b) => b.relevanceScore - a.relevanceScore);
      console.info(
        JSON.stringify({
          ...logContext,
          durationMs: Date.now() - startedAt,
          event: "succeeded",
          resultCount: sorted.length,
          upstreamStatus,
        }),
      );
      return sorted;
    } catch (err) {
      console.warn(
        JSON.stringify({
          ...logContext,
          durationMs: Date.now() - startedAt,
          errorCode: err instanceof LlmProviderError ? err.code : abort.didTimeout() ? "UPSTREAM_LLM_TIMEOUT" : "UPSTREAM_FETCH_FAILED",
          errorName: err instanceof Error ? err.name : typeof err,
          event: "failed",
          upstreamStatus,
        }),
      );
      if (err instanceof LlmProviderError) {
        throw err;
      }
      if (abort.didTimeout()) {
        throw new LlmProviderError(
          "UPSTREAM_LLM_UNAVAILABLE",
          `OpenAiCompatRerankProvider: upstream timed out after ${this.timeoutMs}ms`,
          true,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", `OpenAiCompatRerankProvider: upstream fetch failed: ${message}`, true);
    } finally {
      abort.cleanup();
    }
  }
}

const DEFAULT_RERANK_TIMEOUT_MS = 10_000;

function normalizeTimeoutMs(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_RERANK_TIMEOUT_MS;
}

interface RequestAbortContext {
  signal: AbortSignal;
  didTimeout(): boolean;
  cleanup(): void;
}

function createRequestAbortContext(externalSignal: AbortSignal | undefined, timeoutMs: number): RequestAbortContext {
  const controller = new AbortController();
  let timedOut = false;
  const forwardExternalAbort = (): void => controller.abort(externalSignal?.reason);

  if (externalSignal?.aborted) {
    forwardExternalAbort();
  } else {
    externalSignal?.addEventListener("abort", forwardExternalAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`rerank timeout after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", forwardExternalAbort);
    },
    didTimeout: () => timedOut,
    signal: controller.signal,
  };
}

function normalizeEndpointUrl(endpoint: string): string {
  return endpoint.trim();
}

function safeEndpointHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<invalid-url>";
  }
}

function mapHttpError(status: number, body: string): LlmProviderError {
  if (status === 401 || status === 403) {
    return new LlmProviderError("UPSTREAM_LLM_AUTH_FAILED", body);
  }
  if (status === 429) {
    return new LlmProviderError("UPSTREAM_LLM_RATE_LIMITED", body, true);
  }
  if (status >= 500) {
    return new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", body, true);
  }
  return new LlmProviderError("UPSTREAM_LLM_INVALID_INPUT", body);
}
