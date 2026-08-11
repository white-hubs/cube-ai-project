import { describe, expect, test } from "bun:test";

import {
  type QualitySelectionCandidate,
  type RetrievalQualitySelectionOptions,
  normalizeForExactMatch,
  selectRetrievalQualityCandidates,
} from "./retrieval-quality-selection";

function candidate(
  id: string,
  rankScore: number,
  overrides: Partial<QualitySelectionCandidate> & {
    payload?: Partial<QualitySelectionCandidate["payload"]>;
  } = {},
): QualitySelectionCandidate {
  return {
    id,
    rankScore,
    score: rankScore,
    ...overrides,
    payload: {
      chunkId: id,
      documentId: "doc-1",
      sectionId: `section-${id}`,
      text: `content ${id}`,
      ...overrides.payload,
    },
  };
}

function options(overrides: Partial<RetrievalQualitySelectionOptions> = {}): RetrievalQualitySelectionOptions {
  return {
    diversificationEnabled: true,
    exactMatchReserve: 1,
    fallbackSimilarityThreshold: 0.2,
    maxChunksPerSection: 1,
    mmrLambda: 0.75,
    query: "unmatched query",
    rerankMinScore: 0.65,
    topK: 5,
    ...overrides,
  };
}

describe("retrieval quality selection (W2.3)", () => {
  test("uses an independent rerank floor and keeps fallback score semantics", () => {
    const result = selectRetrievalQualityCandidates(
      [
        candidate("model-low", 0.64, { modelRerankScore: 0.64 }),
        candidate("fallback", 0.64),
        candidate("model-high", 0.66, { modelRerankScore: 0.66 }),
      ],
      options(),
    );

    expect(result.map((item) => item.id)).toEqual(["model-high", "fallback"]);
  });

  test("exact reserve bypasses only the default floor and is capped at one", () => {
    const input = [
      candidate("exact-high", 0.62, { modelRerankScore: 0.62, payload: { text: "GB/T 13869 用电安全导则" } }),
      candidate("exact-low", 0.5, { modelRerankScore: 0.5, payload: { text: "引用 用电安全导则" } }),
      candidate("other", 0.8, { modelRerankScore: 0.8 }),
    ];
    const reserved = selectRetrievalQualityCandidates(input, options({ query: "用电安全导则" }));
    expect(reserved.map((item) => item.id)).toEqual(["other", "exact-high"]);

    const explicit = selectRetrievalQualityCandidates(input, options({ query: "用电安全导则", requestedSimilarityThreshold: 0.7 }));
    expect(explicit.map((item) => item.id)).toEqual(["other"]);
  });

  test("normalizes OCR-split identifiers for exact matching", () => {
    expect(normalizeForExactMatch("GB / T1 3 8 6 9 用电安全导则")).toBe(normalizeForExactMatch("GB/T 13869 用电安全导则"));
  });

  test("deduplicates normalized content and caps section per document", () => {
    const result = selectRetrievalQualityCandidates(
      [
        candidate("a", 0.9, { payload: { sectionId: "same", text: "相同 内容" } }),
        candidate("b", 0.8, { payload: { sectionId: "same", text: "相同   内容" } }),
        candidate("c", 0.7, { payload: { documentId: "doc-2", sectionId: "same", text: "另一文档" } }),
      ],
      options(),
    );
    expect(result.map((item) => item.id)).toEqual(["a", "c"]);
  });

  test("MMR removes a near-duplicate vector from the selected set", () => {
    const result = selectRetrievalQualityCandidates(
      [candidate("a", 0.9), candidate("b", 0.89), candidate("c", 0.8)],
      options({
        denseVectors: new Map([
          ["a", [1, 0]],
          ["b", [0.999, 0.001]],
          ["c", [0, 1]],
        ]),
        mmrLambda: 0.4,
        topK: 2,
      }),
    );
    expect(result.map((item) => item.id)).toEqual(["a", "c"]);
  });

  test("missing vectors degrades to stable relevance order", () => {
    const result = selectRetrievalQualityCandidates(
      [candidate("b", 0.8), candidate("a", 0.9), candidate("c", 0.7)],
      options({ denseVectors: new Map(), topK: 2 }),
    );
    expect(result.map((item) => item.id)).toEqual(["a", "b"]);
  });

  test("quality gate sample keeps exact top1, removes weak tail and returns fewer than topK", () => {
    const result = selectRetrievalQualityCandidates(
      [
        candidate("2086630204986372098-6", 0.81917, {
          modelRerankScore: 0.81917,
          payload: { sectionId: "heading:2", text: "GB / T1 3 8 6 9 用电安全导则" },
        }),
        candidate("2086630204986372098-17", 0.781345, {
          modelRerankScore: 0.781345,
          payload: { sectionId: "heading:4", text: "基本规定" },
        }),
        candidate("2086630204986372098-20", 0.676061, {
          modelRerankScore: 0.676061,
          payload: { sectionId: "heading:5-2", text: "用户用电安全自查" },
        }),
        candidate("2086630204986372098-19", 0.67, {
          modelRerankScore: 0.67,
          payload: { sectionId: "heading:5-2", text: "用户内部自查" },
        }),
        candidate("2086630204986372098-13", 0.625551, {
          modelRerankScore: 0.625551,
          payload: { sectionId: "heading:protective-load", text: "保安负荷" },
        }),
      ],
      options({ query: "用电安全导则", topK: 5 }),
    );

    expect(result[0]?.id).toBe("2086630204986372098-6");
    expect(result.map((item) => item.id)).not.toContain("2086630204986372098-13");
    expect(result.filter((item) => item.payload.sectionId === "heading:5-2")).toHaveLength(1);
    expect(result).toHaveLength(3);
  });

  test("diversification kill switch preserves thresholded score order", () => {
    const result = selectRetrievalQualityCandidates(
      [
        candidate("a", 0.9, { payload: { sectionId: "same" } }),
        candidate("b", 0.8, { payload: { sectionId: "same" } }),
        candidate("exact-low", 0.1, { modelRerankScore: 0.1, payload: { text: "unmatched query" } }),
      ],
      options({ diversificationEnabled: false, topK: 2 }),
    );
    expect(result.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
