import {
  STUDIO_AUDIT,
  StudioRepositoryBase,
  StudioTenantError,
  formatMysqlDateTimeShanghai,
  normalizeAudit,
  resolveTenantId,
  rowHelpers,
} from "./mysql-query.service";
import type { FlowStudioResourceRefRow } from "./rows";

const TABLE = "flow_studio_resource_ref";

function normalizeRow(row: Record<string, unknown>): FlowStudioResourceRefRow {
  const { strOrNull, boolOrNull, normalizeDateValue } = rowHelpers;
  return {
    ...normalizeAudit(row),
    component_key: String(row["component_key"] ?? ""),
    create_time: normalizeDateValue(row["create_time"]) ?? "",
    deleted: strOrNull(row["deleted"]),
    flow_id: String(row["flow_id"] ?? ""),
    id: String(row["id"]),
    invalid: boolOrNull(row["invalid"]) ?? false,
    invalid_reason: strOrNull(row["invalid_reason"]),
    node_id: String(row["node_id"] ?? ""),
    remark: strOrNull(row["remark"]),
    required: boolOrNull(row["required"]) ?? true,
    resource_id: String(row["resource_id"] ?? ""),
    resource_name_snapshot: strOrNull(row["resource_name_snapshot"]),
    resource_status_snapshot: strOrNull(row["resource_status_snapshot"]),
    resource_sub_id: strOrNull(row["resource_sub_id"]),
    resource_type: String(row["resource_type"] ?? ""),
    tenant_id: String(row["tenant_id"] ?? ""),
    update_time: normalizeDateValue(row["update_time"]) ?? "",
  };
}

export type FlowStudioResourceRefInsert = Omit<
  FlowStudioResourceRefRow,
  "create_time" | "update_time" | "tenant_id" | keyof ReturnType<typeof normalizeAudit>
> &
  Partial<Pick<FlowStudioResourceRefRow, "create_by" | "creator_id" | "creator_type" | "update_by" | "updater_id" | "updater_type">> & {
    tenant_id?: string | null;
  };

export class FlowStudioResourceRefRepository extends StudioRepositoryBase {
  async listByFlowId(flowId: string, tenantId?: string | null): Promise<FlowStudioResourceRefRow[]> {
    const tenant = resolveTenantId(tenantId);
    const rows = await this.q<Record<string, unknown>>(
      `SELECT * FROM ${TABLE} WHERE tenant_id = ? AND flow_id = ? AND (deleted IS NULL OR deleted = 0) ORDER BY id ASC`,
      [tenant, flowId],
    );
    return rows.map((value) => normalizeRow(value));
  }

  async listByResource(resourceType: string, resourceId: string, tenantId?: string | null): Promise<FlowStudioResourceRefRow[]> {
    const tenant = resolveTenantId(tenantId);
    const rows = await this.q<Record<string, unknown>>(
      `SELECT * FROM ${TABLE} WHERE tenant_id = ? AND resource_type = ? AND resource_id = ? AND (deleted IS NULL OR deleted = 0) ORDER BY update_time DESC`,
      [tenant, resourceType, resourceId],
    );
    return rows.map((value) => normalizeRow(value));
  }

  /**
   * Replace all resource refs for a flow: hard-delete existing rows (tenant + flow scoped),
   * then insert the new set. Dedupes by (node_id, resource_type, resource_id).
   */
  async replaceForFlow(flowId: string, refs: FlowStudioResourceRefInsert[], tenantId?: string | null): Promise<void> {
    const tenant = resolveTenantId(tenantId);
    const now = formatMysqlDateTimeShanghai();
    const flowIdNorm = String(flowId ?? "").trim();
    if (!/^\d+$/u.test(flowIdNorm)) {
      throw new StudioTenantError("flowId 非法");
    }
    await this.exec(`DELETE FROM ${TABLE} WHERE tenant_id = ? AND flow_id = ?`, [tenant, flowIdNorm]);
    const seen = new Set<string>();
    for (const row of refs) {
      const uk = [String(row.node_id ?? "").trim(), String(row.resource_type ?? "").trim(), String(row.resource_id ?? "").trim()].join(
        "::",
      );
      if (uk === "::::" || uk === "::" || seen.has(uk)) {
        continue;
      }
      seen.add(uk);
      const payload: Record<string, unknown> = {
        ...row,
        create_by: row.create_by ?? STUDIO_AUDIT.by,
        create_time: now,
        creator_id: row.creator_id ?? STUDIO_AUDIT.id,
        creator_type: row.creator_type ?? STUDIO_AUDIT.type,
        flow_id: flowId,
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
}
