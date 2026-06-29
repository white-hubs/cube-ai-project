import type { ImageGenerationPort, ImageGenerationRequest, ImageGenerationResult } from "@cube-ai/contracts";

import { LlmProviderError } from "../openai-compat-provider";

export interface DashscopeText2ImageConfig {
  apiBaseUrl: string;
  apiKey: string;
  modelCode: string;
  fetchImpl?: typeof fetch;
  /** Max poll attempts before giving up (default 60). */
  maxPollAttempts?: number;
  /** Poll interval in ms (default 2000). */
  pollIntervalMs?: number;
}

const GENERATION_PATH = "/services/aigc/multimodal-generation/generation";
const TASK_STATUS_PATH = "/tasks/";

export class DashscopeText2ImageProvider implements ImageGenerationPort {
  private readonly fetchImpl: typeof fetch;
  private readonly maxPollAttempts: number;
  private readonly pollIntervalMs: number;

  constructor(private readonly config: DashscopeText2ImageConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    this.maxPollAttempts = config.maxPollAttempts ?? 60;
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
  }

  async generate(req: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    const base = this.config.apiBaseUrl.replace(/\/+$/u, "");
    const genUrl = `${base}${GENERATION_PATH}`;

    const content: { image?: string; text?: string }[] = [];
    for (const img of req.referenceImages ?? []) {
      content.push({ image: img });
    }
    content.push({ text: req.prompt });

    const parameters: Record<string, unknown> = {
      n: req.n ?? 1,
      prompt_extend: true,
      watermark: false,
    };
    if (req.negativePrompt) {
      parameters.negative_prompt = req.negativePrompt;
    }
    if (req.size !== undefined && req.size.length > 0) {
      parameters.size = req.size;
    }
    if (req.seed !== undefined) {
      parameters.seed = req.seed;
    }

    const genBody = {
      input: { messages: [{ role: "user", content }] },
      model: this.config.modelCode,
      parameters,
    };

    const genResp = await this.fetchImpl(genUrl, {
      body: JSON.stringify(genBody),
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      method: "POST",
      signal,
    });

    if (!genResp.ok) {
      const txt = await genResp.text();
      throw mapDashscopeError(genResp.status, txt);
    }

    const genJson = (await genResp.json()) as DashscopeSubmitResponse;
    const taskId = genJson.output?.task_id;

    if (!taskId) {
      const urls = extractImageUrls(genJson);
      if (urls.length > 0) {
        return { images: urls.map((url) => ({ url })), model: this.config.modelCode, requestId: genJson.request_id ?? null };
      }
      throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", "DashScope did not return task_id or direct image URLs");
    }

    return this.pollTask(base, taskId, genJson.request_id ?? null, signal);
  }

  private async pollTask(base: string, taskId: string, requestId: string | null, signal?: AbortSignal): Promise<ImageGenerationResult> {
    const statusUrl = `${base}${TASK_STATUS_PATH}${taskId}`;

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      if (signal?.aborted) {
        throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", "Aborted");
      }

      await sleep(this.pollIntervalMs);

      const resp = await this.fetchImpl(statusUrl, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        method: "GET",
        signal,
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw mapDashscopeError(resp.status, txt);
      }

      const body = (await resp.json()) as DashscopeTaskResponse;
      const status = body.output?.task_status;

      if (status === "SUCCEEDED") {
        const urls = extractImageUrls(body);
        if (urls.length === 0) {
          throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", "DashScope task succeeded but returned no image URLs");
        }
        return {
          images: urls.map((url) => ({ url })),
          model: this.config.modelCode,
          requestId: body.request_id ?? requestId,
        };
      }

      if (status === "FAILED") {
        const code = body.output?.code ?? "UNKNOWN";
        const message = body.output?.message ?? `Task ${taskId} failed`;
        throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", `DashScope task failed: ${code} - ${message}`);
      }
    }

    throw new LlmProviderError(
      "UPSTREAM_LLM_UNAVAILABLE",
      `DashScope task ${taskId} did not complete after ${this.maxPollAttempts} poll attempts`,
    );
  }
}

// ── Response types ────────────────────────────────────────────────────────────

interface DashscopeSubmitResponse {
  request_id?: string;
  output?: {
    task_id?: string;
    task_status?: string;
    results?: { url?: string }[];
    choices?: {
      message?: {
        content?: { image?: string; text?: string }[];
      };
    }[];
  };
}

interface DashscopeTaskResponse {
  request_id?: string;
  output?: {
    task_id?: string;
    task_status?: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | string;
    results?: { url?: string }[];
    choices?: {
      message?: {
        content?: { image?: string }[];
      };
    }[];
    code?: string;
    message?: string;
  };
}

function extractImageUrls(doc: DashscopeSubmitResponse | DashscopeTaskResponse): string[] {
  const output = doc.output;
  if (!output) {
    return [];
  }

  const urls: string[] = [];

  if (Array.isArray(output.results)) {
    for (const r of output.results) {
      if (r.url) {
        urls.push(r.url);
      }
    }
  }

  if (Array.isArray(output.choices)) {
    for (const choice of output.choices) {
      urls.push(...extractChoiceImageUrls(choice.message?.content));
    }
  }

  return urls;
}

function extractChoiceImageUrls(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const urls: string[] = [];
  for (const item of content) {
    if (item.image) {
      urls.push(item.image);
    }
  }
  return urls;
}

function mapDashscopeError(status: number, body: string): LlmProviderError {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
