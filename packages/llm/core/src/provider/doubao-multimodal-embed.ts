import type { LlmEmbedPurpose, LlmEmbedRequest, LlmEmbedResult, LlmProviderPort } from "@cube-ai/contracts";

import { llmDebug } from "./debug-log";
import { LlmProviderError } from "./openai-compat-provider";

// Batch capability/limit is endpoint-specific. Default to single-input requests
// until the deployed model contract has been verified explicitly.
const DEFAULT_BATCH_SIZE = 1;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 100;
const DEFAULT_RETRIEVAL_PROFILE = "semantic-qa";

export interface DoubaoMultimodalEmbedConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  dimension?: number;
  fetch?: typeof fetch;
  /** Max texts per HTTP request. Safe default 1; configure >1 only after contract verification. */
  embedBatchSize?: number;
  /** Max concurrent batch HTTP requests. Default 4. */
  embedConcurrency?: number;
  /** Max retries after the first attempt for retryable failures. Default 3. */
  maxRetries?: number;
  /** Base delay (ms) for exponential backoff. Default 100. */
  retryBaseDelayMs?: number;
  /** Injectable sleep for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const DOCUMENT_RETRIEVAL_INSTRUCTIONS: Record<string, string> = {
  "entity-lookup": "Instruction:Compress the text into one word.\nQuery:",
  navigation: "Instruction:Compress the text into one word.\nQuery:",
  "semantic-qa": "Instruction:Compress the text into one word.\nQuery:",
  timeline: "Instruction:Compress the text into one word.\nQuery:",
};

const QUERY_RETRIEVAL_INSTRUCTIONS: Record<string, string> = {
  "entity-lookup": "Target_modality: text.\nInstruction:根据名称、编号、别名或关键词检索最相关的结构化记录\nQuery:",
  navigation: "Target_modality: text.\nInstruction:根据标题、章节名或目录关键词定位最相关的文档章节\nQuery:",
  "semantic-qa": "Target_modality: text.\nInstruction:为这个问题生成表示以用于检索可回答问题的相关内容\nQuery:",
  timeline: "Target_modality: text.\nInstruction:根据时间点、时间范围或对白内容定位最相关的时间片段\nQuery:",
};

export function resolveRetrievalInstruction(purpose: LlmEmbedPurpose | undefined, retrievalProfile?: string): string {
  const profile = retrievalProfile ?? DEFAULT_RETRIEVAL_PROFILE;
  return purpose === "query"
    ? (QUERY_RETRIEVAL_INSTRUCTIONS[profile] ?? QUERY_RETRIEVAL_INSTRUCTIONS[DEFAULT_RETRIEVAL_PROFILE]!)
    : (DOCUMENT_RETRIEVAL_INSTRUCTIONS[profile] ?? DOCUMENT_RETRIEVAL_INSTRUCTIONS[DEFAULT_RETRIEVAL_PROFILE]!);
}

export function buildDoubaoMultimodalEmbedBody(params: {
  model: string;
  input: string[];
  dimension: number;
  purpose?: LlmEmbedPurpose;
  contexts?: LlmEmbedRequest["contexts"];
}) {
  return {
    dimensions: params.dimension,
    encoding_format: "float",
    input: params.input.map((text) => ({ type: "text", text })),
    instructions: resolveRetrievalInstruction(params.purpose, params.contexts?.[0]?.retrievalProfile),
    model: params.model,
    multi_embedding: { type: "enabled" },
    sparse_embedding: { type: "enabled" },
  };
}

export function normalizeSparseEmbedding(sparseEmbedding: { index: number; value: number }[] | undefined): LlmEmbedResult["sparse"] {
  if (!Array.isArray(sparseEmbedding) || sparseEmbedding.length === 0) {
    return null;
  }
  return {
    indices: sparseEmbedding.map((item) => item.index),
    values: sparseEmbedding.map((item) => item.value),
  };
}

export type EmbedItem = {
  index: number;
  text: string;
  retrievalProfile: string;
};

export type EmbedBatch = {
  groupKey: string;
  retrievalProfile: string;
  items: EmbedItem[];
};

/**
 * Group embed inputs for HTTP batching.
 * - document (and undefined purpose): sequential batches; instructions are identical across profiles.
 * - query: group by retrievalProfile — never mix profiles in one HTTP request.
 */
