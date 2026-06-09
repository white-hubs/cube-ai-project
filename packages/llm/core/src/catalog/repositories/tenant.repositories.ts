import {
  type CatalogMysqlPool,
  exec,
  queryRows,
  SYSTEM_AUDIT,
  sqlParams,
} from './catalog-mysql-pool';
import type { TenantModelRow, TenantProviderRow } from './row-types';

export type TenantProviderInsert = Omit<TenantProviderRow, 'tenant'>;
export type TenantModelInsert = Omit<TenantModelRow, 'tenant'>;

type TenantResolver = () => number;

function buildInsert(
  table: string,
  payload: Record<string, unknown>,
): { sql: string; values: unknown[] } {
  const keys = Object.keys(payload);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return { sql, values: sqlParams(keys.map((k) => payload[k])) };
}

/** 租户供应商配置（ai_application_tenant_llm_provider）。 */
export class TenantLlmProviderRepository {
  constructor(
    private readonly pool: CatalogMysqlPool,
    private readonly getTenant: TenantResolver,
  ) {}

  async listByTenant(): Promise<TenantProviderRow[]> {
    return queryRows<TenantProviderRow>(
      this.pool,
      `SELECT * FROM ai_application_tenant_llm_provider WHERE tenant = ? AND (deleted IS NULL OR deleted = 0) ORDER BY id DESC`,
      [this.getTenant()],
    );
  }

  async findByIdForTenant(id: string): Promise<TenantProviderRow | null> {
    const rows = await queryRows<TenantProviderRow>(
      this.pool,
      `SELECT * FROM ai_application_tenant_llm_provider WHERE id = ? AND tenant = ? AND (deleted IS NULL OR deleted = 0) LIMIT 1`,
      [id, this.getTenant()],
    );
    return rows[0] ?? null;
  }

  async findBySystemProviderId(systemProviderId: string): Promise<TenantProviderRow | null> {
    const rows = await queryRows<TenantProviderRow>(
      this.pool,
      `SELECT * FROM ai_application_tenant_llm_provider WHERE tenant = ? AND system_provider_id = ? AND (deleted IS NULL OR deleted = 0) LIMIT 1`,
      [this.getTenant(), systemProviderId],
    );
    return rows[0] ?? null;
  }

  async insertRow(row: TenantProviderInsert): Promise<void> {
    const now = new Date();
    const payload: Record<string, unknown> = {
      ...row,
      tenant: this.getTenant(),
      deleted: '0',
      create_by: SYSTEM_AUDIT.by,
      creator_id: SYSTEM_AUDIT.id,
      creator_type: SYSTEM_AUDIT.type,
      create_time: now,
      update_by: SYSTEM_AUDIT.by,
      updater_id: SYSTEM_AUDIT.id,
      updater_type: SYSTEM_AUDIT.type,
      update_time: now,
    };
    const { sql, values } = buildInsert('ai_application_tenant_llm_provider', payload);
    await exec(this.pool, sql, values);
  }

  async updateRow(id: string, patch: Partial<TenantProviderRow>): Promise<void> {
    const tenant = this.getTenant();
    const data: Record<string, unknown> = {
      ...patch,
      update_by: SYSTEM_AUDIT.by,
      updater_id: SYSTEM_AUDIT.id,
      updater_type: SYSTEM_AUDIT.type,
      update_time: new Date(),
    };
    delete data.id;
    delete data.tenant;
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    if (keys.length === 0) return;
    const sql = `UPDATE ai_application_tenant_llm_provider SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND tenant = ? AND (deleted IS NULL OR deleted = 0)`;
    await exec(this.pool, sql, [...sqlParams(keys.map((k) => data[k])), id, tenant]);
  }

  async logicalDelete(id: string): Promise<void> {
    await exec(
      this.pool,
      `UPDATE ai_application_tenant_llm_provider SET deleted = ?, update_by = ?, updater_id = ?, updater_type = ?, update_time = ? WHERE id = ? AND tenant = ? AND (deleted IS NULL OR deleted = 0)`,
      [String(Date.now()), SYSTEM_AUDIT.by, SYSTEM_AUDIT.id, SYSTEM_AUDIT.type, new Date(), id, this.getTenant()],
    );
  }
}

