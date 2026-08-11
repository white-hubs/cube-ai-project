import type { LlmEndpointType } from "@cube-ai/contracts";

/** ghcloud-aligned endpoint types (11 values); contracts adds `ollama` + `jina_rerank` + `openai_rerank`. */
export const GHCLOUD_ENDPOINT_TYPES = [
  "openai",
  "openai_response",
  "anthropic",
  "gemini",
  "azure_openai",
  "new_api",
  "openai_image",
  "geekai",
  "dashscope",
  "dashscope_text2image",
  "volcengine_ark",
] as const satisfies readonly LlmEndpointType[];

export const CONTRACTS_ONLY_ENDPOINT_TYPES = ["ollama", "jina_rerank", "openai_rerank"] as const satisfies readonly LlmEndpointType[];

export interface SystemLlmProviderTypeEntity {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
}

export interface SystemLlmProviderEntity {
  id: string;
  provider_code: string;
  type_code: string;
  name: string;
  icon_url: string | null;
  default_remark: string | null;
  enabled: boolean;
}

export interface SystemLlmModelEntity {
  id: string;
  system_provider_id: string;
  model_code: string;
  display_name: string;
  group_name: string;
  icon_url: string | null;
  api_base_url: string | null;
  endpoint_type: LlmEndpointType | null;
  model_types: string;
  is_free: boolean;
  supports_test: boolean;
}

export interface SystemLlmModelMatchRuleEntity {
  id: string;
  provider_type_code: string | null;
  provider_code: string | null;
  match_type: "exact" | "prefix" | "contains" | "regex";
  pattern: string;
  normalized_name: string | null;
  native_family: string | null;
  display_name_template: string | null;
  group_name: string | null;
  icon_url: string | null;
  api_base_url: string | null;
  endpoint_type: LlmEndpointType | null;
  request_schema_json: string | null;
  response_schema_json: string | null;
  dsl_schema_json: string | null;
  model_types: string;
  is_free: boolean;
  priority: string;
}

export interface TenantLlmProviderEntity {
  id: string;
  tenant: number;
  system_provider_id: string | null;
  provider_code: string;
  type_code: string;
  name: string;
  icon_url: string | null;
  api_base_url: string | null;
  api_key: string | null;
  enabled: boolean;
  is_custom: boolean;
  remark: string | null;
}

export interface TenantLlmModelEntity {
  id: string;
  tenant: number;
  tenant_provider_id: string;
  system_model_id: string | null;
  model_code: string;
  display_name: string;
  group_name: string;
  icon_url: string | null;
  api_base_url: string | null;
  endpoint_type: LlmEndpointType | null;
  model_types: string;
  is_free: boolean;
  enabled: boolean;
}
