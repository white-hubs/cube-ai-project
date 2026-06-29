import type { LlmEmbedPurpose, LlmEmbedRequest, LlmEmbedResult, LlmProviderPort } from "@cube-ai/contracts";

import { LlmProviderError } from "./openai-compat-provider";

export interface DoubaoMultimodalEmbedConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  dimension?: number;
  fetch?: typeof fetch;
}

const DEFAULT_RETRIEVAL_PROFILE = "semantic-qa";

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

export class DoubaoMultimodalEmbedProvider implements Pick<LlmProviderPort, "embed"> {
  private readonly fetchImpl: typeof fetch;
  private readonly dimension: number;

  constructor(private readonly config: DoubaoMultimodalEmbedConfig) {
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.dimension = config.dimension ?? 1024;
  }

  async embed(req: LlmEmbedRequest, signal?: AbortSignal): Promise<LlmEmbedResult[]> {
    const results: LlmEmbedResult[] = [];
    for (let i = 0; i < req.input.length; i++) {
      const text = req.input[i]!;
      const context = req.contexts?.[i];
      const url = `${this.config.baseURL.replace(/\/+$/u, "")}/embeddings/multimodal`;
      const response = await this.fetchImpl(url, {
        body: JSON.stringify(
          buildDoubaoMultimodalEmbedBody({
            model: this.config.model,
            input: [text],
            dimension: this.dimension,
            purpose: req.purpose,
            contexts: context ? [context] : undefined,
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
        throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", await response.text(), true);
      }
      const body = (await response.json()) as {
        data?: { embedding?: number[]; sparse_embedding?: { index: number; value: number }[] };
      };
      const item = Array.isArray(body.data) ? body.data[0] : body.data;
      results.push({
        dense: item?.embedding ?? [],
        sparse: normalizeSparseEmbedding(item?.sparse_embedding),
      });
    }
    return results;
  }
}
