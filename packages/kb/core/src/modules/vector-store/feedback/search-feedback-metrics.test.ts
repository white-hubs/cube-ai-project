import { describe, expect, test } from "bun:test";

import { aggregateDailyFeedback, mergeRecallObservability, SearchFeedbackMetricsQuery, topBadQueries } from "./search-feedback-metrics";
import type { SearchFeedbackRow } from "./search-feedback.types";

function row(partial: Partial<SearchFeedbackRow> & Pick<SearchFeedbackRow, "type" | "query" | "createdAt">): SearchFeedbackRow {
  return {
    hitChunkIds: partial.hitChunkIds ?? [],
    id: partial.id ?? "1",
    tenantId: partial.tenantId ?? "t1",
    traceId: partial.traceId ?? "tr",
    ...partial,
  };
}

describe("search-feedback-metrics (W4.2 write/agg decoupling)", () => {
  test("aggregateDailyFeedback computes rates by day", () => {
    const daily = aggregateDailyFeedback([
      row({ createdAt: "2026-08-06 10:00:00", query: "a", type: "thumbs_up" }),
      row({ createdAt: "2026-08-06 11:00:00", query: "b", type: "thumbs_down" }),
      row({ createdAt: "2026-08-07 09:00:00", query: "c", type: "missed_source" }),
    ]);
    expect(daily).toHaveLength(2);
    expect(daily[0]).toMatchObject({ day: "2026-08-06", negativeRate: 0.5, thumbsDown: 1, thumbsUp: 1, total: 2 });
    expect(daily[1]).toMatchObject({ day: "2026-08-07", missedSource: 1, negativeRate: 1, total: 1 });
  });

  test("topBadQueries ranks negatives and ignores thumbs_up", () => {
    const top = topBadQueries(
      [
        row({ createdAt: "2026-08-07 01:00:00", query: "消防", type: "thumbs_down" }),
        row({ createdAt: "2026-08-07 02:00:00", query: "消防", type: "wrong_citation" }),
        row({ createdAt: "2026-08-07 03:00:00", query: "条款", type: "missed_source" }),
        row({ createdAt: "2026-08-07 04:00:00", query: "消防", type: "thumbs_up" }),
      ],
      5,
    );
    expect(top[0]).toMatchObject({ count: 2, query: "消防" });
    expect(top[0]?.types).toEqual(["thumbs_down", "wrong_citation"]);
    expect(top[1]?.query).toBe("条款");
  });

  test("mergeRecallObservability consumes recall_count map", () => {
    const items = mergeRecallObservability(
      ["c2", "c1", "c2"],
      new Map([
        ["c1", 3],
        ["c2", 10],
      ]),
    );
    expect(items).toEqual([
      { chunkId: "c2", recallCount: 10 },
      { chunkId: "c1", recallCount: 3 },
    ]);
  });

  test("SearchFeedbackMetricsQuery dashboard uses listRecent + recall loader (not write repo)", async () => {
    const query = new SearchFeedbackMetricsQuery(
      async () => [
        row({
          createdAt: "2026-08-07 01:00:00",
          hitChunkIds: ["chunk-a"],
          query: "坏查询",
          type: "thumbs_down",
        }),
      ],
      async (_tenant, chunkIds) => new Map(chunkIds.map((id) => [id, 7])),
    );
    const dash = await query.dashboard("t1", { days: 7, topBadLimit: 3 });
    expect(dash.topBadQueries[0]?.query).toBe("坏查询");
    expect(dash.recallTop[0]).toEqual({ chunkId: "chunk-a", recallCount: 7 });
    expect(dash.daily[0]?.thumbsDown).toBe(1);
  });
});
