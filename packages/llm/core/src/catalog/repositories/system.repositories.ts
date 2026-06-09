import {
  type CatalogMysqlPool,
  exec,
  queryRows,
  SYSTEM_AUDIT,
} from './catalog-mysql-pool';
import type {
  MatchRuleRow,
  SystemModelRow,
  SystemProviderRow,
  SystemTypeRow,
} from './row-types';

/** 系统供应商类型字典（ai_system_llm_provider_type）。 */
export class SystemLlmProviderTypeRepository {
  constructor(private readonly pool: CatalogMysqlPool) {}

  async listEnabled(): Promise<SystemTypeRow[]> {
    return queryRows<SystemTypeRow>(
      this.pool,
      `SELECT * FROM ai_system_llm_provider_type WHERE enabled = 1 AND (deleted IS NULL OR deleted = 0) ORDER BY sort_order ASC, code ASC`,
    );
  }

  async findByCode(code: string): Promise<SystemTypeRow | null> {
    const rows = await queryRows<SystemTypeRow>(
      this.pool,
      `SELECT * FROM ai_system_llm_provider_type WHERE code = ? AND (deleted IS NULL OR deleted = 0) LIMIT 1`,
      [code],
    );
    return rows[0] ?? null;
  }

  async upsert(
    row: Pick<SystemTypeRow, 'code' | 'display_name' | 'description' | 'sort_order' | 'enabled'>,
  ): Promise<void> {
    const now = new Date();
    await exec(
      this.pool,
      `INSERT INTO ai_system_llm_provider_type
         (code, display_name, description, sort_order, enabled, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name), description = VALUES(description),
         sort_order = VALUES(sort_order), enabled = VALUES(enabled),
         update_by = VALUES(update_by), update_time = VALUES(update_time), deleted = 0`,
      [
        row.code,
        row.display_name,
        row.description ?? null,
        row.sort_order,
        row.enabled ? 1 : 0,
        SYSTEM_AUDIT.by,
        SYSTEM_AUDIT.id,
        SYSTEM_AUDIT.type,
        now,
        SYSTEM_AUDIT.by,
        SYSTEM_AUDIT.id,
        SYSTEM_AUDIT.type,
        now,
      ],
    );
  }
}

/** 系统供应商目录（ai_system_llm_provider）。 */
export class SystemLlmProviderRepository {
  constructor(private readonly pool: CatalogMysqlPool) {}

  async listActive(): Promise<SystemProviderRow[]> {
    return queryRows<SystemProviderRow>(
      this.pool,
      `SELECT * FROM ai_system_llm_provider WHERE (deleted IS NULL OR deleted = 0) ORDER BY id ASC`,
    );
  }

