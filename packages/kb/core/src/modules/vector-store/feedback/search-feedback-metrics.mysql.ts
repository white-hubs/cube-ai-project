import { DatabaseService, Inject, Injectable } from "@dangao/bun-server";

import type { KnowledgeFeedbackType } from "@cube-ai/contracts/platform";

import { formatMysqlDateTimeShanghai } from "../../common/mysql-datetime";
import { SearchFeedbackMetricsQuery } from "./search-feedback-metrics";
import type { SearchFeedbackRow } from "./search-feedback.types";

type SqlRow = Record<string, unknown>;

/**
 * MySQL-backed aggregation loader — separate from SearchFeedbackRepositoryOrm (write/read-by-trace).
 */
@Injectable()
export class SearchFeedbackMetricsMysql {
  public constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  public createQuery(): SearchFeedbackMetricsQuery {
    return new SearchFeedbackMetricsQuery(
      (tenantId, sinceDay) => this.listRecent(tenantId, sinceDay),
      (tenantId, chunkIds) => this.loadRecallCounts(tenantId, chunkIds),
    );
  }

  public async listRecent(tenantId: string, sinceDayInclusive: string): Promise<SearchFeedbackRow[]> {
    const sql = `SELECT id, tenant_id, trace_id, feedback_type, query, hit_chunk_ids_json, comment, create_time
      FROM search_feedback
      WHERE tenant_id = ? AND create_time >= ?
      ORDER BY create_time ASC`;
    const rows = await this.query(sql, [tenantId, `${sinceDayInclusive} 00:00:00`]);
    return rows.map((row) => mapFeedbackRow(row));
  }

  public async loadRecallCounts(tenantId: string, chunkIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (chunkIds.length === 0) {
      return out;
    }
    const placeholders = chunkIds.map(() => "?").join(", ");
    const sql = `SELECT chunk_id, recall_count FROM document_chunk
      WHERE tenant_id = ? AND chunk_id IN (${placeholders}) AND (deleted IS NULL OR deleted = 0)`;
    const rows = await this.query(sql, [tenantId, ...chunkIds]);
    for (const row of rows) {
      const chunkId = String(row.chunk_id);
      const recall = Number(row.recall_count ?? 0);
      out.set(chunkId, Number.isFinite(recall) ? recall : 0);
    }
    return out;
  }

  private async query(sql: string, params: unknown[]): Promise<SqlRow[]> {
    const result = await (
      this.databaseService as DatabaseService & {
        query: (sql: string, params?: unknown[]) => Promise<unknown> | unknown;
      }
    ).query(sql, params);
    return Array.isArray(result) ? (result as SqlRow[]) : [];
  }
}

function mapFeedbackRow(row: SqlRow): SearchFeedbackRow {
  const comment = row.comment == null || row.comment === "" ? undefined : String(row.comment);
  const createTime = row.create_time;
  const createdAt =
    typeof createTime === "string"
      ? createTime
      : createTime instanceof Date
        ? formatMysqlDateTimeShanghai(createTime)
        : String(createTime ?? "");
  return {
    ...(comment !== undefined ? { comment } : {}),
    createdAt,
    hitChunkIds: parseHitChunkIds(row.hit_chunk_ids_json),
    id: String(row.id),
    query: String(row.query ?? ""),
    tenantId: String(row.tenant_id),
    traceId: String(row.trace_id),
    type: row.feedback_type as KnowledgeFeedbackType,
  };
}

function parseHitChunkIds(raw: unknown): string[] {
  if (raw == null) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  } catch {
    return [];
  }
}
