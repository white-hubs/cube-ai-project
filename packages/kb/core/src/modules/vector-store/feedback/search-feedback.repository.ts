import { BaseRepository, DatabaseService, Inject, Injectable, LOGGER_TOKEN, type Logger, Repository } from "@dangao/bun-server";

import type { KnowledgeFeedbackType } from "@cube-ai/contracts/platform";

import { formatMysqlDateTimeShanghai } from "../../common/mysql-datetime";
import type { SearchFeedbackInsert, SearchFeedbackRepository, SearchFeedbackRow } from "./search-feedback.types";
import { generateKbRecordId } from "@/infrastructure/kb-record-id";

export interface SearchFeedbackEntity {
  comment: string | null;
  create_by: string;
  create_time: Date | string;
  creator_id: string | null;
  feedback_type: string;
  hit_chunk_ids_json: string | null;
  id: string;
  query: string;
  tenant_id: string;
  trace_id: string;
}

@Repository("search_feedback", "id")
@Injectable()
export class SearchFeedbackRepositoryOrm extends BaseRepository<SearchFeedbackEntity> implements SearchFeedbackRepository {
  protected override tableName = "search_feedback";
  protected override primaryKey = "id";

  public constructor(
    protected override readonly databaseService: DatabaseService,
    @Inject(LOGGER_TOKEN) private readonly logger: Logger,
  ) {
    super(databaseService);
  }

  public async insert(input: SearchFeedbackInsert): Promise<SearchFeedbackRow> {
    const id = generateKbRecordId();
    const createTime = formatMysqlDateTimeShanghai();
    const hitJson = JSON.stringify(input.hitChunkIds);
    const sql = `INSERT INTO ${this.tableName}
      (id, tenant_id, trace_id, feedback_type, query, hit_chunk_ids_json, comment, create_by, creator_id, create_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      id,
      input.tenantId,
      input.traceId,
      input.type,
      input.query,
      hitJson,
      input.comment ?? null,
      "system",
      input.subjectId ?? null,
      createTime,
    ];
    this.logger.info(`Creating search_feedback id=${id} traceId=${input.traceId} type=${input.type}`);
    await this.executeQuery(sql, params);
    return {
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
      createdAt: createTime,
      hitChunkIds: [...input.hitChunkIds],
      id,
      query: input.query,
      tenantId: input.tenantId,
      traceId: input.traceId,
      type: input.type,
    };
  }

  public async findByTraceId(tenantId: string, traceId: string): Promise<SearchFeedbackRow[]> {
    const sql = `SELECT * FROM ${this.tableName} WHERE tenant_id = ? AND trace_id = ? ORDER BY create_time ASC, id ASC`;
    const result = await this.executeQuery<SearchFeedbackEntity>(sql, [tenantId, traceId]);
    const rows = Array.isArray(result) ? result : [];
    return rows.map((row) => mapEntityToRow(row));
  }
}

function mapEntityToRow(entity: SearchFeedbackEntity): SearchFeedbackRow {
  const type = entity.feedback_type as KnowledgeFeedbackType;
  const hitChunkIds = parseHitChunkIds(entity.hit_chunk_ids_json);
  const createdAt = typeof entity.create_time === "string" ? entity.create_time : formatMysqlDateTimeShanghai(entity.create_time);
  return {
    ...(entity.comment ? { comment: entity.comment } : {}),
    createdAt,
    hitChunkIds,
    id: entity.id,
    query: entity.query,
    tenantId: entity.tenant_id,
    traceId: entity.trace_id,
    type,
  };
}

function parseHitChunkIds(raw: string | null): string[] {
  if (!raw) {
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
