import { describe, expect, test } from "bun:test";

import type { RankedHit, GoldenRelevantItem } from "./golden-types";
import { aggregateMacroMetrics, assertMeetsBaseline, computeCaseMetrics, hitRateAtK, meanReciprocalRank, ndcgAtK } from "./metrics";

const relevant: GoldenRelevantItem[] = [
  { documentId: "doc-a", chunkId: "chunk-1", grade: 2 },
  { documentId: "doc-a", chunkId: "chunk-2", grade: 1 },
];

describe("golden retrieval metrics", () => {
  test("hit_rate@k is 1 when any relevant appears in top-k", () => {
    const ranked: RankedHit[] = [
      { documentId: "doc-x", chunkId: "noise" },
      { documentId: "doc-a", chunkId: "chunk-2" },
      { documentId: "doc-a", chunkId: "chunk-1" },
    ];
    expect(hitRateAtK(ranked, relevant, 1)).toBe(0);
    expect(hitRateAtK(ranked, relevant, 2)).toBe(1);
    expect(hitRateAtK(ranked, relevant, 3)).toBe(1);
  });

  test("MRR uses first relevant reciprocal rank", () => {
    const ranked: RankedHit[] = [
      { documentId: "doc-x", chunkId: "noise" },
      { documentId: "doc-a", chunkId: "chunk-1" },
    ];
    expect(meanReciprocalRank(ranked, relevant)).toBeCloseTo(0.5, 6);
    expect(meanReciprocalRank([{ documentId: "doc-a", chunkId: "chunk-1" }], relevant)).toBe(1);
    expect(meanReciprocalRank([{ documentId: "doc-x", chunkId: "noise" }], relevant)).toBe(0);
  });

  test("nDCG@k prefers higher grades earlier", () => {
    const ideal: RankedHit[] = [
      { documentId: "doc-a", chunkId: "chunk-1" },
      { documentId: "doc-a", chunkId: "chunk-2" },
    ];
    const swapped: RankedHit[] = [
      { documentId: "doc-a", chunkId: "chunk-2" },
      { documentId: "doc-a", chunkId: "chunk-1" },
    ];
    const idealNdcg = ndcgAtK(ideal, relevant, 2);
    const swappedNdcg = ndcgAtK(swapped, relevant, 2);
    expect(idealNdcg).toBeCloseTo(1, 6);
    expect(swappedNdcg).toBeLessThan(idealNdcg);
    expect(swappedNdcg).toBeGreaterThan(0);
  });

  test("grade<=0 items are ignored", () => {
    const withZero: GoldenRelevantItem[] = [
      { documentId: "doc-a", chunkId: "chunk-1", grade: 0 },
      { documentId: "doc-a", chunkId: "chunk-2", grade: 1 },
    ];
    const ranked: RankedHit[] = [{ documentId: "doc-a", chunkId: "chunk-1" }];
    expect(hitRateAtK(ranked, withZero, 1)).toBe(0);
    expect(meanReciprocalRank(ranked, withZero)).toBe(0);
  });

  test("macro averages case metrics", () => {
    const a = computeCaseMetrics("a", [{ documentId: "doc-a", chunkId: "chunk-1" }], relevant);
    const b = computeCaseMetrics("b", [{ documentId: "doc-x", chunkId: "noise" }], relevant);
    const macro = aggregateMacroMetrics([a, b]);
    expect(macro.caseCount).toBe(2);
    expect(macro.hitRateAt1).toBeCloseTo(0.5, 6);
    expect(macro.mrr).toBeCloseTo(0.5, 6);
  });

  test("reports false recall only for explicitly unanswerable cases", () => {
    const clean = computeCaseMetrics("na-clean", [], [], true);
    const falseRecall = computeCaseMetrics("na-hit", [{ documentId: "noise", chunkId: "x" }], [], true);
    const normal = computeCaseMetrics("normal", [{ documentId: "noise", chunkId: "x" }], relevant);
    const macro = aggregateMacroMetrics([clean, falseRecall, normal]);
    expect(macro.noAnswerCaseCount).toBe(2);
    expect(macro.noAnswerFalseRecallRate).toBe(0.5);
    expect(() => assertMeetsBaseline(macro, { hitAt3: 0, mrr: 0, noAnswerFalseRecallRate: 0 })).toThrow("no-answer false recall");
  });

  test("assertMeetsBaseline fails when hit@3 or MRR is below floor", () => {
    const macro = aggregateMacroMetrics([computeCaseMetrics("a", [{ documentId: "doc-x", chunkId: "noise" }], relevant)]);
    expect(() => assertMeetsBaseline(macro, { hitAt3: 0.9, mrr: 0.9 })).toThrow(/hit@3|MRR/);
    expect(() =>
      assertMeetsBaseline(
        {
          answerableCaseCount: 1,
          hitRateAt1: 1,
          hitRateAt3: 1,
          hitRateAt5: 1,
          mrr: 1,
          ndcgAt1: 1,
          ndcgAt3: 1,
          ndcgAt5: 1,
          caseCount: 1,
          noAnswerCaseCount: 0,
          noAnswerFalseRecallRate: 0,
        },
        { hitAt3: 0.9, mrr: 0.9 },
      ),
    ).not.toThrow();
  });

  test("assertMeetsBaseline enforces the optional nDCG@5 quality floor", () => {
    const macro = aggregateMacroMetrics([
      computeCaseMetrics("bad-order", [{ documentId: "d", chunkId: "noise" }], [{ documentId: "d", chunkId: "answer", grade: 3 }]),
    ]);
    expect(() => assertMeetsBaseline(macro, { hitAt3: 0, mrr: 0, ndcgAt5: 0.8 })).toThrow(/nDCG@5/);
  });

  test("metrics module has no RetrievalService import (W1.4-H6)", async () => {
    const source = await Bun.file(new URL("./metrics.ts", import.meta.url)).text();
    expect(source).not.toContain("RetrievalService");
    expect(source).not.toContain("retrieval.service");
  });
});
