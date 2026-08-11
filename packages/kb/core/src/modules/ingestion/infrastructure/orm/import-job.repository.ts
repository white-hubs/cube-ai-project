import { BaseRepository, DatabaseService, Inject, Injectable, LOGGER_TOKEN, type Logger, Repository } from "@dangao/bun-server";

import { currentTenantId, isGlobalAccessEnabled } from "@cube-ai/tenant-context";

import { formatMysqlDateTimeShanghai } from "../../../common/mysql-datetime";
import { type ImportJobEntity } from "./import-job.entity";
import { resolveKbRecordId } from "@/infrastructure/kb-record-id";

@Repository("document_import_job", "id")
@Injectable()
export class ImportJobRepositoryOrm extends BaseRepository<ImportJobEntity> {
  protected override tableName = "document_import_job";
  protected override primaryKey = "id";

  public constructor(
    protected override readonly databaseService: DatabaseService,
    @Inject(LOGGER_TOKEN) private readonly logger: Logger,
  ) {
    super(databaseService);
  }

  private getTenantId(): string | null {
    if (isGlobalAccessEnabled()) {
      return null;
    }
    return currentTenantId();
  }

  private scopeFilter(): { sql: string; params: unknown[] } {
    const pid = this.getTenantId();
    if (pid) {
      return { sql: "tenant_id = ?", params: [pid] };
    }
    return { params: [], sql: "" };
  }

  private getAuditInfo(): { by: string; id: string | null; type: string | null } {
    return { by: "system", id: null, type: null };
  }

  public async createJob(data: Partial<ImportJobEntity>): Promise<ImportJobEntity> {
    const tenant_id = this.getTenantId();
    const audit = this.getAuditInfo();
    const now = formatMysqlDateTimeShanghai();

    const payload: Partial<ImportJobEntity> = {
      ...data,
      create_by: audit.by,
      create_time: now as unknown as Date,
      creator_id: audit.id,
      creator_type: audit.type,
      deleted: 0n,
      id: resolveKbRecordId(data.id),
      tenant_id,
      update_by: audit.by,
      update_time: now as unknown as Date,
      updater_id: audit.id,
      updater_type: audit.type,
    };

    const keys = Object.keys(payload) as (keyof ImportJobEntity)[];
    const values = keys.map((key) => payload[key]);
    const placeholders = keys.map(() => "?").join(", ");
    const sql = `INSERT INTO ${this.tableName} (${keys.join(", ")}) VALUES (${placeholders})`;
    this.logger.info(`Creating import job for document: ${String(payload.document_id ?? "")}`);
    await this.executeQuery(sql, values);
    return (await this.findById(payload.id!)) as ImportJobEntity;
  }

  public override async findById(id: string | number): Promise<ImportJobEntity | null> {
    const sc = this.scopeFilter();
    const params: unknown[] = [id, ...sc.params];
    let sql = `SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = ? AND (deleted IS NULL OR deleted = 0)`;
    if (sc.sql) {
      sql += ` AND ${sc.sql}`;
    }
    const result = await this.executeQuery<ImportJobEntity>(sql, params);
    return Array.isArray(result) && result[0] ? (result[0] as ImportJobEntity) : null;
  }

  public override async update(id: string | number, data: Partial<ImportJobEntity>): Promise<ImportJobEntity> {
    const sc = this.scopeFilter();
    const audit = this.getAuditInfo();
    const patch: Partial<ImportJobEntity> = {
      ...data,
      update_by: audit.by,
      update_time: formatMysqlDateTimeShanghai() as unknown as Date,
      updater_id: audit.id,
      updater_type: audit.type,
    };
    const keys = Object.keys(patch);
    const values = Object.values(patch);
    const params: unknown[] = [...values, id, ...sc.params];
    let sql = `UPDATE ${this.tableName} SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE ${this.primaryKey} = ? AND (deleted IS NULL OR deleted = 0)`;
    if (sc.sql) {
      sql += ` AND ${sc.sql}`;
    }
    await this.executeQuery(sql, params);
    return (await this.findById(id)) as ImportJobEntity;
  }

  /**
   * Pending/processing rows left after an outbox/worker interruption.
   * Ordered oldest-first so recovery matches the original schedule order.
   */
  public async listRecoverableJobs(limit = 200): Promise<ImportJobEntity[]> {
    return this.listRecoverableJobsPage({ limit });
  }

  /** Keyset-paged recovery scan; avoids the startup-only first-200 loss window. */
  public async listRecoverableJobsPage(params: { limit?: number; after?: { createTime: Date; id: string } }): Promise<ImportJobEntity[]> {
    const sc = this.scopeFilter();
    const limit = params.limit ?? 200;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 1000) : 200;
    const queryParams: unknown[] = [];
    let sql = `SELECT * FROM ${this.tableName}
      WHERE (deleted IS NULL OR deleted = 0)
        AND status IN ('pending', 'processing')`;
    if (params.after) {
      sql += " AND (create_time > ? OR (create_time = ? AND id > ?))";
      queryParams.push(params.after.createTime, params.after.createTime, params.after.id);
    }
    if (sc.sql) {
      sql += ` AND ${sc.sql}`;
      queryParams.push(...sc.params);
    }
    sql += ` ORDER BY create_time ASC, id ASC LIMIT ?`;
    queryParams.push(safeLimit);
    const result = await this.executeQuery<ImportJobEntity>(sql, queryParams);
    return Array.isArray(result) ? result : [];
  }
}