  async findById(id: string): Promise<SystemProviderRow | null> {
    const rows = await queryRows<SystemProviderRow>(
      this.pool,
      `SELECT * FROM ai_system_llm_provider WHERE id = ? AND (deleted IS NULL OR deleted = 0) LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listByTypeCodes(typeCodes: string[]): Promise<SystemProviderRow[]> {
    if (typeCodes.length === 0) return [];
    const placeholders = typeCodes.map(() => '?').join(', ');
    return queryRows<SystemProviderRow>(
      this.pool,
      `SELECT * FROM ai_system_llm_provider WHERE type_code IN (${placeholders}) AND (deleted IS NULL OR deleted = 0)`,
      typeCodes,
    );
  }

  async upsert(
    row: Pick<SystemProviderRow, 'id' | 'provider_code' | 'type_code' | 'name' | 'icon_url' | 'default_remark'>,
  ): Promise<void> {
    const now = new Date();
    await exec(
      this.pool,
      `INSERT INTO ai_system_llm_provider
         (id, provider_code, type_code, name, icon_url, default_remark, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         type_code = VALUES(type_code), name = VALUES(name), icon_url = VALUES(icon_url),
         default_remark = VALUES(default_remark), update_by = VALUES(update_by),
         update_time = VALUES(update_time), deleted = 0`,
      [
        row.id,
        row.provider_code,
        row.type_code,
        row.name,
        row.icon_url ?? null,
        row.default_remark ?? null,
        SYSTEM_AUDIT.by,
        SYSTEM_AUDIT.id,
        SYSTEM_AUDIT.type,
        now,
        SYSTEM_AUDIT.by,
        SYSTEM_AUDIT.id,
        SYSTEM_AUDIT.type,
        now,
      ],
    );
  }
}

/** 系统模型目录（ai_system_llm_model）。 */
export class SystemLlmModelRepository {
  constructor(private readonly pool: CatalogMysqlPool) {}

  async listActive(): Promise<SystemModelRow[]> {
    return queryRows<SystemModelRow>(
      this.pool,
      `SELECT * FROM ai_system_llm_model WHERE (deleted IS NULL OR deleted = 0) ORDER BY sort_order ASC, id ASC`,
    );
  }

  async listBySystemProvider(systemProviderId: string): Promise<SystemModelRow[]> {
    return queryRows<SystemModelRow>(
      this.pool,
      `SELECT * FROM ai_system_llm_model WHERE system_provider_id = ? AND (deleted IS NULL OR deleted = 0) ORDER BY sort_order ASC, id ASC`,
      [systemProviderId],
    );
  }

  async upsert(row: SystemModelRow): Promise<void> {
    const now = new Date();
    await exec(
      this.pool,
      `INSERT INTO ai_system_llm_model
         (id, system_provider_id, model_code, display_name, group_name, sort_order, icon_url, api_base_url, endpoint_type, model_types, is_free, supports_test, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name), group_name = VALUES(group_name), sort_order = VALUES(sort_order),
         icon_url = VALUES(icon_url), api_base_url = VALUES(api_base_url), endpoint_type = VALUES(endpoint_type),
         model_types = VALUES(model_types), is_free = VALUES(is_free), supports_test = VALUES(supports_test),
         update_by = VALUES(update_by), update_time = VALUES(update_time), deleted = 0`,
      [
        row.id,
        row.system_provider_id,
        row.model_code,
        row.display_name,
        row.group_name,
        row.sort_order,
        row.icon_url ?? null,
        row.api_base_url ?? null,
        row.endpoint_type ?? null,
        row.model_types,
        row.is_free ? 1 : 0,
        row.supports_test ? 1 : 0,
        SYSTEM_AUDIT.by,
        SYSTEM_AUDIT.id,
        SYSTEM_AUDIT.type,
        now,
        SYSTEM_AUDIT.by,
        SYSTEM_AUDIT.id,
        SYSTEM_AUDIT.type,
        now,
      ],
    );
  }
}

/** 系统模型识别规则（ai_system_llm_model_match_rule）。 */
export class SystemLlmModelMatchRuleRepository {
  constructor(private readonly pool: CatalogMysqlPool) {}

  async listActive(): Promise<MatchRuleRow[]> {
    return queryRows<MatchRuleRow>(
      this.pool,
      `SELECT * FROM ai_system_llm_model_match_rule WHERE (deleted IS NULL OR deleted = 0) ORDER BY priority DESC, id ASC`,
    );
  }

  async upsert(row: MatchRuleRow): Promise<void> {
    const now = new Date();
    await exec(
      this.pool,
      `INSERT INTO ai_system_llm_model_match_rule
         (id, provider_type_code, provider_code, match_type, pattern, normalized_name, native_family, display_name_template, group_name, icon_url, api_base_url, endpoint_type, channel_profile, adapter_key, request_schema_json, response_schema_json, dsl_schema_json, model_types, is_free, priority, create_by, creator_id, creator_type, create_time, update_by, updater_id, updater_type, update_time, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         normalized_name = VALUES(normalized_name), native_family = VALUES(native_family),
         display_name_template = VALUES(display_name_template), group_name = VALUES(group_name),
         icon_url = VALUES(icon_url), api_base_url = VALUES(api_base_url), endpoint_type = VALUES(endpoint_type),
         channel_profile = VALUES(channel_profile), adapter_key = VALUES(adapter_key),
         request_schema_json = VALUES(request_schema_json), response_schema_json = VALUES(response_schema_json),
         dsl_schema_json = VALUES(dsl_schema_json), model_types = VALUES(model_types), is_free = VALUES(is_free),
         priority = VALUES(priority), update_by = VALUES(update_by), update_time = VALUES(update_time), deleted = 0`,
      [
        row.id,
        row.provider_type_code ?? null,
        row.provider_code ?? null,
        row.match_type,
        row.pattern,
        row.normalized_name ?? null,
        row.native_family ?? null,
        row.display_name_template ?? null,
        row.group_name ?? null,
        row.icon_url ?? null,
        row.api_base_url ?? null,
        row.endpoint_type ?? null,
        row.channel_profile ?? null,
        row.adapter_key ?? null,
        row.request_schema_json ?? null,
        row.response_schema_json ?? null,
        row.dsl_schema_json ?? null,
        row.model_types,
        row.is_free ? 1 : 0,
        row.priority,
        SYSTEM_AUDIT.by,
        SYSTEM_AUDIT.id,
        SYSTEM_AUDIT.type,
        now,
        SYSTEM_AUDIT.by,
        SYSTEM_AUDIT.id,
        SYSTEM_AUDIT.type,
        now,
      ],
    );
  }
}
