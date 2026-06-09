import type { SystemCatalogSeed } from './seed';

/**
 * 权威系统级 catalog seed。
 * 数据来源：deploy/docker-compose/mysql/init/03-llm-catalog.sql 的系统行。
 * 字段 1:1 对齐 row-types.ts（sort_order / priority 为字符串；id 为 BIGINT 字符串）。
 * Ollama 模型在 SQL 中 endpoint_type = NULL，此处设 'openai'（Ollama API 兼容 OpenAI 协议）。
 */
export const AUTHORITATIVE_SYSTEM_CATALOG_SEED: SystemCatalogSeed = {
  types: [
    { code: 'openai',         display_name: 'OpenAI',         description: 'OpenAI 标准协议',                                                     sort_order: '10', enabled: true },
    { code: 'openai_response',display_name: 'OpenAI-Response',description: 'OpenAI Response API',                                                  sort_order: '20', enabled: true },
    { code: 'dashscope',      display_name: 'DashScope',      description: '阿里云百炼 / DashScope',                                               sort_order: '25', enabled: true },
    { code: 'gemini',         display_name: 'Gemini',         description: 'Google Gemini',                                                         sort_order: '30', enabled: true },
    { code: 'anthropic',      display_name: 'Anthropic',      description: 'Anthropic Claude',                                                      sort_order: '40', enabled: true },
    { code: 'azure_openai',   display_name: 'Azure OpenAI',   description: 'Azure OpenAI 服务',                                                     sort_order: '50', enabled: true },
    { code: 'new_api',        display_name: 'New API',        description: 'OpenAI 兼容中间层',                                                     sort_order: '60', enabled: true },
    { code: 'ollama',         display_name: 'Ollama',         description: '本地 Ollama',                                                           sort_order: '80', enabled: true },
    { code: 'volcengine_ark', display_name: '火山方舟',       description: '火山引擎方舟大模型平台（OpenAI 兼容 /api/v3）',                        sort_order: '26', enabled: true },
    { code: 'geekai',         display_name: '极客智坊',       description: '极客智坊模型代理（OpenAI 兼容 https://geekai.co/api/v1）',             sort_order: '27', enabled: true },
  ],

  providers: [
    { id: '900000000000001001', provider_code: 'openai-official',   type_code: 'openai',         name: 'OpenAI',     icon_url: null, default_remark: '官方 OpenAI' },
    { id: '900000000000001002', provider_code: 'azure-openai',      type_code: 'azure_openai',   name: 'Azure OpenAI', icon_url: null, default_remark: 'Azure OpenAI 兼容' },
    { id: '900000000000001003', provider_code: 'gemini-official',   type_code: 'gemini',         name: 'Gemini',     icon_url: null, default_remark: 'Google Gemini' },
    { id: '900000000000001004', provider_code: 'anthropic-official',type_code: 'anthropic',      name: 'Anthropic',  icon_url: null, default_remark: 'Anthropic Claude' },
    { id: '900000000000001005', provider_code: 'ollama-local',      type_code: 'ollama',         name: 'Ollama',     icon_url: null, default_remark: '本地 Ollama' },
    { id: '900000000000001006', provider_code: 'new-api-compat',    type_code: 'new_api',        name: 'New API',    icon_url: null, default_remark: 'OpenAI 协议中转' },
    { id: '900000000000001007', provider_code: 'aliyun-bailian',    type_code: 'dashscope',      name: '阿里云百炼', icon_url: null, default_remark: '阿里云百炼内置供应商' },
    { id: '900000000000001008', provider_code: 'volcengine-ark',    type_code: 'volcengine_ark', name: '火山方舟',   icon_url: null, default_remark: '火山引擎方舟内置供应商，默认 https://ark.cn-beijing.volces.com/api/v3' },
    { id: '900000000000001009', provider_code: 'geekai',            type_code: 'geekai',         name: '极客智坊',   icon_url: null, default_remark: '极客智坊内置供应商，默认 https://geekai.co/api/v1' },
  ],

  models: [
    {
      id: '900000000000002001', system_provider_id: '900000000000001001',
      model_code: 'gpt-4o',           display_name: 'GPT-4o',           group_name: 'General',          sort_order: '10',
      icon_url: null, api_base_url: null, endpoint_type: 'openai',       model_types: 'reasoning,tool',   is_free: false, supports_test: true,
    },
    {
      id: '900000000000002002', system_provider_id: '900000000000001001',
      model_code: 'gpt-4o-mini',      display_name: 'GPT-4o Mini',      group_name: 'General',          sort_order: '20',
      icon_url: null, api_base_url: null, endpoint_type: 'openai',       model_types: 'reasoning,tool',   is_free: false, supports_test: true,
    },
    {
      id: '900000000000002003', system_provider_id: '900000000000001003',
      model_code: 'gemini-1.5-pro',   display_name: 'Gemini 1.5 Pro',   group_name: 'General',          sort_order: '10',
      icon_url: null, api_base_url: null, endpoint_type: 'gemini',       model_types: 'reasoning,vision,tool', is_free: false, supports_test: true,
    },
    {
      id: '900000000000002004', system_provider_id: '900000000000001003',
      model_code: 'gemini-1.5-flash', display_name: 'Gemini 1.5 Flash', group_name: 'General',          sort_order: '20',
      icon_url: null, api_base_url: null, endpoint_type: 'gemini',       model_types: 'reasoning,vision', is_free: false, supports_test: true,
    },
    {
      id: '900000000000002005', system_provider_id: '900000000000001004',
      model_code: 'claude-3-5-sonnet',display_name: 'Claude 3.5 Sonnet',group_name: 'General',          sort_order: '10',
      icon_url: null, api_base_url: null, endpoint_type: 'anthropic',    model_types: 'reasoning,tool',   is_free: false, supports_test: true,
    },
    {
      id: '900000000000002006', system_provider_id: '900000000000001005',
      model_code: 'llama3.1:8b',      display_name: 'Llama 3.1 8B',     group_name: 'Local',            sort_order: '10',
      icon_url: null, api_base_url: null, endpoint_type: 'openai',       model_types: 'reasoning',        is_free: true,  supports_test: true,
    },
    {
      id: '900000000000002007', system_provider_id: '900000000000001006',
      model_code: 'gpt-4o',           display_name: 'GPT-4o',           group_name: 'OpenAI-Compatible', sort_order: '10',
      icon_url: null, api_base_url: null, endpoint_type: 'openai',       model_types: 'reasoning,tool',   is_free: false, supports_test: true,
    },
    {
      id: '900000000000002008', system_provider_id: '900000000000001002',
      model_code: 'gpt-4o',           display_name: 'GPT-4o (Azure)',   group_name: 'Azure',            sort_order: '10',
      icon_url: null, api_base_url: null, endpoint_type: 'azure_openai', model_types: 'reasoning,tool',   is_free: false, supports_test: true,
    },
    {
      id: '900000000000002012', system_provider_id: '900000000000001001',
      model_code: 'dall-e-3',         display_name: 'DALL·E 3',         group_name: 'Image',            sort_order: '30',
      icon_url: null, api_base_url: null, endpoint_type: 'openai_image', model_types: 'image_generation', is_free: false, supports_test: true,
    },
    {
      id: '900000000000002013', system_provider_id: '900000000000001001',
      model_code: 'gpt-image-1',      display_name: 'GPT Image 1',      group_name: 'Image',            sort_order: '40',
      icon_url: null, api_base_url: null, endpoint_type: 'openai_image', model_types: 'image_generation', is_free: false, supports_test: true,
    },
  ],

  matchRules: [
    {
      id: '900000000000003003',
      provider_type_code: null, provider_code: null,
      match_type: 'contains', pattern: 'rerank',
      normalized_name: 'Rerank', native_family: null, display_name_template: 'Rerank', group_name: 'Rerank',
      icon_url: 'builtin:model:rerank', api_base_url: null, endpoint_type: 'jina_rerank',
      channel_profile: null, adapter_key: null,
      request_schema_json: null, response_schema_json: null, dsl_schema_json: null,
      model_types: 'rerank', is_free: false, priority: '120',
    },
    {
      id: '900000000000003004',
      provider_type_code: null, provider_code: null,
      match_type: 'prefix', pattern: 'gpt-',
      normalized_name: 'GPT', native_family: null, display_name_template: 'GPT', group_name: 'GPT',
      icon_url: 'builtin:model:openai', api_base_url: null, endpoint_type: 'openai',
      channel_profile: null, adapter_key: null,
      request_schema_json: null, response_schema_json: null, dsl_schema_json: null,
      model_types: 'reasoning,tool', is_free: false, priority: '90',
    },
    {
      id: '900000000000003007',
      provider_type_code: null, provider_code: null,
      match_type: 'prefix', pattern: 'claude-',
      normalized_name: 'Claude', native_family: null, display_name_template: 'Claude', group_name: 'Claude',
      icon_url: 'builtin:model:anthropic', api_base_url: null, endpoint_type: 'anthropic',
      channel_profile: null, adapter_key: null,
      request_schema_json: null, response_schema_json: null, dsl_schema_json: null,
      model_types: 'reasoning,tool', is_free: false, priority: '90',
    },
    {
      id: '900000000000003008',
      provider_type_code: null, provider_code: null,
      match_type: 'prefix', pattern: 'gemini-',
      normalized_name: 'Gemini', native_family: null, display_name_template: 'Gemini', group_name: 'Gemini',
      icon_url: 'builtin:model:gemini', api_base_url: null, endpoint_type: 'gemini',
      channel_profile: null, adapter_key: null,
      request_schema_json: null, response_schema_json: null, dsl_schema_json: null,
      model_types: 'reasoning,vision', is_free: false, priority: '90',
    },
    {
      id: '900000000000003009',
      provider_type_code: null, provider_code: null,
      match_type: 'prefix', pattern: 'deepseek-',
      normalized_name: 'DeepSeek', native_family: null, display_name_template: 'DeepSeek', group_name: 'DeepSeek',
      icon_url: 'builtin:model:openai', api_base_url: null, endpoint_type: 'openai',
      channel_profile: null, adapter_key: null,
      request_schema_json: null, response_schema_json: null, dsl_schema_json: null,
      model_types: 'reasoning', is_free: false, priority: '80',
    },
    {
      id: '900000000000003013',
      provider_type_code: null, provider_code: null,
      match_type: 'prefix', pattern: 'glm-',
      normalized_name: 'GLM', native_family: null, display_name_template: 'GLM', group_name: 'GLM',
      icon_url: 'builtin:model:openai', api_base_url: null, endpoint_type: 'openai',
      channel_profile: null, adapter_key: null,
      request_schema_json: null, response_schema_json: null, dsl_schema_json: null,
      model_types: 'reasoning', is_free: false, priority: '80',
    },
    {
      id: '900000000000003014',
      provider_type_code: null, provider_code: null,
      match_type: 'prefix', pattern: 'mistral-',
      normalized_name: 'Mistral', native_family: null, display_name_template: 'Mistral', group_name: 'Mistral',
      icon_url: 'builtin:model:openai', api_base_url: null, endpoint_type: 'openai',
      channel_profile: null, adapter_key: null,
      request_schema_json: null, response_schema_json: null, dsl_schema_json: null,
      model_types: 'reasoning', is_free: false, priority: '80',
    },
  ],
};
