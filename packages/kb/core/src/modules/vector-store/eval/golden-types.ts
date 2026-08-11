/** Golden retrieval eval types (W1.4). Versioned cases schema; metrics stay decoupled from RetrievalService. */

export type GoldenProfileHint = "semantic" | "entity" | "navigation" | "table" | "timeline";

export interface GoldenRelevantItem {
  documentId: string;
  chunkId: string;
  /** Relevance grade; grade > 0 counts as relevant. Higher = more relevant for nDCG. */
  grade: number;
}

export interface GoldenCase {
  id: string;
  query: string;
  profileHint: GoldenProfileHint;
  relevant: GoldenRelevantItem[];
  /** Query is intentionally unanswerable from the corpus; any hit is false recall. */
  expectNoAnswer?: boolean;
  /** Cutoffs to report; defaults to [1, 3, 5] when omitted. */
  k?: number[];
}

export interface GoldenCaseFile {
  version: number;
  cases: GoldenCase[];
}

/** Ranked retrieval hit consumed by metrics (no service coupling). */
export interface RankedHit {
  documentId: string;
  chunkId: string;
  score?: number;
}

export type GoldenRetriever = (input: { caseId: string; query: string; topK: number }) => RankedHit[] | Promise<RankedHit[]>;

export interface CaseMetrics {
  caseId: string;
  isNoAnswerCase: boolean;
  hitRateAt1: number;
  hitRateAt3: number;
  hitRateAt5: number;
  mrr: number;
  ndcgAt1: number;
  ndcgAt3: number;
  ndcgAt5: number;
  noAnswerFalseRecall: number;
}

export interface MacroMetrics {
  answerableCaseCount: number;
  hitRateAt1: number;
  hitRateAt3: number;
  hitRateAt5: number;
  mrr: number;
  ndcgAt1: number;
  ndcgAt3: number;
  ndcgAt5: number;
  noAnswerCaseCount: number;
  noAnswerFalseRecallRate: number;
  caseCount: number;
}

export interface GoldenEvalReport {
  version: number;
  mode: "fixture" | "live";
  generatedAt: string;
  cases: CaseMetrics[];
  macro: MacroMetrics;
}

export interface BaselineThresholds {
  /** Macro hit_rate@3 floor; below → fail. */
  hitAt3: number;
  /** Macro MRR floor; below → fail. */
  mrr: number;
  /** Macro nDCG@5 floor; when supplied, below → fail. */
  ndcgAt5?: number;
  /** Maximum allowed false-recall rate on expectNoAnswer cases. */
  noAnswerFalseRecallRate?: number;
}
