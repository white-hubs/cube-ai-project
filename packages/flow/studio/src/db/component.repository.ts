import {
  STUDIO_AUDIT,
  StudioRepositoryBase,
  formatMysqlDateTimeShanghai,
  normalizeAudit,
  resolveTenantId,
  rowHelpers,
} from "./mysql-query.service";
import type { FlowStudioComponentRow } from "./rows";

const TABLE = "flow_studio_component";

function normalizeRow(row: Record<string, unknown>): FlowStudioComponentRow {
  const { strOrNull, boolOrNull, normalizeDateValue } = rowHelpers;
  return {
    ...normalizeAudit(row),
    component_group: strOrNull(row["component_group"]),
    component_key: String(row["component_key"] ?? ""),
    component_name: String(row["component_name"] ?? ""),
    component_type: String(row["component_type"] ?? ""),
    component_version: String(row["component_version"] ?? ""),
    create_time: normalizeDateValue(row["create_time"]) ?? "",
    deleted: strOrNull(row["deleted"]),
    enabled: boolOrNull(row["enabled"]) ?? true,
    execution_policy_json: strOrNull(row["execution_policy_json"]),
    icon_url: strOrNull(row["icon_url"]),
    id: String(row["id"]),
    is_builtin: boolOrNull(row["is_builtin"]) ?? false,
    mapping_target: strOrNull(row["mapping_target"]),
    mapping_template_json: strOrNull(row["mapping_template_json"]),
    mapping_type: String(row["mapping_type"] ?? ""),
    presentation_schema_json: strOrNull(row["presentation_schema_json"]),
    protocol_schema_json: strOrNull(row["protocol_schema_json"]),
    remark: strOrNull(row["remark"]),
    remote_component_id: strOrNull(row["remote_component_id"]),
    sort_order: String(row["sort_order"] ?? "0"),
    tenant_id: String(row["tenant_id"] ?? ""),
    update_time: normalizeDateValue(row["update_time"]) ?? "",
  };
}

export type FlowStudioComponentInsert = Omit<
  FlowStudioComponentRow,
  "create_time" | "update_time" | "tenant_id" | keyof ReturnType<typeof normalizeAudit>
> &
  Partial<Pick<FlowStudioComponentRow, "create_by" | "creator_id" | "creator_type" | "update_by" | "updater_id" | "updater_type">> & {
    tenant_id?: string | null;
  };

export class FlowStudioComponentRepository extends StudioRepositoryBase {
  async listEnabledByTenant(tenantId?: string | null): Promise<FlowStudioComponentRow[]> {
    const tenant = resolveTenantId(tenantId);
    const rows = await this.q<Record<string, unknown>>(
      `SELECT * FROM ${TABLE} WHERE tenant_id = ? AND enabled = 1 AND (deleted IS NULL OR deleted = 0) ORDER BY sort_order ASC, id ASC`,
      [tenant],
    );
    return rows.map((value) => normalizeRow(value));
  }

  async findByKeys(componentKeys: string[], tenantId?: string | null): Promise<FlowStudioComponentRow[]> {
    if (componentKeys.length === 0) {
      return [];
    }
    const tenant = resolveTenantId(tenantId);
    const placeholders = componentKeys.map(() => "?").join(", ");
    const rows = await this.q<Record<string, unknown>>(
      `SELECT * FROM ${TABLE} WHERE tenant_id = ? AND component_key IN (${placeholders}) AND (deleted IS NULL OR deleted = 0)`,
      [tenant, ...componentKeys],
    );
    return rows.map((value) => normalizeRow(value));
  }

  async insertRow(row: FlowStudioComponentInsert): Promise<void> {
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
}
