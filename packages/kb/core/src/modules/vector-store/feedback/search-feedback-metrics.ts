import type { KnowledgeFeedbackType } from "@cube-ai/contracts/platform";

import type { FeedbackDailyAggregate, RecallObservabilityItem, SearchFeedbackRow, TopBadQuery } from "./search-feedback.types";

const NEGATIVE_TYPES = new Set<KnowledgeFeedbackType>(["thumbs_down", "wrong_citation", "missed_source"]);

/**
 * Pure aggregation helpers — deliberately NOT on SearchFeedbackRepository
 * (W4.2: write path and aggregation query stay decoupled).
 */
export function aggregateDailyFeedback(rows: readonly SearchFeedbackRow[]): FeedbackDailyAggregate[] {
  const byDay = new Map<string, FeedbackDailyAggregate>();
  for (const row of rows) {
    const day = toDayKey(row.createdAt);
    let agg = byDay.get(day);
    if (!agg) {
      agg = {
        day,
        missedSource: 0,
        negativeRate: 0,
        thumbsDown: 0,
        thumbsUp: 0,
        total: 0,
        wrongCitation: 0,
      };
      byDay.set(day, agg);
    }
    agg.total += 1;
    switch (row.type) {
      case "thumbs_up":
        agg.thumbsUp += 1;
        break;
      case "thumbs_down":
        agg.thumbsDown += 1;
        break;
      case "wrong_citation":
        agg.wrongCitation += 1;
        break;
      case "missed_source":
        agg.missedSource += 1;
        break;
      default:
        break;
    }
  }
  for (const agg of byDay.values()) {
    const negative = agg.thumbsDown + agg.wrongCitation + agg.missedSource;
    agg.negativeRate = agg.total === 0 ? 0 : negative / agg.total;
  }
  return [...byDay.values()].toSorted((a, b) => a.day.localeCompare(b.day));
}

export function topBadQueries(rows: readonly SearchFeedbackRow[], limit = 10): TopBadQuery[] {
  const byQuery = new Map<string, { count: number; types: Set<KnowledgeFeedbackType> }>();
  for (const row of rows) {
    if (!NEGATIVE_TYPES.has(row.type)) {
      continue;
    }
    const key = row.query.trim();
    if (!key) {
      continue;
    }
    let entry = byQuery.get(key);
    if (!entry) {
      entry = { count: 0, types: new Set() };
      byQuery.set(key, entry);
    }
    entry.count += 1;
    entry.types.add(row.type);
  }
  return [...byQuery.entries()]
    .map(([query, entry]) => ({
      count: entry.count,
      query,
      types: [...entry.types].toSorted(),
    }))
    .toSorted((a, b) => b.count - a.count || a.query.localeCompare(b.query))
    .slice(0, Math.max(0, limit));
}

/** Consume document_chunk.recall_count for observability dashboards (F-08 / F-02). */
export function mergeRecallObservability(
  hitChunkIds: readonly string[],
  recallByChunkId: ReadonlyMap<string, number>,
): RecallObservabilityItem[] {
  const seen = new Set<string>();
  const out: RecallObservabilityItem[] = [];
  for (const chunkId of hitChunkIds) {
    const id = chunkId.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push({ chunkId: id, recallCount: recallByChunkId.get(id) ?? 0 });
  }
  return out.toSorted((a, b) => b.recallCount - a.recallCount || a.chunkId.localeCompare(b.chunkId));
}

function toDayKey(createdAt: string): string {
  // MySQL DATETIME Shanghai "YYYY-MM-DD HH:mm:ss" or ISO
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(createdAt.trim());
  return m?.[1] ?? createdAt.slice(0, 10);
}

export class SearchFeedbackMetricsQuery {
  public constructor(
    private readonly listRecent: (tenantId: string, sinceDayInclusive: string) => Promise<SearchFeedbackRow[]>,
    private readonly loadRecallCounts: (tenantId: string, chunkIds: string[]) => Promise<Map<string, number>>,
  ) {}

  public async dashboard(
    tenantId: string,
    options?: { days?: number; topBadLimit?: number },
  ): Promise<{
    daily: FeedbackDailyAggregate[];
    recallTop: RecallObservabilityItem[];
    topBadQueries: TopBadQuery[];
  }> {
    const days = options?.days ?? 7;
    const since = daysAgoShanghai(days);
    const rows = await this.listRecent(tenantId, since);
    const daily = aggregateDailyFeedback(rows);
    const bad = topBadQueries(rows, options?.topBadLimit ?? 10);
    const chunkIds = [...new Set(rows.flatMap((row) => row.hitChunkIds))];
    const recallMap = chunkIds.length > 0 ? await this.loadRecallCounts(tenantId, chunkIds) : new Map<string, number>();
    const recallTop = mergeRecallObservability(chunkIds, recallMap).slice(0, 20);
    return { daily, recallTop, topBadQueries: bad };
  }
}

function daysAgoShanghai(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - Math.max(0, days));
  return formatDayShanghai(d);
}

function formatDayShanghai(date: Date): string {
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}
