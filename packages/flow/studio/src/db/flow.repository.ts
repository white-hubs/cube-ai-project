import {
  STUDIO_AUDIT,
  StudioRepositoryBase,
  formatMysqlDateTimeShanghai,
  normalizeAudit,
  resolveTenantId,
  rowHelpers,
} from "./mysql-query.service";
import type { FlowStudioFlowRow } from "./rows";

const TABLE = "flow_studio_flow";

function normalizeRow(row: Record<string, unknown>): FlowStudioFlowRow {
  const { normalizeDateValue, strOrNull, boolOrNull } = rowHelpers;
  return {
    ...normalizeAudit(row),
    compile_error: strOrNull(row["compile_error"]),
    compile_revision: String(row["compile_revision"] ?? "0"),
    compile_status: String(row["compile_status"] ?? "draft"),
    compiled_flow_json: strOrNull(row["compiled_flow_json"]),
    component_snapshot_json: strOrNull(row["component_snapshot_json"]),
    create_time: normalizeDateValue(row["create_time"]) ?? "",
    deleted: strOrNull(row["deleted"]),
    description: strOrNull(row["description"]),
    editor_flow_json: String(row["editor_flow_json"] ?? ""),
    enabled: boolOrNull(row["enabled"]),
    id: String(row["id"]),
    last_compiled_time: normalizeDateValue(row["last_compiled_time"]),
    last_synced_time: normalizeDateValue(row["last_synced_time"]),
    name: String(row["name"] ?? ""),
    published_release_id: strOrNull(row["published_release_id"]),
    published_revision: strOrNull(row["published_revision"]),
    remark: strOrNull(row["remark"]),
    remote_binding_status: strOrNull(row["remote_binding_status"]),
    remote_flow_id: strOrNull(row["remote_flow_id"]),
    tenant_id: String(row["tenant_id"] ?? ""),
    update_time: normalizeDateValue(row["update_time"]) ?? "",
  };
}

export type FlowStudioFlowInsert = Omit<
  FlowStudioFlowRow,
  "create_time" | "update_time" | "tenant_id" | keyof ReturnType<typeof normalizeAudit>
> &
  Partial<Pick<FlowStudioFlowRow, "create_by" | "creator_id" | "creator_type" | "update_by" | "updater_id" | "updater_type">> & {
    tenant_id?: string | null;
  };

export class FlowStudioFlowRepository extends StudioRepositoryBase {
  async listByTenantDesc(tenantId?: string | null): Promise<FlowStudioFlowRow[]> {
    const tenant = resolveTenantId(tenantId);
    const rows = await this.q<Record<string, unknown>>(
      `SELECT * FROM ${TABLE} WHERE tenant_id = ? AND (deleted IS NULL OR deleted = 0) ORDER BY create_time DESC, id DESC`,
      [tenant],
    );
    return rows.map((value) => normalizeRow(value));
  }

  async countByTenantKeyword(keywordTrimmed: string, tenantId?: string | null): Promise<number> {
    const tenant = resolveTenantId(tenantId);
    const kw = keywordTrimmed.trim();
    if (!kw) {
      const row = await this.one<{ c: number | string | bigint }>(
        `SELECT COUNT(1) AS c FROM ${TABLE} WHERE tenant_id = ? AND (deleted IS NULL OR deleted = 0)`,
        [tenant],
      );
      return row?.c === null || row?.c === undefined ? 0 : Number(row.c);
    }
    const row = await this.one<{ c: number | string | bigint }>(
      `SELECT COUNT(1) AS c FROM ${TABLE}
       WHERE tenant_id = ? AND (deleted IS NULL OR deleted = 0)
       AND (INSTR(LOWER(name), LOWER(?)) > 0 OR INSTR(LOWER(COALESCE(description, '')), LOWER(?)) > 0)`,
      [tenant, kw, kw],
    );
    return row?.c === null || row?.c === undefined ? 0 : Number(row.c);
  }

