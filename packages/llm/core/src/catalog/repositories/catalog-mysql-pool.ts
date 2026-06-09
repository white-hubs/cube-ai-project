/**
 * 结构化 MySQL 连接接口（仅需 query）。llm-core 不直接依赖 mysql2：
 * 引擎组合根 / 迁移工具传入真实 `mysql2/promise` Pool（query 兼容）。
 */
export interface CatalogMysqlPool {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
}

export async function queryRows<T>(
  pool: CatalogMysqlPool,
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T[]> {
  const [rows] = await pool.query(sql, [...params]);
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export async function exec(
  pool: CatalogMysqlPool,
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<void> {
  await pool.query(sql, [...params]);
}

/** mysql2 占位符安全值转换：boolean→0/1，undefined→null，Date 原样。 */
export function sqlParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

export function sqlParams(values: ReadonlyArray<unknown>): unknown[] {
  return values.map(sqlParam);
}

/** 系统审计信息。auth 仍 Mock，统一记 system；TODO: 接真实 principal 后注入。 */
export interface AuditInfo {
  by: string;
  id: string | null;
  type: string | null;
}

export const SYSTEM_AUDIT: AuditInfo = { by: 'system', id: null, type: null };

/**
 * catalog 真实列式表 DDL（与 engine/flow 同库 agentic_engine），对齐 ghcloud
 * cube_base_ai_application 的 system/tenant 两层 + match-rule。运行期幂等建表；
 * 全新 compose 由 mysql/init/03-llm-catalog.sql 预建。
 */
const TABLE_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ai_system_llm_provider_type (
     code VARCHAR(64) NOT NULL,
     display_name VARCHAR(128) NOT NULL,
     description VARCHAR(512) DEFAULT NULL,
     sort_order INT(11) NOT NULL DEFAULT 0,
     enabled TINYINT(1) NOT NULL DEFAULT 1,
     create_by VARCHAR(100) NOT NULL DEFAULT '',
     creator_id VARCHAR(100) DEFAULT NULL,
     creator_type VARCHAR(50) DEFAULT NULL,
     create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     update_by VARCHAR(100) NOT NULL DEFAULT '',
     updater_id VARCHAR(100) DEFAULT NULL,
     updater_type VARCHAR(50) DEFAULT NULL,
     update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     deleted BIGINT(20) DEFAULT 0,
     PRIMARY KEY (code),
     UNIQUE KEY uk_ai_system_llm_provider_type_code_deleted (code, deleted)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS ai_system_llm_provider (
     id BIGINT NOT NULL,
     provider_code VARCHAR(128) NOT NULL,
     type_code VARCHAR(64) NOT NULL,
     name VARCHAR(255) NOT NULL,
     icon_url VARCHAR(1024) DEFAULT NULL,
     default_remark VARCHAR(512) DEFAULT NULL,
     create_by VARCHAR(100) NOT NULL DEFAULT '',
     creator_id VARCHAR(100) DEFAULT NULL,
     creator_type VARCHAR(50) DEFAULT NULL,
     create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     update_by VARCHAR(100) NOT NULL DEFAULT '',
     updater_id VARCHAR(100) DEFAULT NULL,
     updater_type VARCHAR(50) DEFAULT NULL,
     update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     deleted BIGINT(20) DEFAULT 0,
     PRIMARY KEY (id),
     UNIQUE KEY uk_ai_provider_code_deleted (provider_code, deleted),
     KEY idx_ai_type_code_deleted (type_code, deleted)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS ai_system_llm_model (
     id BIGINT NOT NULL,
     system_provider_id BIGINT NOT NULL,
     model_code VARCHAR(255) NOT NULL,
     display_name VARCHAR(255) NOT NULL,
     group_name VARCHAR(128) NOT NULL DEFAULT 'default',
     sort_order INT(11) NOT NULL DEFAULT 0,
     icon_url VARCHAR(1024) DEFAULT NULL,
     api_base_url VARCHAR(1024) DEFAULT NULL,
     endpoint_type VARCHAR(64) DEFAULT NULL,
     model_types VARCHAR(255) NOT NULL DEFAULT '',
     is_free TINYINT(1) NOT NULL DEFAULT 0,
     supports_test TINYINT(1) NOT NULL DEFAULT 1,
     create_by VARCHAR(100) NOT NULL DEFAULT '',
     creator_id VARCHAR(100) DEFAULT NULL,
     creator_type VARCHAR(50) DEFAULT NULL,
     create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     update_by VARCHAR(100) NOT NULL DEFAULT '',
     updater_id VARCHAR(100) DEFAULT NULL,
     updater_type VARCHAR(50) DEFAULT NULL,
     update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     deleted BIGINT(20) DEFAULT 0,
     PRIMARY KEY (id),
     UNIQUE KEY uk_provider_model_deleted (system_provider_id, model_code, deleted),
     KEY idx_ai_group_deleted (group_name, deleted)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS ai_system_llm_model_match_rule (
     id BIGINT NOT NULL,
     provider_type_code VARCHAR(64) DEFAULT NULL,
     provider_code VARCHAR(128) DEFAULT NULL,
     match_type VARCHAR(32) NOT NULL,
     pattern VARCHAR(255) NOT NULL,
     normalized_name VARCHAR(255) DEFAULT NULL,
     native_family VARCHAR(64) DEFAULT NULL,
     display_name_template VARCHAR(255) DEFAULT NULL,
     group_name VARCHAR(128) DEFAULT NULL,
     icon_url VARCHAR(1024) DEFAULT NULL,
     api_base_url VARCHAR(1024) DEFAULT NULL,
     endpoint_type VARCHAR(64) DEFAULT NULL,
     channel_profile VARCHAR(32) DEFAULT NULL,
     adapter_key VARCHAR(128) DEFAULT NULL,
     request_schema_json LONGTEXT DEFAULT NULL,
     response_schema_json LONGTEXT DEFAULT NULL,
     dsl_schema_json LONGTEXT DEFAULT NULL,
     model_types VARCHAR(255) NOT NULL DEFAULT '',
     is_free TINYINT(1) NOT NULL DEFAULT 0,
     priority INT(11) NOT NULL DEFAULT 0,
     create_by VARCHAR(100) NOT NULL DEFAULT '',
     creator_id VARCHAR(100) DEFAULT NULL,
     creator_type VARCHAR(50) DEFAULT NULL,
     create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     update_by VARCHAR(100) NOT NULL DEFAULT '',
     updater_id VARCHAR(100) DEFAULT NULL,
     updater_type VARCHAR(50) DEFAULT NULL,
     update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     deleted BIGINT(20) DEFAULT 0,
     PRIMARY KEY (id),
     UNIQUE KEY uk_ai_model_match_rule_deleted (provider_type_code, provider_code, match_type, pattern, deleted)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS ai_application_tenant_llm_provider (
     id BIGINT NOT NULL,
     tenant INT(11) NOT NULL,
     system_provider_id BIGINT DEFAULT NULL,
     provider_code VARCHAR(128) NOT NULL,
     type_code VARCHAR(64) NOT NULL,
     name VARCHAR(255) NOT NULL,
     icon_url VARCHAR(1024) DEFAULT NULL,
     api_key TEXT DEFAULT NULL,
     api_base_url VARCHAR(1024) DEFAULT NULL,
     enabled TINYINT(1) NOT NULL DEFAULT 0,
     is_custom TINYINT(1) NOT NULL DEFAULT 0,
     remark VARCHAR(512) DEFAULT NULL,
     create_by VARCHAR(100) NOT NULL DEFAULT '',
     creator_id VARCHAR(100) DEFAULT NULL,
     creator_type VARCHAR(50) DEFAULT NULL,
     create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     update_by VARCHAR(100) NOT NULL DEFAULT '',
     updater_id VARCHAR(100) DEFAULT NULL,
     updater_type VARCHAR(50) DEFAULT NULL,
     update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     deleted BIGINT(20) DEFAULT 0,
     PRIMARY KEY (id),
     UNIQUE KEY uk_ai_provider_deleted (tenant, provider_code, deleted),
     UNIQUE KEY uk_ai_system_provider_deleted (tenant, system_provider_id, deleted),
     KEY idx_tenant_type_deleted (tenant, type_code, deleted)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE IF NOT EXISTS ai_application_tenant_llm_model (
     id BIGINT NOT NULL,
     tenant INT(11) NOT NULL,
     tenant_provider_id BIGINT NOT NULL,
     system_model_id BIGINT DEFAULT NULL,
     model_code VARCHAR(255) NOT NULL,
     display_name VARCHAR(255) NOT NULL,
     group_name VARCHAR(128) NOT NULL DEFAULT 'default',
     sort_order INT(11) NOT NULL DEFAULT 0,
     remark VARCHAR(512) DEFAULT NULL,
     icon_url VARCHAR(1024) DEFAULT NULL,
     api_base_url VARCHAR(1024) DEFAULT NULL,
     endpoint_type VARCHAR(64) DEFAULT NULL,
     request_schema_json LONGTEXT DEFAULT NULL,
     response_schema_json LONGTEXT DEFAULT NULL,
     dsl_schema_json LONGTEXT DEFAULT NULL,
     model_types VARCHAR(255) NOT NULL DEFAULT '',
     is_free TINYINT(1) NOT NULL DEFAULT 0,
     supports_test TINYINT(1) NOT NULL DEFAULT 1,
     create_by VARCHAR(100) NOT NULL DEFAULT '',
     creator_id VARCHAR(100) DEFAULT NULL,
     creator_type VARCHAR(50) DEFAULT NULL,
     create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     update_by VARCHAR(100) NOT NULL DEFAULT '',
     updater_id VARCHAR(100) DEFAULT NULL,
     updater_type VARCHAR(50) DEFAULT NULL,
     update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     deleted BIGINT(20) DEFAULT 0,
     PRIMARY KEY (id),
     UNIQUE KEY uk_ai_tenant_provider_model_deleted (tenant_provider_id, model_code, deleted),
     UNIQUE KEY uk_ai_tenant_tenant_system_model_deleted (tenant, system_model_id, deleted),
     KEY idx_ai_tenant_group_deleted (tenant, group_name, deleted)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
];

export async function ensureCatalogTables(pool: CatalogMysqlPool): Promise<void> {
  for (const ddl of TABLE_DDL) {
    await pool.query(ddl);
  }
}
