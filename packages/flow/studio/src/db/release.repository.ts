import {
  STUDIO_AUDIT,
  StudioRepositoryBase,
  formatMysqlDateTimeShanghai,
  type normalizeAudit,
  resolveTenantId,
} from "./mysql-query.service";
import { type FlowStudioReleaseRow } from "./rows";

const TABLE = "flow_studio_release";

export type FlowStudioReleaseInsert = Omit<
  FlowStudioReleaseRow,
  "create_time" | "update_time" | "tenant_id" | keyof ReturnType<typeof normalizeAudit>
> &
  Partial<Pick<FlowStudioReleaseRow, "create_by" | "creator_id" | "creator_type" | "update_by" | "updater_id" | "updater_type">> & {
    tenant_id?: string | null;
  };

export class FlowStudioReleaseRepository extends StudioRepositoryBase {
  /** Soft-delete all currently-active releases of a flow (deleted = id), keeping only the newest publish. */
  async softDeleteActiveReleasesForFlow(flowId: string, tenantId?: string | null): Promise<void> {
    const tenant = resolveTenantId(tenantId);
    await this.exec(
      `UPDATE ${TABLE}
       SET deleted = id, update_by = ?, updater_id = ?, updater_type = ?, update_time = ?
       WHERE tenant_id = ? AND flow_id = ? AND (deleted IS NULL OR deleted = 0)`,
      [STUDIO_AUDIT.by, STUDIO_AUDIT.id, STUDIO_AUDIT.type, formatMysqlDateTimeShanghai(), tenant, flowId],
    );
  }

  async getNextReleaseVersion(flowId: string, tenantId?: string | null): Promise<string> {
    const tenant = resolveTenantId(tenantId);
    const row = await this.one<{ max_version: string | number | bigint | null }>(
      `SELECT MAX(release_version) AS max_version FROM ${TABLE} WHERE tenant_id = ? AND flow_id = ? AND (deleted IS NULL OR deleted = 0)`,
      [tenant, flowId],
    );
    const raw = row?.max_version;
    if (raw === null || raw === undefined) {
      return "1";
    }
    return (BigInt(String(raw)) + 1n).toString();
  }

  async insertRow(row: FlowStudioReleaseInsert): Promise<void> {
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
