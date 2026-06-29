import type { LlmEmbedPurpose } from "@cube-ai/contracts";

export const DEFAULT_RETRIEVAL_PROFILE = "semantic-qa";

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
  contexts?: { retrievalProfile?: string }[];
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

export function normalizeSparseEmbedding(
  sparseEmbedding: { index: number; value: number }[] | undefined,
): { indices: number[]; values: number[] } | null {
  if (!Array.isArray(sparseEmbedding) || sparseEmbedding.length === 0) {
    return null;
  }
  return {
    indices: sparseEmbedding.map((item) => item.index),
    values: sparseEmbedding.map((item) => item.value),
  };
}
