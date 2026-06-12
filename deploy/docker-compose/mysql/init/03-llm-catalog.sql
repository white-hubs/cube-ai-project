-- LLM catalog 持久化（与 engine/flow 同库 cube_ai_center），1:1 对齐 ghcloud
-- cube_base_ai_application 的真实列式结构：system 供应商类型/供应商/模型/识别规则 +
-- tenant 供应商/模型两层，含逻辑删除 deleted 与审计列。
-- 运行期 MysqlLlmCatalogPort 亦会 CREATE TABLE IF NOT EXISTS（幂等）；本脚本用于全新 compose 预建 + 系统目录种子。
-- 租户副本由 LlmCatalogService 首访（GET /ai/llm/providers）时自动 provisioning 同步。
-- 模型目录扩展（百炼/火山/极客全量）：把 ghcloud scripts/sql/seed_*.sql 追加到本目录后续脚本即可。
USE cube_ai_center;

CREATE TABLE IF NOT EXISTS `ai_system_llm_provider_type` (
    `code` VARCHAR(64) NOT NULL COMMENT '类型编码',
    `display_name` VARCHAR(128) NOT NULL COMMENT '类型显示名',
    `description` VARCHAR(512) DEFAULT NULL COMMENT '描述',
    `sort_order` INT(11) NOT NULL DEFAULT 0 COMMENT '排序',
    `enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '启用',
    `create_by` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '创建用户',
    `creator_id` VARCHAR(100) DEFAULT NULL COMMENT '创建用户id',
    `creator_type` VARCHAR(50) DEFAULT NULL COMMENT '创建用户类型',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_by` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '更新用户',
    `updater_id` VARCHAR(100) DEFAULT NULL COMMENT '更新用户id',
    `updater_type` VARCHAR(50) DEFAULT NULL COMMENT '更新用户类型',
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted` BIGINT(20) DEFAULT 0 COMMENT '是否删除：0-否，>0-逻辑删除版本',
    PRIMARY KEY (`code`),
    UNIQUE KEY `uk_ai_system_llm_provider_type_code_deleted` (`code`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='系统LLM供应商类型字典';

CREATE TABLE IF NOT EXISTS `ai_system_llm_provider` (
    `id` BIGINT NOT NULL COMMENT '主键ID',
    `provider_code` VARCHAR(128) NOT NULL COMMENT '供应商编码',
    `type_code` VARCHAR(64) NOT NULL COMMENT '供应商类型编码',
    `name` VARCHAR(255) NOT NULL COMMENT '供应商名称',
    `icon_url` VARCHAR(1024) DEFAULT NULL COMMENT '图标地址',
    `default_remark` VARCHAR(512) DEFAULT NULL COMMENT '默认备注',
    `create_by` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '创建用户',
    `creator_id` VARCHAR(100) DEFAULT NULL COMMENT '创建用户id',
    `creator_type` VARCHAR(50) DEFAULT NULL COMMENT '创建用户类型',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_by` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '更新用户',
    `updater_id` VARCHAR(100) DEFAULT NULL COMMENT '更新用户id',
    `updater_type` VARCHAR(50) DEFAULT NULL COMMENT '更新用户类型',
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted` BIGINT(20) DEFAULT 0 COMMENT '是否删除：0-否，>0-逻辑删除版本',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_ai_provider_code_deleted` (`provider_code`, `deleted`),
    KEY `idx_ai_type_code_deleted` (`type_code`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='系统LLM供应商目录';

CREATE TABLE IF NOT EXISTS `ai_system_llm_model` (
    `id` BIGINT NOT NULL COMMENT '主键ID',
    `system_provider_id` BIGINT NOT NULL COMMENT '系统供应商ID',
    `model_code` VARCHAR(255) NOT NULL COMMENT '模型编码',
    `display_name` VARCHAR(255) NOT NULL COMMENT '模型显示名',
    `group_name` VARCHAR(128) NOT NULL DEFAULT 'default' COMMENT '模型分组',
    `sort_order` INT(11) NOT NULL DEFAULT 0 COMMENT '排序',
    `icon_url` VARCHAR(1024) DEFAULT NULL COMMENT '图标地址',
    `api_base_url` VARCHAR(1024) DEFAULT NULL COMMENT '模型级API地址',
    `endpoint_type` VARCHAR(64) DEFAULT NULL COMMENT '端点协议类型',
    `model_types` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '模型类型（逗号分隔）',
    `is_free` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否免费',
    `supports_test` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否支持测试调用',
    `create_by` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '创建用户',
    `creator_id` VARCHAR(100) DEFAULT NULL COMMENT '创建用户id',
    `creator_type` VARCHAR(50) DEFAULT NULL COMMENT '创建用户类型',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_by` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '更新用户',
    `updater_id` VARCHAR(100) DEFAULT NULL COMMENT '更新用户id',
    `updater_type` VARCHAR(50) DEFAULT NULL COMMENT '更新用户类型',
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted` BIGINT(20) DEFAULT 0 COMMENT '是否删除：0-否，>0-逻辑删除版本',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_provider_model_deleted` (`system_provider_id`, `model_code`, `deleted`),
    KEY `idx_ai_group_deleted` (`group_name`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='系统LLM模型目录';

CREATE TABLE IF NOT EXISTS `ai_system_llm_model_match_rule` (
    `id` BIGINT NOT NULL COMMENT '主键ID',
    `provider_type_code` VARCHAR(64) DEFAULT NULL COMMENT '限定供应商类型编码',
    `provider_code` VARCHAR(128) DEFAULT NULL COMMENT '限定供应商编码',
    `match_type` VARCHAR(32) NOT NULL COMMENT '匹配方式：exact/prefix/contains/regex',
    `pattern` VARCHAR(255) NOT NULL COMMENT '匹配表达式',
    `normalized_name` VARCHAR(255) DEFAULT NULL COMMENT '归一化家族名称',
    `native_family` VARCHAR(64) DEFAULT NULL COMMENT '原厂模型族编码，如 qwen3/seedream/gpt',
    `display_name_template` VARCHAR(255) DEFAULT NULL COMMENT '默认展示名称模板',
    `group_name` VARCHAR(128) DEFAULT NULL COMMENT '默认分组名称',
    `icon_url` VARCHAR(1024) DEFAULT NULL COMMENT '图标地址或内置图标编码',
    `api_base_url` VARCHAR(1024) DEFAULT NULL COMMENT '模型级API地址',
    `endpoint_type` VARCHAR(64) DEFAULT NULL COMMENT '端点协议类型',
    `channel_profile` VARCHAR(32) DEFAULT NULL COMMENT '通道：direct/aggregator_unified/aggregator_native',
    `adapter_key` VARCHAR(128) DEFAULT NULL COMMENT 'Wire Adapter 注册键',
    `request_schema_json` LONGTEXT DEFAULT NULL COMMENT '模型请求参数Schema JSON',
    `response_schema_json` LONGTEXT DEFAULT NULL COMMENT '模型响应结构Schema JSON',
    `dsl_schema_json` LONGTEXT DEFAULT NULL COMMENT 'DSL 节点Schema JSON',
    `model_types` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '模型类型（逗号分隔）',
    `is_free` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否免费',
    `priority` INT(11) NOT NULL DEFAULT 0 COMMENT '优先级，越大越优先',
    `create_by` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '创建用户',
    `creator_id` VARCHAR(100) DEFAULT NULL COMMENT '创建用户id',
    `creator_type` VARCHAR(50) DEFAULT NULL COMMENT '创建用户类型',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_by` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '更新用户',
    `updater_id` VARCHAR(100) DEFAULT NULL COMMENT '更新用户id',
    `updater_type` VARCHAR(50) DEFAULT NULL COMMENT '更新用户类型',
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted` BIGINT(20) DEFAULT 0 COMMENT '是否删除：0-否，>0-逻辑删除版本',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_ai_model_match_rule_deleted` (`provider_type_code`, `provider_code`, `match_type`, `pattern`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='系统模型ID识别规则';

CREATE TABLE IF NOT EXISTS `ai_application_tenant_llm_provider` (
    `id` BIGINT NOT NULL COMMENT '主键ID',
    `tenant` INT(11) NOT NULL COMMENT '租户编号',
    `system_provider_id` BIGINT DEFAULT NULL COMMENT '来源系统供应商ID',
    `provider_code` VARCHAR(128) NOT NULL COMMENT '供应商编码',
    `type_code` VARCHAR(64) NOT NULL COMMENT '供应商类型编码',
    `name` VARCHAR(255) NOT NULL COMMENT '供应商名称',
    `icon_url` VARCHAR(1024) DEFAULT NULL COMMENT '图标地址',
    `api_key` TEXT DEFAULT NULL COMMENT '租户API密钥',
    `api_base_url` VARCHAR(1024) DEFAULT NULL COMMENT '租户API地址',
    `enabled` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用',
    `is_custom` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否租户自建',
    `remark` VARCHAR(512) DEFAULT NULL COMMENT '备注',
    `create_by` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '创建用户',
    `creator_id` VARCHAR(100) DEFAULT NULL COMMENT '创建用户id',
    `creator_type` VARCHAR(50) DEFAULT NULL COMMENT '创建用户类型',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_by` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '更新用户',
    `updater_id` VARCHAR(100) DEFAULT NULL COMMENT '更新用户id',
    `updater_type` VARCHAR(50) DEFAULT NULL COMMENT '更新用户类型',
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted` BIGINT(20) DEFAULT 0 COMMENT '是否删除：0-否，>0-逻辑删除版本',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_ai_provider_deleted` (`tenant`, `provider_code`, `deleted`),
    UNIQUE KEY `uk_ai_system_provider_deleted` (`tenant`, `system_provider_id`, `deleted`),
    KEY `idx_tenant_type_deleted` (`tenant`, `type_code`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='租户LLM供应商配置';

CREATE TABLE IF NOT EXISTS `ai_application_tenant_llm_model` (
    `id` BIGINT NOT NULL COMMENT '主键ID',
    `tenant` INT(11) NOT NULL COMMENT '租户编号',
    `tenant_provider_id` BIGINT NOT NULL COMMENT '租户供应商ID',
    `system_model_id` BIGINT DEFAULT NULL COMMENT '来源系统模型ID',
    `model_code` VARCHAR(255) NOT NULL COMMENT '模型编码',
    `display_name` VARCHAR(255) NOT NULL COMMENT '模型显示名',
    `group_name` VARCHAR(128) NOT NULL DEFAULT 'default' COMMENT '模型分组',
    `sort_order` INT(11) NOT NULL DEFAULT 0 COMMENT '排序',
    `remark` VARCHAR(512) DEFAULT NULL COMMENT '备注',
    `icon_url` VARCHAR(1024) DEFAULT NULL COMMENT '图标地址',
    `api_base_url` VARCHAR(1024) DEFAULT NULL COMMENT '模型级API地址',
    `endpoint_type` VARCHAR(64) DEFAULT NULL COMMENT '端点协议类型（自定义提供商模型可配置）',
    `request_schema_json` LONGTEXT DEFAULT NULL COMMENT '模型请求参数Schema JSON',
    `response_schema_json` LONGTEXT DEFAULT NULL COMMENT '模型响应结构Schema JSON',
    `dsl_schema_json` LONGTEXT DEFAULT NULL COMMENT 'DSL 节点Schema JSON',
    `model_types` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '模型类型（逗号分隔）',
    `is_free` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否免费',
    `supports_test` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否支持测试调用',
    `create_by` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '创建用户',
    `creator_id` VARCHAR(100) DEFAULT NULL COMMENT '创建用户id',
    `creator_type` VARCHAR(50) DEFAULT NULL COMMENT '创建用户类型',
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_by` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '更新用户',
    `updater_id` VARCHAR(100) DEFAULT NULL COMMENT '更新用户id',
    `updater_type` VARCHAR(50) DEFAULT NULL COMMENT '更新用户类型',
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted` BIGINT(20) DEFAULT 0 COMMENT '是否删除：0-否，>0-逻辑删除版本',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_ai_tenant_provider_model_deleted` (`tenant_provider_id`, `model_code`, `deleted`),
    UNIQUE KEY `uk_ai_tenant_tenant_system_model_deleted` (`tenant`, `system_model_id`, `deleted`),
    KEY `idx_ai_tenant_group_deleted` (`tenant`, `group_name`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='租户LLM模型';

INSERT INTO `ai_system_llm_provider_type` (`code`, `display_name`, `description`, `sort_order`, `enabled`)
VALUES
    ('openai', 'OpenAI', 'OpenAI 标准协议', 10, 1),
    ('openai_response', 'OpenAI-Response', 'OpenAI Response API', 20, 1),
    ('dashscope', 'DashScope', '阿里云百炼 / DashScope', 25, 1),
    ('gemini', 'Gemini', 'Google Gemini', 30, 1),
    ('anthropic', 'Anthropic', 'Anthropic Claude', 40, 1),
    ('azure_openai', 'Azure OpenAI', 'Azure OpenAI 服务', 50, 1),
    ('new_api', 'New API', 'OpenAI 兼容中间层', 60, 1),
    ('ollama', 'Ollama', '本地 Ollama', 80, 1),
    ('volcengine_ark', '火山方舟', '火山引擎方舟大模型平台（OpenAI 兼容 /api/v3）', 26, 1),
    ('geekai', '极客智坊', '极客智坊模型代理（OpenAI 兼容 https://geekai.co/api/v1）', 27, 1)
ON DUPLICATE KEY UPDATE
    `display_name` = VALUES(`display_name`), `description` = VALUES(`description`),
    `sort_order` = VALUES(`sort_order`), `enabled` = VALUES(`enabled`), `update_time` = CURRENT_TIMESTAMP;

INSERT INTO `ai_system_llm_provider` (`id`, `provider_code`, `type_code`, `name`, `icon_url`, `default_remark`)
VALUES
    (900000000000001001, 'openai-official', 'openai', 'OpenAI', NULL, '官方 OpenAI'),
    (900000000000001002, 'azure-openai', 'azure_openai', 'Azure OpenAI', NULL, 'Azure OpenAI 兼容'),
    (900000000000001007, 'aliyun-bailian', 'dashscope', '阿里云百炼', NULL, '阿里云百炼内置供应商'),
    (900000000000001008, 'volcengine-ark', 'volcengine_ark', '火山方舟', NULL, '火山引擎方舟内置供应商，默认 https://ark.cn-beijing.volces.com/api/v3'),
    (900000000000001009, 'geekai', 'geekai', '极客智坊', NULL, '极客智坊内置供应商，默认 https://geekai.co/api/v1'),
    (900000000000001003, 'gemini-official', 'gemini', 'Gemini', NULL, 'Google Gemini'),
    (900000000000001004, 'anthropic-official', 'anthropic', 'Anthropic', NULL, 'Anthropic Claude'),
    (900000000000001005, 'ollama-local', 'ollama', 'Ollama', NULL, '本地 Ollama'),
    (900000000000001006, 'new-api-compat', 'new_api', 'New API', NULL, 'OpenAI 协议中转')
ON DUPLICATE KEY UPDATE
    `type_code` = VALUES(`type_code`), `name` = VALUES(`name`), `icon_url` = VALUES(`icon_url`),
    `default_remark` = VALUES(`default_remark`), `update_time` = CURRENT_TIMESTAMP;

INSERT INTO `ai_system_llm_model` (`id`, `system_provider_id`, `model_code`, `display_name`, `group_name`, `sort_order`, `icon_url`, `api_base_url`, `endpoint_type`, `model_types`, `is_free`, `supports_test`)
VALUES
    (900000000000002001, 900000000000001001, 'gpt-4o', 'GPT-4o', 'General', 10, NULL, NULL, 'openai', 'reasoning,tool', 0, 1),
    (900000000000002002, 900000000000001001, 'gpt-4o-mini', 'GPT-4o Mini', 'General', 20, NULL, NULL, 'openai', 'reasoning,tool', 0, 1),
    (900000000000002003, 900000000000001003, 'gemini-1.5-pro', 'Gemini 1.5 Pro', 'General', 10, NULL, NULL, 'gemini', 'reasoning,vision,tool', 0, 1),
    (900000000000002004, 900000000000001003, 'gemini-1.5-flash', 'Gemini 1.5 Flash', 'General', 20, NULL, NULL, 'gemini', 'reasoning,vision', 0, 1),
    (900000000000002005, 900000000000001004, 'claude-3-5-sonnet', 'Claude 3.5 Sonnet', 'General', 10, NULL, NULL, 'anthropic', 'reasoning,tool', 0, 1),
    (900000000000002006, 900000000000001005, 'llama3.1:8b', 'Llama 3.1 8B', 'Local', 10, NULL, NULL, NULL, 'reasoning', 1, 1),
    (900000000000002007, 900000000000001006, 'gpt-4o', 'GPT-4o', 'OpenAI-Compatible', 10, NULL, NULL, 'openai', 'reasoning,tool', 0, 1),
    (900000000000002008, 900000000000001002, 'gpt-4o', 'GPT-4o (Azure)', 'Azure', 10, NULL, NULL, 'azure_openai', 'reasoning,tool', 0, 1),
    (900000000000002012, 900000000000001001, 'dall-e-3', 'DALL·E 3', 'Image', 30, NULL, NULL, 'openai_image', 'image_generation', 0, 1),
    (900000000000002013, 900000000000001001, 'gpt-image-1', 'GPT Image 1', 'Image', 40, NULL, NULL, 'openai_image', 'image_generation', 0, 1)
ON DUPLICATE KEY UPDATE
    `display_name` = VALUES(`display_name`), `group_name` = VALUES(`group_name`), `sort_order` = VALUES(`sort_order`),
    `icon_url` = VALUES(`icon_url`), `api_base_url` = VALUES(`api_base_url`), `endpoint_type` = VALUES(`endpoint_type`),
    `model_types` = VALUES(`model_types`), `is_free` = VALUES(`is_free`), `supports_test` = VALUES(`supports_test`),
    `update_time` = CURRENT_TIMESTAMP;

INSERT INTO `ai_system_llm_model_match_rule` (`id`, `provider_type_code`, `provider_code`, `match_type`, `pattern`, `normalized_name`, `display_name_template`, `group_name`, `icon_url`, `api_base_url`, `endpoint_type`, `model_types`, `is_free`, `priority`)
VALUES
    (900000000000003001, NULL, NULL, 'contains', 'doubao', 'Doubao', 'Doubao', 'Doubao', 'builtin:model:doubao', NULL, NULL, 'reasoning', 1, 100),
    (900000000000003002, NULL, NULL, 'contains', 'embedding', 'Embedding', 'Embedding', 'Embedding', 'builtin:model:embedding', NULL, NULL, 'embedding', 0, 120),
    (900000000000003003, NULL, NULL, 'contains', 'rerank', 'Rerank', 'Rerank', 'Rerank', 'builtin:model:rerank', NULL, 'jina_rerank', 'rerank', 0, 120),
    (900000000000003004, NULL, NULL, 'prefix', 'gpt-', 'GPT', 'GPT', 'GPT', 'builtin:model:openai', NULL, 'openai', 'reasoning,tool', 0, 90),
    (900000000000003007, NULL, NULL, 'prefix', 'claude-', 'Claude', 'Claude', 'Claude', 'builtin:model:anthropic', NULL, 'anthropic', 'reasoning,tool', 0, 90),
    (900000000000003008, NULL, NULL, 'prefix', 'gemini-', 'Gemini', 'Gemini', 'Gemini', 'builtin:model:gemini', NULL, 'gemini', 'reasoning,vision', 0, 90),
    (900000000000003009, NULL, NULL, 'prefix', 'deepseek-', 'DeepSeek', 'DeepSeek', 'DeepSeek', 'builtin:model:openai', NULL, 'openai', 'reasoning', 0, 80),
    (900000000000003013, NULL, NULL, 'prefix', 'glm-', 'GLM', 'GLM', 'GLM', 'builtin:model:openai', NULL, 'openai', 'reasoning', 0, 80),
    (900000000000003014, NULL, NULL, 'prefix', 'mistral-', 'Mistral', 'Mistral', 'Mistral', 'builtin:model:openai', NULL, 'openai', 'reasoning', 0, 80)
ON DUPLICATE KEY UPDATE
    `normalized_name` = VALUES(`normalized_name`), `display_name_template` = VALUES(`display_name_template`),
    `group_name` = VALUES(`group_name`), `icon_url` = VALUES(`icon_url`), `endpoint_type` = VALUES(`endpoint_type`),
    `model_types` = VALUES(`model_types`), `is_free` = VALUES(`is_free`), `priority` = VALUES(`priority`),
    `update_time` = CURRENT_TIMESTAMP;
