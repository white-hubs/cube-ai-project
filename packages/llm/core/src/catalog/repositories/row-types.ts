/**
 * MySQL 行类型，1:1 对齐 ghcloud `create_llm_model_management_tables.sql` 的列。
 * 与 `../entities` 的精简领域类型分离：这些是真实库列形态（含审计 / deleted），
 * 供 mysql2 仓储与管理面 service 直接使用。BIGINT 主键以字符串表示避免精度丢失。
 */

export interface SystemTypeRow {
  code: string;
  display_name: string;
  description: string | null;
  sort_order: string;
  enabled: boolean;
}

export interface SystemProviderRow {
  id: string;
  provider_code: string;
  type_code: string;
  name: string;
  icon_url: string | null;
  default_remark: string | null;
}

export interface SystemModelRow {
  id: string;
  system_provider_id: string;
  model_code: string;
  display_name: string;
  group_name: string;
  sort_order: string;
  icon_url: string | null;
  api_base_url: string | null;
  endpoint_type: string | null;
  model_types: string;
  is_free: boolean;
  supports_test: boolean;
}

export interface MatchRuleRow {
  id: string;
  provider_type_code: string | null;
  provider_code: string | null;
  match_type: string;
  pattern: string;
  normalized_name: string | null;
  native_family: string | null;
  display_name_template: string | null;
  group_name: string | null;
  icon_url: string | null;
  api_base_url: string | null;
  endpoint_type: string | null;
  channel_profile: string | null;
  adapter_key: string | null;
  request_schema_json: string | null;
  response_schema_json: string | null;
  dsl_schema_json: string | null;
  model_types: string;
  is_free: boolean;
  priority: string;
}

export interface TenantProviderRow {
  id: string;
  tenant: number;
  system_provider_id: string | null;
  provider_code: string;
  type_code: string;
  name: string;
  icon_url: string | null;
  api_key: string | null;
  api_base_url: string | null;
  enabled: boolean;
  is_custom: boolean;
  remark: string | null;
}

export interface TenantModelRow {
  id: string;
  tenant: number;
  tenant_provider_id: string;
  system_model_id: string | null;
  model_code: string;
  display_name: string;
  group_name: string;
  sort_order: string;
  remark: string | null;
  icon_url: string | null;
  api_base_url: string | null;
  endpoint_type: string | null;
  request_schema_json: string | null;
  response_schema_json: string | null;
  dsl_schema_json: string | null;
  model_types: string;
  is_free: boolean;
  supports_test: boolean;
}