export function planEmbedBatches(req: Pick<LlmEmbedRequest, "input" | "contexts" | "purpose">, batchSize: number): EmbedBatch[] {
  const items: EmbedItem[] = req.input.map((text, index) => ({
    index,
    retrievalProfile: req.contexts?.[index]?.retrievalProfile ?? DEFAULT_RETRIEVAL_PROFILE,
    text,
  }));

  const groups: EmbedItem[][] = req.purpose === "query" ? groupByProfile(items) : [items];

  const batches: EmbedBatch[] = [];
  for (const group of groups) {
    if (group.length === 0) {
      continue;
    }
    const retrievalProfile = group[0]!.retrievalProfile;
    const groupKey = req.purpose === "query" ? `query:${retrievalProfile}` : "document";
    for (let offset = 0; offset < group.length; offset += batchSize) {
      batches.push({
        groupKey,
        items: group.slice(offset, offset + batchSize),
        retrievalProfile,
      });
    }
  }
  return batches;
}

function groupByProfile(items: EmbedItem[]): EmbedItem[][] {
  const order: string[] = [];
  const map = new Map<string, EmbedItem[]>();
  for (const item of items) {
    let bucket = map.get(item.retrievalProfile);
    if (!bucket) {
      bucket = [];
      map.set(item.retrievalProfile, bucket);
      order.push(item.retrievalProfile);
    }
    bucket.push(item);
  }
  return order.map((key) => map.get(key)!);
}

type DoubaoEmbedDataItem = {
  embedding?: number[];
  sparse_embedding?: { index: number; value: number }[];
  index?: number;
};

/**
 * Map vendor `data` onto batch-local slots.
 * Prefers each item's `index` field when present; otherwise uses array order.
 * Missing / out-of-range / duplicate slots throw a retryable error.
 */
export function mapEmbedResponseData(data: unknown, batchLength: number): LlmEmbedResult[] {
  const items = normalizeDataItems(data, batchLength);
  const slots = Array.from({ length: batchLength }, (): LlmEmbedResult | undefined => undefined);

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const slot = typeof item.index === "number" ? item.index : i;
    if (!Number.isInteger(slot) || slot < 0 || slot >= batchLength) {
      throw new LlmProviderError(
        "UPSTREAM_LLM_UNAVAILABLE",
        `Doubao embed response index ${String(item.index)} out of range for batch length ${batchLength}`,
        true,
      );
    }
    if (slots[slot] !== undefined) {
      throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", `Doubao embed response has duplicate index ${slot}`, true);
    }
    slots[slot] = {
      dense: item.embedding ?? [],
      sparse: normalizeSparseEmbedding(item.sparse_embedding),
    };
  }

  for (let i = 0; i < batchLength; i++) {
    if (slots[i] === undefined) {
      throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", `Doubao embed response missing data for batch index ${i}`, true);
    }
  }

  return slots as LlmEmbedResult[];
}

function normalizeDataItems(data: unknown, batchLength: number): DoubaoEmbedDataItem[] {
  if (Array.isArray(data)) {
    return data as DoubaoEmbedDataItem[];
  }
  if (data && typeof data === "object" && batchLength === 1) {
    return [data as DoubaoEmbedDataItem];
  }
  throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", "Doubao embed response data must be an array aligned to the request batch", true);
}

