import type { KnowledgeFeedbackType } from "@cube-ai/contracts/platform";

export interface SearchFeedbackInsert {
  comment?: string;
  hitChunkIds: string[];
  query: string;
  subjectId?: string | null;
  tenantId: string;
  traceId: string;
  type: KnowledgeFeedbackType;
}

export interface SearchFeedbackRow {
  comment?: string;
  createdAt: string;
  hitChunkIds: string[];
  id: string;
  query: string;
  tenantId: string;
  traceId: string;
  type: KnowledgeFeedbackType;
}

/**
 * Write/read seam shared by HTTP + agent event bypass (W4.2 extension point).
 * Aggregation metrics must NOT live here — see SearchFeedbackMetricsQuery.
 */
export interface SearchFeedbackRepository {
  findByTraceId(tenantId: string, traceId: string): Promise<SearchFeedbackRow[]>;
  insert(input: SearchFeedbackInsert): Promise<SearchFeedbackRow>;
}

export interface FeedbackDailyAggregate {
  day: string;
  missedSource: number;
  negativeRate: number;
  thumbsDown: number;
  thumbsUp: number;
  total: number;
  wrongCitation: number;
}

export interface TopBadQuery {
  count: number;
  query: string;
  types: KnowledgeFeedbackType[];
}

export interface RecallObservabilityItem {
  chunkId: string;
  recallCount: number;
}