  async pageByTenantKeyword(params: {
    keywordTrimmed: string;
    pageNumber: number;
    pageSize: number;
    tenantId?: string | null;
  }): Promise<FlowStudioFlowRow[]> {
    const tenant = resolveTenantId(params.tenantId);
    const kw = params.keywordTrimmed.trim();
    const pageNumber = Math.max(1, Math.floor(params.pageNumber));
    const pageSize = Math.min(200, Math.max(1, Math.floor(params.pageSize)));
    const offset = (pageNumber - 1) * pageSize;
    const limitSql = `${pageSize} OFFSET ${offset}`;
    if (!kw) {
      const rows = await this.q<Record<string, unknown>>(
        `SELECT * FROM ${TABLE} WHERE tenant_id = ? AND (deleted IS NULL OR deleted = 0) ORDER BY create_time DESC, id DESC LIMIT ${limitSql}`,
        [tenant],
      );
      return rows.map((value) => normalizeRow(value));
    }
    const rows = await this.q<Record<string, unknown>>(
      `SELECT * FROM ${TABLE}
       WHERE tenant_id = ? AND (deleted IS NULL OR deleted = 0)
       AND (INSTR(LOWER(name), LOWER(?)) > 0 OR INSTR(LOWER(COALESCE(description, '')), LOWER(?)) > 0)
       ORDER BY create_time DESC, id DESC LIMIT ${limitSql}`,
      [tenant, kw, kw],
    );
    return rows.map((value) => normalizeRow(value));
  }

  async findByIdScoped(id: string, tenantId?: string | null): Promise<FlowStudioFlowRow | null> {
    const tenant = resolveTenantId(tenantId);
    const row = await this.one<Record<string, unknown>>(
      `SELECT * FROM ${TABLE} WHERE id = ? AND tenant_id = ? AND (deleted IS NULL OR deleted = 0) LIMIT 1`,
      [id, tenant],
    );
    return row ? normalizeRow(row) : null;
  }

  async existsNameForTenant(name: string, excludeId?: string | null, tenantId?: string | null): Promise<boolean> {
    const tenant = resolveTenantId(tenantId);
    const params: unknown[] = [tenant, name];
    let sql = `SELECT id FROM ${TABLE} WHERE tenant_id = ? AND name = ? AND (deleted IS NULL OR deleted = 0)`;
    if (excludeId !== null && excludeId !== undefined) {
      sql += " AND id <> ?";
      params.push(excludeId);
    }
    sql += " LIMIT 1";
    const row = await this.one<{ id: string }>(sql, params);
    return row !== null && row !== undefined;
  }

  async insertRow(row: FlowStudioFlowInsert): Promise<void> {
    const now = formatMysqlDateTimeShanghai();
    const tenant = resolveTenantId(row.tenant_id);
    const payload: Record<string, unknown> = {
      ...row,
      create_by: row.create_by ?? STUDIO_AUDIT.by,
      create_time: now,
      creator_id: row.creator_id ?? STUDIO_AUDIT.id,
      creator_type: row.creator_type ?? STUDIO_AUDIT.type,
      tenant_id: tenant,
      update_by: row.update_by ?? STUDIO_AUDIT.by,
      update_time: now,
      updater_id: row.updater_id ?? STUDIO_AUDIT.id,
      updater_type: row.updater_type ?? STUDIO_AUDIT.type,
    };
    const keys = Object.keys(payload);
    await this.exec(
      `INSERT INTO ${TABLE} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
      keys.map((k) => payload[k]),
    );
  }

  async updateRow(id: string, patch: Partial<FlowStudioFlowRow>, tenantId?: string | null): Promise<void> {
    const tenant = resolveTenantId(tenantId);
    const data: Record<string, unknown> = {
      ...patch,
      update_by: patch.update_by ?? STUDIO_AUDIT.by,
      update_time: formatMysqlDateTimeShanghai(),
      updater_id: patch.updater_id ?? STUDIO_AUDIT.id,
      updater_type: patch.updater_type ?? STUDIO_AUDIT.type,
    };
    const keys = Object.keys(data).filter((k) => k !== "id" && k !== "tenant_id");
    if (keys.length === 0) {
      return;
    }
    await this.exec(
      `UPDATE ${TABLE} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND tenant_id = ? AND (deleted IS NULL OR deleted = 0)`,
      [...keys.map((k) => data[k]), id, tenant],
    );
  }

  async logicalDelete(id: string, tenantId?: string | null): Promise<void> {
    const tenant = resolveTenantId(tenantId);
    await this.exec(
      `UPDATE ${TABLE}
       SET deleted = ?, update_by = ?, updater_id = ?, updater_type = ?, update_time = ?
       WHERE id = ? AND tenant_id = ? AND (deleted IS NULL OR deleted = 0)`,
      [id, STUDIO_AUDIT.by, STUDIO_AUDIT.id, STUDIO_AUDIT.type, formatMysqlDateTimeShanghai(), id, tenant],
    );
  }
}
