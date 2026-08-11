import { formatMysqlDateTimeShanghai } from "../../common/mysql-datetime";
import type { SearchFeedbackInsert, SearchFeedbackRepository, SearchFeedbackRow } from "./search-feedback.types";
import { generateKbRecordId } from "@/infrastructure/kb-record-id";

/** Test / local seam implementing the shared write repository. */
export class InMemorySearchFeedbackRepository implements SearchFeedbackRepository {
  private readonly rows: SearchFeedbackRow[] = [];

  public async insert(input: SearchFeedbackInsert): Promise<SearchFeedbackRow> {
    const row: SearchFeedbackRow = {
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
      createdAt: formatMysqlDateTimeShanghai(),
      hitChunkIds: [...input.hitChunkIds],
      id: generateKbRecordId(),
      query: input.query,
      tenantId: input.tenantId,
      traceId: input.traceId,
      type: input.type,
    };
    this.rows.push(row);
    return { ...row, hitChunkIds: [...row.hitChunkIds] };
  }

  public async findByTraceId(tenantId: string, traceId: string): Promise<SearchFeedbackRow[]> {
    return this.rows
      .filter((row) => row.tenantId === tenantId && row.traceId === traceId)
      .map((row) => ({ ...row, hitChunkIds: [...row.hitChunkIds] }));
  }

  /** Test helper */
  public all(): SearchFeedbackRow[] {
    return this.rows.map((row) => ({ ...row, hitChunkIds: [...row.hitChunkIds] }));
  }
}