/** 租户模型（ai_application_tenant_llm_model）。 */
export class TenantLlmModelRepository {
  constructor(
    private readonly pool: CatalogMysqlPool,
    private readonly getTenant: TenantResolver,
  ) {}

  async listByProvider(tenantProviderId: string): Promise<TenantModelRow[]> {
    return queryRows<TenantModelRow>(
      this.pool,
      `SELECT * FROM ai_application_tenant_llm_model WHERE tenant_provider_id = ? AND tenant = ? AND (deleted IS NULL OR deleted = 0) ORDER BY sort_order ASC, id ASC`,
      [tenantProviderId, this.getTenant()],
    );
  }

  async findByIdForTenant(id: string): Promise<TenantModelRow | null> {
    const rows = await queryRows<TenantModelRow>(
      this.pool,
      `SELECT * FROM ai_application_tenant_llm_model WHERE id = ? AND tenant = ? AND (deleted IS NULL OR deleted = 0) LIMIT 1`,
      [id, this.getTenant()],
    );
    return rows[0] ?? null;
  }

  async findByProviderAndCode(tenantProviderId: string, modelCode: string): Promise<TenantModelRow | null> {
    const rows = await queryRows<TenantModelRow>(
      this.pool,
      `SELECT * FROM ai_application_tenant_llm_model WHERE tenant_provider_id = ? AND model_code = ? AND tenant = ? AND (deleted IS NULL OR deleted = 0) LIMIT 1`,
      [tenantProviderId, modelCode, this.getTenant()],
    );
    return rows[0] ?? null;
  }

  /** 按 model_code 在租户内取首个（用于 LlmCatalogPort.resolveModelRuntime，无 providerId 入参）。 */
  async findByCodeForTenant(modelCode: string): Promise<TenantModelRow | null> {
    const rows = await queryRows<TenantModelRow>(
      this.pool,
      `SELECT * FROM ai_application_tenant_llm_model WHERE model_code = ? AND tenant = ? AND (deleted IS NULL OR deleted = 0) ORDER BY id ASC LIMIT 1`,
      [modelCode, this.getTenant()],
    );
    return rows[0] ?? null;
  }

  async insertRow(row: TenantModelInsert): Promise<void> {
    const now = new Date();
    const payload: Record<string, unknown> = {
      ...row,
      tenant: this.getTenant(),
      deleted: '0',
      create_by: SYSTEM_AUDIT.by,
      creator_id: SYSTEM_AUDIT.id,
      creator_type: SYSTEM_AUDIT.type,
      create_time: now,
      update_by: SYSTEM_AUDIT.by,
      updater_id: SYSTEM_AUDIT.id,
      updater_type: SYSTEM_AUDIT.type,
      update_time: now,
    };
    const { sql, values } = buildInsert('ai_application_tenant_llm_model', payload);
    await exec(this.pool, sql, values);
  }

  async updateRow(id: string, patch: Partial<TenantModelRow>): Promise<void> {
    const tenant = this.getTenant();
    const data: Record<string, unknown> = {
      ...patch,
      update_by: SYSTEM_AUDIT.by,
      updater_id: SYSTEM_AUDIT.id,
      updater_type: SYSTEM_AUDIT.type,
      update_time: new Date(),
    };
    delete data.id;
    delete data.tenant;
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    if (keys.length === 0) return;
    const sql = `UPDATE ai_application_tenant_llm_model SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND tenant = ? AND (deleted IS NULL OR deleted = 0)`;
    await exec(this.pool, sql, [...sqlParams(keys.map((k) => data[k])), id, tenant]);
  }

  async logicalDelete(id: string): Promise<void> {
    await exec(
      this.pool,
      `UPDATE ai_application_tenant_llm_model SET deleted = ?, update_by = ?, updater_id = ?, updater_type = ?, update_time = ? WHERE id = ? AND tenant = ? AND (deleted IS NULL OR deleted = 0)`,
      [String(Date.now()), SYSTEM_AUDIT.by, SYSTEM_AUDIT.id, SYSTEM_AUDIT.type, new Date(), id, this.getTenant()],
    );
  }
}
