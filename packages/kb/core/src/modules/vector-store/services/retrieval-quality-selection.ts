import { type ModelRerankCandidate, normalizeStandardIdentifiers, rerankDisplayText } from "./model-rerank";

export interface QualitySelectionCandidate extends ModelRerankCandidate {
  id: string | number;
  payload: ModelRerankCandidate["payload"] & {
    chunkId?: string | null;
    documentId?: string | number | null;
  };
}

export interface RetrievalQualitySelectionOptions {
  query: string;
  topK: number;
  /** Explicit request override. <=0 disables score filtering. */
  requestedSimilarityThreshold?: number;
  fallbackSimilarityThreshold?: number;
  rerankMinScore: number;
  diversificationEnabled: boolean;
  exactMatchReserve: number;
  maxChunksPerSection: number;
  mmrLambda: number;
  denseVectors?: ReadonlyMap<string, readonly number[]>;
}

function clampUnit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function positiveThreshold(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function normalizeForExactMatch(value: string): string {
  return normalizeStandardIdentifiers(value)
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, "");
}

function compareByRelevance<T extends QualitySelectionCandidate>(left: T, right: T): number {
  return right.rankScore - left.rankScore || right.score - left.score || String(left.id).localeCompare(String(right.id));
}

function candidatePassesThreshold<T extends QualitySelectionCandidate>(candidate: T, options: RetrievalQualitySelectionOptions): boolean {
  if (options.requestedSimilarityThreshold !== undefined) {
    const explicit = positiveThreshold(options.requestedSimilarityThreshold);
    return explicit === undefined || candidate.rankScore > explicit;
  }
  const threshold =
    candidate.modelRerankScore !== undefined
      ? positiveThreshold(options.rerankMinScore)
      : positiveThreshold(options.fallbackSimilarityThreshold);
  return threshold === undefined || candidate.rankScore > threshold;
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function maxSimilarityToSelected<T extends QualitySelectionCandidate>(
  vector: readonly number[] | undefined,
  selected: readonly T[],
  vectors: ReadonlyMap<string, readonly number[]> | undefined,
): number {
  if (!vector || selected.length === 0) {
    return 0;
  }
  let maxSimilarity = 0;
  for (const chosen of selected) {
    const chosenVector = vectors?.get(String(chosen.id));
    if (chosenVector) {
      maxSimilarity = Math.max(maxSimilarity, cosineSimilarity(vector, chosenVector));
    }
  }
  return maxSimilarity;
}

function diversifyWithMmr<T extends QualitySelectionCandidate>(
  candidates: readonly T[],
  seeded: readonly T[],
  options: RetrievalQualitySelectionOptions,
): T[] {
  const topK = Math.max(0, Math.floor(options.topK));
  if (topK === 0) {
    return [];
  }
  const selected = [...seeded].slice(0, topK);
  const selectedIds = new Set(selected.map((candidate) => String(candidate.id)));
  const remaining = candidates.filter((candidate) => !selectedIds.has(String(candidate.id)));
  const vectors = options.denseVectors;
  const lambda = clampUnit(options.mmrLambda, 0.75);

  const scores = candidates.map((candidate) => candidate.rankScore);
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
  const relevance = (candidate: T): number => (maxScore === minScore ? 1 : (candidate.rankScore - minScore) / (maxScore - minScore));

  while (selected.length < topK && remaining.length > 0) {
    let bestIndex = 0;
    let bestMmr = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]!;
      const vector = vectors?.get(String(candidate.id));
      const maxSimilarity = maxSimilarityToSelected(vector, selected, vectors);
      const mmr = lambda * relevance(candidate) - (1 - lambda) * maxSimilarity;
      if (mmr > bestMmr || (mmr === bestMmr && compareByRelevance(candidate, remaining[bestIndex]!) < 0)) {
        bestMmr = mmr;
        bestIndex = index;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]!);
  }

  // MMR controls the selected set. Public ordering remains monotonic by the
  // score returned to clients, so rankScore is not semantically misleading.
  return selected.toSorted(compareByRelevance);
}

/**
 * Final quality selection: independent score floor → exact reserve → exact
 * content dedupe → section quota → MMR → dynamic TopK.
 */
export function selectRetrievalQualityCandidates<T extends QualitySelectionCandidate>(
  input: readonly T[],
  options: RetrievalQualitySelectionOptions,
): T[] {
  const topK = Number.isFinite(options.topK) ? Math.max(0, Math.floor(options.topK)) : 0;
  if (topK === 0 || input.length === 0) {
    return [];
  }

  const sorted = [...input].toSorted(compareByRelevance);
  const normalizedQuery = normalizeForExactMatch(options.query);
  const exact =
    !options.diversificationEnabled || normalizedQuery === ""
      ? []
      : sorted.filter((candidate) => normalizeForExactMatch(rerankDisplayText(candidate.payload)).includes(normalizedQuery));
  const reserveCount = Math.max(0, Math.floor(options.exactMatchReserve));
  const exactReserved = exact.slice(0, reserveCount);

  const thresholded = sorted.filter((candidate) => {
    if (candidatePassesThreshold(candidate, options)) {
      return true;
    }
    // Explicit request thresholds are never bypassed.
    return options.requestedSimilarityThreshold === undefined && exactReserved.includes(candidate);
  });

  if (!options.diversificationEnabled) {
    return thresholded.slice(0, topK);
  }

  const fingerprints = new Set<string>();
  const sectionCounts = new Map<string, number>();
  const sectionLimit = Math.max(1, Math.floor(options.maxChunksPerSection));
  const deduplicated: T[] = [];

  for (const candidate of thresholded) {
    const fingerprint = normalizeForExactMatch(rerankDisplayText(candidate.payload));
    if (fingerprint !== "" && fingerprints.has(fingerprint)) {
      continue;
    }

    const documentId = String(candidate.payload.documentId ?? "");
    const sectionId = typeof candidate.payload.sectionId === "string" ? candidate.payload.sectionId.trim() : "";
    const sectionKey = documentId !== "" && sectionId !== "" ? `${documentId}\u0000${sectionId}` : undefined;
    if (sectionKey && (sectionCounts.get(sectionKey) ?? 0) >= sectionLimit) {
      continue;
    }

    if (fingerprint !== "") {
      fingerprints.add(fingerprint);
    }
    if (sectionKey) {
      sectionCounts.set(sectionKey, (sectionCounts.get(sectionKey) ?? 0) + 1);
    }
    deduplicated.push(candidate);
  }

  const reserved = exactReserved.filter((candidate) => deduplicated.includes(candidate));
  return diversifyWithMmr(deduplicated, reserved, { ...options, topK });
}
