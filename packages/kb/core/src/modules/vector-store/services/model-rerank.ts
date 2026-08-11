import type { RerankPort } from "@cube-ai/contracts/platform";

/** Minimal candidate shape for model rerank (W2.2 seam). */
export interface ModelRerankCandidate {
  rankScore: number;
  /** Present only when the candidate was scored by the model-rerank stage. */
  modelRerankScore?: number;
  /** Dense/hybrid recall score; never overwritten by model rerank. */
  score: number;
  payload: {
    chunkType?: string | null;
    embeddingText?: string | null;
    fileName?: string | null;
    headers?: readonly string[] | string | null;
    headingPath?: readonly string[] | string | null;
    keywords?: readonly string[] | string | null;
    sectionId?: string | null;
    text?: string | null;
  };
}

export function clampRerankScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return Number(value.toFixed(6));
}

function stringList(value: readonly string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  }
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    }
  } catch {
    // A plain string is also a valid single metadata value.
  }
  return [value.trim()];
}

/** Normalize OCR-split GB/DL identifiers for comparison/model input only. */
export function normalizeStandardIdentifiers(value: string): string {
  return value.replaceAll(
    /\b(GB|DL)\s*(?:\/\s*(T)\s*)?(\d(?:\s*\d)+)/giu,
    (_match, family: string, recommended: string | undefined, digits: string) =>
      `${family.toUpperCase()}${recommended ? "/T" : ""} ${digits.replaceAll(/\s+/gu, "")}`,
  );
}

/**
 * Structured text for rerank input. `table-row-window` still prefers
 * `embeddingText` because it contains the richer table/header context.
 */
export function rerankDisplayText(payload: ModelRerankCandidate["payload"]): string {
  let content = String(payload.text ?? "").trim();
  if (payload.chunkType === "table-row-window") {
    const embeddingText = typeof payload.embeddingText === "string" ? payload.embeddingText.trim() : "";
    if (embeddingText !== "") {
      content = embeddingText;
    }
  }

  const sections: string[] = [];
  const fileName = typeof payload.fileName === "string" ? payload.fileName.trim() : "";
  const headingPath = stringList(payload.headingPath);
  const headers = stringList(payload.headers);
  const keywords = stringList(payload.keywords);
  if (fileName !== "") {
    sections.push(`[file] ${fileName}`);
  }
  if (headingPath.length > 0) {
    sections.push(`[section] ${headingPath.join(" > ")}`);
  }
  if (headers.length > 0) {
    sections.push(`[headers] ${headers.join(" | ")}`);
  }
  if (keywords.length > 0) {
    sections.push(`[keywords] ${keywords.join(", ")}`);
  }
  if (content !== "") {
    sections.push(`[content]\n${content}`);
  }

  return normalizeStandardIdentifiers(sections.length > 0 ? sections.join("\n") : content);
}

export interface ModelRerankOnceParams<T extends ModelRerankCandidate> {
  candidates: readonly T[];
  query: string;
  rerankPort: RerankPort;
  modelCode: string;
  tenant: number;
  /** Max candidates sent to the port (already rule-sorted). */
  inputTopN: number;
  signal?: AbortSignal;
}

export type ModelRerankedCandidate<T extends ModelRerankCandidate> = T & {
  modelRerankScore?: number;
};

/**
 * Allocate a bounded multi-document rerank input without request-order starvation.
 * Give each non-empty document one representative when the budget permits, then
 * fill remaining slots by the existing rule score with stable tie-breaking.
 */
export function allocateMultiDocumentRerankBudget<T extends ModelRerankCandidate>(
  groups: readonly (readonly T[])[],
  inputTopN: number,
): T[] {
  const budget = Number.isFinite(inputTopN) && inputTopN > 0 ? Math.floor(inputTopN) : 50;
  const annotated = groups.flatMap((group, groupIndex) =>
    group.map((candidate, candidateIndex) => ({ candidate, candidateIndex, groupIndex })),
  );
  if (annotated.length <= budget) {
    return annotated.map((entry) => entry.candidate);
  }
  const compare = (left: (typeof annotated)[number], right: (typeof annotated)[number]) =>
    right.candidate.rankScore - left.candidate.rankScore ||
    right.candidate.score - left.candidate.score ||
    left.groupIndex - right.groupIndex ||
    left.candidateIndex - right.candidateIndex;
  const representatives = groups
    .map((group, groupIndex) => ({ candidate: group[0], candidateIndex: 0, groupIndex }))
    .filter((entry): entry is (typeof annotated)[number] => entry.candidate !== undefined)
    .toSorted(compare)
    .slice(0, budget);
  const selected = new Set(representatives.map((entry) => entry.candidate));
  const remaining = annotated.filter((entry) => !selected.has(entry.candidate)).toSorted(compare);
  for (const entry of remaining) {
    if (selected.size >= budget) {
      break;
    }
    selected.add(entry.candidate);
  }
  return annotated
    .filter((entry) => selected.has(entry.candidate))
    .toSorted(compare)
    .map((entry) => entry.candidate);
}

/**
 * Single model-rerank stage: truncate → RerankPort.rerank once → map scores → sort.
 * Independent of HTTP search path (W2.2-H6). Caller owns failure degrade.
 */
export async function modelRerankOnce<T extends ModelRerankCandidate>(
  params: ModelRerankOnceParams<T>,
): Promise<ModelRerankedCandidate<T>[]> {
  if (params.candidates.length === 0) {
    return [];
  }
  const inputTopN = Number.isFinite(params.inputTopN) && params.inputTopN > 0 ? Math.floor(params.inputTopN) : 50;
  const truncated = params.candidates.slice(0, inputTopN);
  const documents = truncated.map((candidate) => rerankDisplayText(candidate.payload));
  if (documents.every((text) => text.trim() === "")) {
    return [...truncated];
  }

  const results = await params.rerankPort.rerank(
    {
      documents,
      modelCode: params.modelCode,
      query: params.query,
      tenant: params.tenant,
      topN: truncated.length,
    },
    params.signal,
  );

  const scoreByIndex = new Map<number, number>();
  for (const item of results) {
    if (Number.isInteger(item.index) && item.index >= 0 && item.index < truncated.length) {
      scoreByIndex.set(item.index, item.relevanceScore);
    }
  }

  return truncated
    .map((candidate, index) => {
      // A candidate sent to the model but missing from its response must not
      // silently fall back to the wider pre-rank threshold.
      const relevance = clampRerankScore(scoreByIndex.get(index) ?? 0);
      return {
        ...candidate,
        modelRerankScore: relevance,
        rankScore: relevance,
      };
    })
    .toSorted((left, right) => right.rankScore - left.rankScore || right.score - left.score);
}
