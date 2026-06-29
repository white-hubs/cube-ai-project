import type { ImageGenerationPort, ImageGenerationRequest, ImageGenerationResult } from "@cube-ai/contracts";

import { LlmProviderError } from "../openai-compat-provider";

export interface GeekaiNanoBananaConfig {
  apiBaseUrl: string;
  apiKey: string;
  modelCode: string;
  fetchImpl?: typeof fetch;
}

export class GeekaiNanoBananaProvider implements ImageGenerationPort {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: GeekaiNanoBananaConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  async generate(req: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    const base = this.config.apiBaseUrl.replace(/\/+$/u, "");
    const url = `${base}/v1/images/generations`;

    const body: Record<string, unknown> = {
      model: this.config.modelCode,
      n: req.n ?? 1,
      prompt: req.prompt,
    };
    if (req.size !== undefined && req.size.length > 0) {
      body.size = req.size;
    }

    const resp = await this.fetchImpl(url, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw mapGeekaiError(resp.status, txt);
    }

    const raw = (await resp.json()) as GeekaiGenerateResponse;
    const images = (raw.data ?? []).map((d) => ({ url: d.url ?? "" })).filter((i) => i.url);

    if (images.length === 0) {
      throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", "GeekAI nano-banana returned no image URLs");
    }

    return {
      images,
      model: this.config.modelCode,
      requestId: raw.created ? String(raw.created) : null,
    };
  }
}

// ── Response types ────────────────────────────────────────────────────────────

interface GeekaiGenerateResponse {
  created?: number;
  data?: { url?: string; b64_json?: string }[];
}

function mapGeekaiError(status: number, body: string): LlmProviderError {
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
