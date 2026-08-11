import type { BaselineThresholds, CaseMetrics, MacroMetrics, RankedHit, GoldenRelevantItem } from "./golden-types";

function hitKey(documentId: string, chunkId: string): string {
  return `${documentId}\u0000${chunkId}`;
}

function relevantGradeMap(relevant: readonly GoldenRelevantItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of relevant) {
    if (item.grade <= 0) continue;
    const key = hitKey(item.documentId, item.chunkId);
    const prev = map.get(key) ?? 0;
    if (item.grade > prev) map.set(key, item.grade);
  }
  return map;
}

/** hit_rate@k: 1 if any grade>0 relevant item appears in top-k, else 0. */
export function hitRateAtK(ranked: readonly RankedHit[], relevant: readonly GoldenRelevantItem[], k: number): number {
  if (k <= 0) return 0;
  const grades = relevantGradeMap(relevant);
  if (grades.size === 0) return 0;
  return ranked.slice(0, k).some((hit) => grades.has(hitKey(hit.documentId, hit.chunkId))) ? 1 : 0;
}

/** MRR: reciprocal rank of first relevant hit; 0 if none. */
export function meanReciprocalRank(ranked: readonly RankedHit[], relevant: readonly GoldenRelevantItem[]): number {
  const grades = relevantGradeMap(relevant);
  if (grades.size === 0) return 0;
  for (let index = 0; index < ranked.length; index += 1) {
    const hit = ranked[index]!;
    if (grades.has(hitKey(hit.documentId, hit.chunkId))) {
      return 1 / (index + 1);
    }
  }
  return 0;
}

function discountedGain(grade: number, rankIndexZeroBased: number): number {
  return (2 ** grade - 1) / Math.log2(rankIndexZeroBased + 2);
}

/** Standard nDCG@k with gains 2^grade - 1. */
export function ndcgAtK(ranked: readonly RankedHit[], relevant: readonly GoldenRelevantItem[], k: number): number {
  if (k <= 0) return 0;
  const grades = relevantGradeMap(relevant);
  if (grades.size === 0) return 0;

  let dcg = 0;
  const limit = Math.min(k, ranked.length);
  for (let index = 0; index < limit; index += 1) {
    const hit = ranked[index]!;
    const grade = grades.get(hitKey(hit.documentId, hit.chunkId)) ?? 0;
    if (grade > 0) dcg += discountedGain(grade, index);
  }

  const idealGrades = [...grades.values()].toSorted((a, b) => b - a).slice(0, k);
  let idcg = 0;
  for (let index = 0; index < idealGrades.length; index += 1) {
    idcg += discountedGain(idealGrades[index]!, index);
  }
  if (idcg === 0) return 0;
  return dcg / idcg;
}

export function computeCaseMetrics(
  caseId: string,
  ranked: readonly RankedHit[],
  relevant: readonly GoldenRelevantItem[],
  expectNoAnswer = false,
): CaseMetrics {
  return {
    caseId,
    isNoAnswerCase: expectNoAnswer,
    hitRateAt1: hitRateAtK(ranked, relevant, 1),
    hitRateAt3: hitRateAtK(ranked, relevant, 3),
    hitRateAt5: hitRateAtK(ranked, relevant, 5),
    mrr: meanReciprocalRank(ranked, relevant),
    ndcgAt1: ndcgAtK(ranked, relevant, 1),
    ndcgAt3: ndcgAtK(ranked, relevant, 3),
    ndcgAt5: ndcgAtK(ranked, relevant, 5),
    noAnswerFalseRecall: expectNoAnswer && ranked.length > 0 ? 1 : 0,
  };
}

