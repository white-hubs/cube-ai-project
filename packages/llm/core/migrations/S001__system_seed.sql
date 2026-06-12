-- llm-core — 系统级 LLM 目录种子数据（ADR-0017：S 类文件，每次启动幂等重跑）
-- 所有 INSERT 使用 ON DUPLICATE KEY UPDATE，严格幂等。

SET NAMES utf8mb4;

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