export class DoubaoMultimodalEmbedProvider implements Pick<LlmProviderPort, "embed"> {
  private readonly fetchImpl: typeof fetch;
  private readonly dimension: number;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleepImpl: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(private readonly config: DoubaoMultimodalEmbedConfig) {
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.dimension = config.dimension ?? 1024;
    this.batchSize = Math.max(1, config.embedBatchSize ?? DEFAULT_BATCH_SIZE);
    this.concurrency = Math.max(1, config.embedConcurrency ?? DEFAULT_CONCURRENCY);
    this.maxRetries = Math.max(0, config.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryBaseDelayMs = Math.max(0, config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
    this.sleepImpl = config.sleep ?? defaultSleep;
  }

  async embed(req: LlmEmbedRequest, signal?: AbortSignal): Promise<LlmEmbedResult[]> {
    const startedAt = Date.now();
    const batches = planEmbedBatches(req, this.batchSize);
    llmDebug("doubao.embed.plan", {
      batchCount: batches.length,
      batchSize: this.batchSize,
      concurrency: this.concurrency,
      inputCount: req.input.length,
      purpose: req.purpose ?? "document",
    });

    const results = Array.from({ length: req.input.length }, (): LlmEmbedResult | undefined => undefined);
    await mapPool(batches, this.concurrency, async (batch) => {
      const batchResults = await this.embedBatchWithRetry(req, batch, signal);
      for (let i = 0; i < batch.items.length; i++) {
        results[batch.items[i]!.index] = batchResults[i]!;
      }
    });

    llmDebug("doubao.embed.done", {
      batchCount: batches.length,
      elapsedMs: Date.now() - startedAt,
      inputCount: req.input.length,
    });
    if (results.some((result) => result === undefined)) {
      throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", "Doubao embed batches did not produce a result for every input", true);
    }
    return results as LlmEmbedResult[];
  }

  private async embedBatchWithRetry(req: LlmEmbedRequest, batch: EmbedBatch, signal?: AbortSignal): Promise<LlmEmbedResult[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal?.aborted) {
        throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", "Aborted", true);
      }
      try {
        return await this.embedBatchOnce(req, batch, signal);
      } catch (err) {
        lastError = err;
        const retryable = err instanceof LlmProviderError && err.retryable;
        if (!retryable || attempt === this.maxRetries) {
          throw err;
        }
        const retryAfterMs = (err as LlmProviderError & { retryAfterMs?: number }).retryAfterMs;
        const delayMs = retryAfterMs ?? this.retryBaseDelayMs * 2 ** attempt;
        llmDebug("doubao.embed.retry", {
          attempt: attempt + 1,
          batchSize: batch.items.length,
          delayMs,
          groupKey: batch.groupKey,
          maxRetries: this.maxRetries,
        });
        await this.sleepImpl(delayMs, signal);
      }
    }
    throw lastError;
  }

  private async embedBatchOnce(req: LlmEmbedRequest, batch: EmbedBatch, signal?: AbortSignal): Promise<LlmEmbedResult[]> {
    const url = `${this.config.baseURL.replace(/\/+$/u, "")}/embeddings/multimodal`;
    const response = await this.fetchImpl(url, {
      body: JSON.stringify(
        buildDoubaoMultimodalEmbedBody({
          contexts: [{ retrievalProfile: batch.retrievalProfile }],
          dimension: this.dimension,
          input: batch.items.map((item) => item.text),
          model: this.config.model,
          purpose: req.purpose,
        }),
      ),
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    });

    if (!response.ok) {
      throw mapHttpError(response.status, await response.text(), response.headers.get("retry-after"));
    }

    const body = (await response.json()) as { data?: unknown };
    return mapEmbedResponseData(body.data, batch.items.length);
  }
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function mapHttpError(status: number, body: string, retryAfter: string | null): LlmProviderError {
  if (status === 401 || status === 403) {
    return new LlmProviderError("UPSTREAM_LLM_AUTH_FAILED", body);
  }
  if (status === 429) {
    return Object.assign(new LlmProviderError("UPSTREAM_LLM_RATE_LIMITED", body, true), {
      retryAfterMs: parseRetryAfterMs(retryAfter),
    });
  }
  if (status >= 500) {
    return Object.assign(new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", body, true), {
      retryAfterMs: parseRetryAfterMs(retryAfter),
    });
  }
  return new LlmProviderError("UPSTREAM_LLM_INVALID_INPUT", body);
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) {
    return;
  }
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) {
        return;
      }
      await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", "Aborted", true));
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", "Aborted", true));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