export function aggregateMacroMetrics(cases: readonly CaseMetrics[]): MacroMetrics {
  const caseCount = cases.length;
  if (caseCount === 0) {
    return {
      answerableCaseCount: 0,
      hitRateAt1: 0,
      hitRateAt3: 0,
      hitRateAt5: 0,
      mrr: 0,
      ndcgAt1: 0,
      ndcgAt3: 0,
      ndcgAt5: 0,
      noAnswerCaseCount: 0,
      noAnswerFalseRecallRate: 0,
      caseCount: 0,
    };
  }

  const sum = cases.reduce(
    (acc, item) => ({
      answerableCaseCount: acc.answerableCaseCount + (item.isNoAnswerCase ? 0 : 1),
      hitRateAt1: acc.hitRateAt1 + (item.isNoAnswerCase ? 0 : item.hitRateAt1),
      hitRateAt3: acc.hitRateAt3 + (item.isNoAnswerCase ? 0 : item.hitRateAt3),
      hitRateAt5: acc.hitRateAt5 + (item.isNoAnswerCase ? 0 : item.hitRateAt5),
      mrr: acc.mrr + (item.isNoAnswerCase ? 0 : item.mrr),
      ndcgAt1: acc.ndcgAt1 + (item.isNoAnswerCase ? 0 : item.ndcgAt1),
      ndcgAt3: acc.ndcgAt3 + (item.isNoAnswerCase ? 0 : item.ndcgAt3),
      ndcgAt5: acc.ndcgAt5 + (item.isNoAnswerCase ? 0 : item.ndcgAt5),
      noAnswerCaseCount: acc.noAnswerCaseCount + (item.isNoAnswerCase ? 1 : 0),
      noAnswerFalseRecall: acc.noAnswerFalseRecall + item.noAnswerFalseRecall,
    }),
    {
      answerableCaseCount: 0,
      hitRateAt1: 0,
      hitRateAt3: 0,
      hitRateAt5: 0,
      mrr: 0,
      ndcgAt1: 0,
      ndcgAt3: 0,
      ndcgAt5: 0,
      noAnswerCaseCount: 0,
      noAnswerFalseRecall: 0,
    },
  );

  const answerable = sum.answerableCaseCount;

  return {
    answerableCaseCount: answerable,
    hitRateAt1: answerable > 0 ? sum.hitRateAt1 / answerable : 0,
    hitRateAt3: answerable > 0 ? sum.hitRateAt3 / answerable : 0,
    hitRateAt5: answerable > 0 ? sum.hitRateAt5 / answerable : 0,
    mrr: answerable > 0 ? sum.mrr / answerable : 0,
    ndcgAt1: answerable > 0 ? sum.ndcgAt1 / answerable : 0,
    ndcgAt3: answerable > 0 ? sum.ndcgAt3 / answerable : 0,
    ndcgAt5: answerable > 0 ? sum.ndcgAt5 / answerable : 0,
    noAnswerCaseCount: sum.noAnswerCaseCount,
    noAnswerFalseRecallRate: sum.noAnswerCaseCount > 0 ? sum.noAnswerFalseRecall / sum.noAnswerCaseCount : 0,
    caseCount,
  };
}

/** W1.4-H2: fail when macro hit@3 OR MRR is below baseline. */
export function assertMeetsBaseline(macro: MacroMetrics, baseline: BaselineThresholds): void {
  const hitFail = macro.hitRateAt3 < baseline.hitAt3;
  const mrrFail = macro.mrr < baseline.mrr;
  const ndcgFail = baseline.ndcgAt5 !== undefined && macro.ndcgAt5 < baseline.ndcgAt5;
  const falseRecallFail =
    baseline.noAnswerFalseRecallRate !== undefined && macro.noAnswerFalseRecallRate > baseline.noAnswerFalseRecallRate;
  if (!hitFail && !mrrFail && !ndcgFail && !falseRecallFail) return;

  const parts: string[] = [];
  if (hitFail) {
    parts.push(`hit@3 ${macro.hitRateAt3.toFixed(4)} < BASELINE ${baseline.hitAt3.toFixed(4)}`);
  }
  if (mrrFail) {
    parts.push(`MRR ${macro.mrr.toFixed(4)} < BASELINE ${baseline.mrr.toFixed(4)}`);
  }
  if (ndcgFail) {
    parts.push(`nDCG@5 ${macro.ndcgAt5.toFixed(4)} < BASELINE ${baseline.ndcgAt5!.toFixed(4)}`);
  }
  if (falseRecallFail) {
    parts.push(
      `no-answer false recall ${macro.noAnswerFalseRecallRate.toFixed(4)} > BASELINE ${baseline.noAnswerFalseRecallRate!.toFixed(4)}`,
    );
  }
  throw new Error(`Golden fixture regression: ${parts.join("; ")}`);
}
