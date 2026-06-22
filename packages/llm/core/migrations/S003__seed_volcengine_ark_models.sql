-- 火山方舟（内置供应商 volcengine-ark）系统模型目录种子（ADR-0017：S 类文件，随启动幂等重跑）
-- 模型 ID 来源（2026-05 抓取官方文档页 HTML）：https://www.volcengine.com/docs/82379/1330310
-- API Base（OpenAI 兼容）：https://ark.cn-beijing.volces.com/api/v3
-- 依赖：表由 V001__init.sql 建立；provider/type（volcengine-ark / volcengine_ark）由先跑的 S001__system_seed.sql 建立。
-- 所有 INSERT 使用 ON DUPLICATE KEY UPDATE，严格幂等。

SET NAMES utf8mb4;

-- group_name = 模型作用；model_types 见各 INSERT 行注释
-- 画布已打通：文本/视觉语言模型（endpoint_type=openai）、文生图 Seedream（endpoint_type=openai_image，/v1/images/generations）
-- 目录展示待接流程：视频(Seedance)、3D、向量

INSERT INTO `ai_system_llm_model` (`id`, `system_provider_id`, `model_code`, `display_name`, `group_name`, `sort_order`, `icon_url`, `api_base_url`, `endpoint_type`, `model_types`, `is_free`, `supports_test`)
VALUES
    -- 文本生成 · 豆包 Seed 2.0
    (900000000000002201, 900000000000001008, 'doubao-seed-2-0-pro-260215', 'Doubao Seed 2.0 Pro', '文本生成-Seed2.0', 10, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002202, 900000000000001008, 'doubao-seed-2-0-lite-260215', 'Doubao Seed 2.0 Lite', '文本生成-Seed2.0', 11, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool,vision', 0, 1),
    (900000000000002203, 900000000000001008, 'doubao-seed-2-0-lite-260428', 'Doubao Seed 2.0 Lite 260428', '文本生成-Seed2.0', 12, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002204, 900000000000001008, 'doubao-seed-2-0-mini-260215', 'Doubao Seed 2.0 Mini', '文本生成-Seed2.0', 13, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002205, 900000000000001008, 'doubao-seed-2-0-mini-260428', 'Doubao Seed 2.0 Mini 260428', '文本生成-Seed2.0', 14, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002206, 900000000000001008, 'doubao-seed-2-0-code-preview-260215', 'Doubao Seed 2.0 Code', '文本生成-代码', 15, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    -- 文本生成 · 豆包 Seed 1.x
    (900000000000002210, 900000000000001008, 'doubao-seed-1-8-251228', 'Doubao Seed 1.8', '文本生成-Seed1.x', 20, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002211, 900000000000001008, 'doubao-seed-1-6-251015', 'Doubao Seed 1.6', '文本生成-Seed1.x', 21, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002212, 900000000000001008, 'doubao-seed-1-6-250615', 'Doubao Seed 1.6 250615', '文本生成-Seed1.x', 22, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002213, 900000000000001008, 'doubao-seed-1-6-flash-250828', 'Doubao Seed 1.6 Flash', '文本生成-Seed1.x', 23, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002214, 900000000000001008, 'doubao-seed-1-6-flash-250615', 'Doubao Seed 1.6 Flash 250615', '文本生成-Seed1.x', 24, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002215, 900000000000001008, 'doubao-seed-code-preview-251028', 'Doubao Seed Code', '文本生成-代码', 25, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002216, 900000000000001008, 'doubao-seed-character-251128', 'Doubao Seed Character', '文本生成-角色', 26, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning', 0, 1),
    (900000000000002217, 900000000000001008, 'doubao-seed-translation-250915', 'Doubao Seed Translation', '文本生成-翻译', 27, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning', 0, 1),
    -- 视觉理解
    (900000000000002218, 900000000000001008, 'doubao-seed-1-6-vision-250815', 'Doubao Seed 1.6 Vision', '视觉理解', 28, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,vision,tool', 0, 1),
    (900000000000002219, 900000000000001008, 'doubao-1-5-vision-pro-32k-250115', 'Doubao 1.5 Vision Pro', '视觉理解', 29, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,vision,tool', 0, 1),
    -- 文本生成 · 豆包 1.5（旧版）
    (900000000000002220, 900000000000001008, 'doubao-1-5-pro-32k-250115', 'Doubao 1.5 Pro 32K', '文本生成-1.5旧版', 30, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002221, 900000000000001008, 'doubao-1-5-lite-32k-250115', 'Doubao 1.5 Lite 32K', '文本生成-1.5旧版', 31, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002222, 900000000000001008, 'doubao-1-5-pro-32k-character-250715', 'Doubao 1.5 Pro Character', '文本生成-角色', 32, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning', 0, 1),
    -- 文本生成 · 三方（方舟聚合）
    (900000000000002230, 900000000000001008, 'deepseek-v3-2-251201', 'DeepSeek V3.2', '文本生成-三方模型', 40, '/resource/v1/ai-application/deepseek.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002231, 900000000000001008, 'glm-4-7-251222', 'GLM 4.7', '文本生成-三方模型', 41, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002232, 900000000000001008, 'glm-4-5-air', 'GLM 4.5 Air', '文本生成-三方模型', 42, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002233, 900000000000001008, 'qwen3-32b-20250429', 'Qwen3 32B', '文本生成-三方模型', 43, '/resource/v1/ai-application/qwen.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002234, 900000000000001008, 'qwen3-14b-20250429', 'Qwen3 14B', '文本生成-三方模型', 44, '/resource/v1/ai-application/qwen.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002235, 900000000000001008, 'qwen3-8b-20250429', 'Qwen3 8B', '文本生成-三方模型', 45, '/resource/v1/ai-application/qwen.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002236, 900000000000001008, 'qwen3-0-6b-20250429', 'Qwen3 0.6B', '文本生成-三方模型', 46, '/resource/v1/ai-application/qwen.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning', 0, 1),
    (900000000000002237, 900000000000001008, 'qwen2-5-72b-20240919', 'Qwen2.5 72B', '文本生成-三方模型', 47, '/resource/v1/ai-application/qwen.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'reasoning,tool', 0, 1),
    -- 图片生成（Seedream）
    (900000000000002240, 900000000000001008, 'doubao-seedream-5-0-260128', 'Seedream 5.0', '图片生成', 50, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai_image', 'image_generation', 0, 1),
    (900000000000002241, 900000000000001008, 'doubao-seedream-5-0-lite-260128', 'Seedream 5.0 Lite', '图片生成', 51, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai_image', 'image_generation', 0, 1),
    (900000000000002242, 900000000000001008, 'doubao-seedream-4-5-251128', 'Seedream 4.5', '图片生成', 52, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai_image', 'image_generation', 0, 1),
    (900000000000002243, 900000000000001008, 'doubao-seedream-4-0-250828', 'Seedream 4.0', '图片生成', 53, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai_image', 'image_generation', 0, 1),
    -- 视频生成（Seedance）
    (900000000000002250, 900000000000001008, 'doubao-seedance-2-0-260128', 'Seedance 2.0', '视频生成', 60, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', NULL, 'video_generation', 0, 0),
    (900000000000002251, 900000000000001008, 'doubao-seedance-2-0-fast-260128', 'Seedance 2.0 Fast', '视频生成', 61, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', NULL, 'video_generation', 0, 0),
    (900000000000002252, 900000000000001008, 'doubao-seedance-1-5-pro-251215', 'Seedance 1.5 Pro', '视频生成', 62, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', NULL, 'video_generation', 0, 0),
    (900000000000002253, 900000000000001008, 'doubao-seedance-1-0-pro-250528', 'Seedance 1.0 Pro', '视频生成', 63, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', NULL, 'video_generation', 0, 0),
    (900000000000002254, 900000000000001008, 'doubao-seedance-1-0-pro-fast-251015', 'Seedance 1.0 Pro Fast', '视频生成', 64, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', NULL, 'video_generation', 0, 0),
    -- 3D 生成
    (900000000000002260, 900000000000001008, 'doubao-seed3d-2-0-260328', 'Seed3D 2.0', '3D生成', 70, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', NULL, '3d_generation', 0, 0),
    (900000000000002261, 900000000000001008, 'hitem3d-2-0-251223', 'Hitem3D 2.0', '3D生成', 71, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', NULL, '3d_generation', 0, 0),
    (900000000000002262, 900000000000001008, 'hyper3d-gen2-260112', 'Hyper3D Gen2', '3D生成', 72, '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', NULL, '3d_generation', 0, 0),
    -- 向量
    (900000000000002270, 900000000000001008, 'doubao-embedding-vision-251215', 'Doubao Embedding Vision', '向量', 80, '/resource/v1/ai-application/getModel.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'embedding,vision', 0, 0),
    (900000000000002271, 900000000000001008, 'doubao-embedding-vision-250615', 'Doubao Embedding Vision 250615', '向量', 81, '/resource/v1/ai-application/getModel.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', 'embedding,vision', 0, 0)
ON DUPLICATE KEY UPDATE
    `display_name` = VALUES(`display_name`),
    `group_name` = VALUES(`group_name`),
    `sort_order` = VALUES(`sort_order`),
    `icon_url` = VALUES(`icon_url`),
    `api_base_url` = VALUES(`api_base_url`),
    `endpoint_type` = VALUES(`endpoint_type`),
    `model_types` = VALUES(`model_types`),
    `is_free` = VALUES(`is_free`),
    `supports_test` = VALUES(`supports_test`),
    `update_time` = CURRENT_TIMESTAMP;

INSERT INTO `ai_system_llm_model_match_rule` (`id`, `provider_type_code`, `provider_code`, `match_type`, `pattern`, `normalized_name`, `display_name_template`, `group_name`, `icon_url`, `api_base_url`, `endpoint_type`, `request_schema_json`, `response_schema_json`, `dsl_schema_json`, `model_types`, `is_free`, `priority`)
VALUES
    (900000000000003030, 'volcengine_ark', 'volcengine-ark', 'prefix', 'doubao-seed-2-0', 'Doubao Seed 2.0', 'Doubao Seed 2.0', '文本生成-Seed2.0', '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', '{"requestShape":"openai_chat_compatible","endpointPath":"/chat/completions","method":"POST","modelField":"model","inputContainer":"messages","extraBodyFields":[{"key":"enableThinking","label":"开启思考","type":"boolean","feature":"thinking","wirePath":"thinking.type","wireTransform":"boolean:enabled_disabled"}]}', '{"responseShape":"openai_chat_completion","resultMapping":{"text":"choices[0].message.content","finishReason":"choices[0].finish_reason","usage":"usage"}}', '{"nodeKind":"language_model","interactionMode":"sync","primaryInput":"messages"}', 'reasoning,tool,vision', 0, 130),
    (900000000000003031, 'volcengine_ark', 'volcengine-ark', 'prefix', 'doubao-seed-1-', 'Doubao Seed 1.x', 'Doubao Seed', '文本生成-Seed1.x', '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', '{"requestShape":"openai_chat_compatible","endpointPath":"/chat/completions","method":"POST","modelField":"model","inputContainer":"messages","extraBodyFields":[{"key":"enableThinking","label":"开启思考","type":"boolean","feature":"thinking","wirePath":"thinking.type","wireTransform":"boolean:enabled_disabled"}]}', '{"responseShape":"openai_chat_completion","resultMapping":{"text":"choices[0].message.content","usage":"usage"}}', '{"nodeKind":"language_model","interactionMode":"sync","primaryInput":"messages"}', 'reasoning,tool', 0, 129),
    (900000000000003032, 'volcengine_ark', 'volcengine-ark', 'prefix', 'doubao-1-5', 'Doubao 1.5', 'Doubao 1.5', '文本生成-1.5旧版', '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', '{"requestShape":"openai_chat_compatible","endpointPath":"/chat/completions","method":"POST","modelField":"model","inputContainer":"messages","extraBodyFields":[{"key":"enableThinking","label":"开启思考","type":"boolean","feature":"thinking","wirePath":"thinking.type","wireTransform":"boolean:enabled_disabled"}]}', '{"responseShape":"openai_chat_completion","resultMapping":{"text":"choices[0].message.content","usage":"usage"}}', '{"nodeKind":"language_model","interactionMode":"sync","primaryInput":"messages"}', 'reasoning,tool', 0, 128),
    (900000000000003033, 'volcengine_ark', 'volcengine-ark', 'prefix', 'doubao-seedream', 'Seedream', 'Seedream', '图片生成', '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai_image', '{"requestShape":"openai_images_generation","endpointPath":"/images/generations","method":"POST","modelField":"model","fields":[{"key":"size","label":"尺寸","type":"string"}]}', '{"responseShape":"openai_images_generation","resultMapping":{"imageUrl":"data[0].url"}}', '{"nodeKind":"image_generation","interactionMode":"sync","primaryInput":"prompt","inputs":[{"key":"prompt","type":"string","required":true}],"outputs":[{"key":"imageUrl","type":"string"}]}', 'image_generation', 0, 112),
    (900000000000003034, 'volcengine_ark', 'volcengine-ark', 'prefix', 'doubao-seedance', 'Seedance', 'Seedance', '视频生成', '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', NULL, NULL, NULL, NULL, 'video_generation', 0, 112),
    (900000000000003035, 'volcengine_ark', 'volcengine-ark', 'prefix', 'doubao-seed3d', 'Seed3D', 'Seed3D', '3D生成', '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', NULL, NULL, NULL, NULL, '3d_generation', 0, 110),
    (900000000000003036, 'volcengine_ark', 'volcengine-ark', 'prefix', 'hitem3d', 'Hitem3D', 'Hitem3D', '3D生成', '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', NULL, NULL, NULL, NULL, '3d_generation', 0, 110),
    (900000000000003037, 'volcengine_ark', 'volcengine-ark', 'prefix', 'hyper3d', 'Hyper3D', 'Hyper3D', '3D生成', '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', NULL, NULL, NULL, NULL, '3d_generation', 0, 110),
    (900000000000003038, 'volcengine_ark', 'volcengine-ark', 'prefix', 'doubao-embedding', 'Doubao Embedding', 'Embedding', '向量', '/resource/v1/ai-application/getModel.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', NULL, NULL, NULL, 'embedding,vision', 0, 120),
    (900000000000003039, 'volcengine_ark', 'volcengine-ark', 'prefix', 'deepseek-', 'DeepSeek', 'DeepSeek', '文本生成-三方模型', '/resource/v1/ai-application/deepseek.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', '{"requestShape":"openai_chat_compatible","endpointPath":"/chat/completions","method":"POST","modelField":"model","inputContainer":"messages","extraBodyFields":[{"key":"enableThinking","label":"开启思考","type":"boolean","feature":"thinking","wirePath":"thinking.type","wireTransform":"boolean:enabled_disabled"}]}', '{"responseShape":"openai_chat_completion","resultMapping":{"text":"choices[0].message.content","usage":"usage"}}', '{"nodeKind":"language_model","interactionMode":"sync","primaryInput":"messages"}', 'reasoning,tool', 0, 85),
    (900000000000003040, 'volcengine_ark', 'volcengine-ark', 'prefix', 'glm-', 'GLM', 'GLM', '文本生成-三方模型', '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', '{"requestShape":"openai_chat_compatible","endpointPath":"/chat/completions","method":"POST","modelField":"model","inputContainer":"messages","extraBodyFields":[{"key":"enableThinking","label":"开启思考","type":"boolean","feature":"thinking","wirePath":"thinking.type","wireTransform":"boolean:enabled_disabled"}]}', '{"responseShape":"openai_chat_completion","resultMapping":{"text":"choices[0].message.content","usage":"usage"}}', '{"nodeKind":"language_model","interactionMode":"sync","primaryInput":"messages"}', 'reasoning,tool', 0, 85),
    (900000000000003041, 'volcengine_ark', 'volcengine-ark', 'prefix', 'qwen', 'Qwen', 'Qwen', '文本生成-三方模型', '/resource/v1/ai-application/qwen.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', '{"requestShape":"openai_chat_compatible","endpointPath":"/chat/completions","method":"POST","modelField":"model","inputContainer":"messages","extraBodyFields":[{"key":"enableThinking","label":"开启思考","type":"boolean","feature":"thinking","wirePath":"thinking.type","wireTransform":"boolean:enabled_disabled"}]}', '{"responseShape":"openai_chat_completion","resultMapping":{"text":"choices[0].message.content","usage":"usage"}}', '{"nodeKind":"language_model","interactionMode":"sync","primaryInput":"messages"}', 'reasoning,tool', 0, 85),
    (900000000000003042, 'volcengine_ark', 'volcengine-ark', 'contains', 'doubao-seed-code', 'Doubao Code', 'Doubao Code', '文本生成-代码', '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', '{"requestShape":"openai_chat_compatible","endpointPath":"/chat/completions","method":"POST","modelField":"model","inputContainer":"messages","extraBodyFields":[{"key":"enableThinking","label":"开启思考","type":"boolean","feature":"thinking","wirePath":"thinking.type","wireTransform":"boolean:enabled_disabled"}]}', '{"responseShape":"openai_chat_completion","resultMapping":{"text":"choices[0].message.content","usage":"usage"}}', '{"nodeKind":"language_model","interactionMode":"sync","primaryInput":"messages"}', 'reasoning,tool', 0, 127),
    (900000000000003043, 'volcengine_ark', 'volcengine-ark', 'contains', 'vision', 'Doubao Vision', 'Doubao Vision', '视觉理解', '/resource/v1/ai-application/doubao.png', 'https://ark.cn-beijing.volces.com/api/v3', 'openai', '{"requestShape":"openai_chat_compatible","endpointPath":"/chat/completions","method":"POST","modelField":"model","inputContainer":"messages","extraBodyFields":[{"key":"enableThinking","label":"开启思考","type":"boolean","feature":"thinking","wirePath":"thinking.type","wireTransform":"boolean:enabled_disabled"}]}', '{"responseShape":"openai_chat_completion","resultMapping":{"text":"choices[0].message.content","usage":"usage"}}', '{"nodeKind":"language_model","interactionMode":"sync","primaryInput":"messages"}', 'reasoning,vision,tool', 0, 126)
ON DUPLICATE KEY UPDATE
    `normalized_name` = VALUES(`normalized_name`),
    `display_name_template` = VALUES(`display_name_template`),
    `group_name` = VALUES(`group_name`),
    `icon_url` = VALUES(`icon_url`),
    `api_base_url` = VALUES(`api_base_url`),
    `endpoint_type` = VALUES(`endpoint_type`),
    `request_schema_json` = VALUES(`request_schema_json`),
    `response_schema_json` = VALUES(`response_schema_json`),
    `dsl_schema_json` = VALUES(`dsl_schema_json`),
    `model_types` = VALUES(`model_types`),
    `is_free` = VALUES(`is_free`),
    `priority` = VALUES(`priority`),
    `update_time` = CURRENT_TIMESTAMP;

UPDATE `ai_system_llm_model_match_rule`
SET `native_family` = 'seedream',
    `channel_profile` = 'direct',
    `adapter_key` = 'volcengine_ark.openai_image'
WHERE `provider_type_code` = 'volcengine_ark'
  AND `provider_code` = 'volcengine-ark'
  AND `match_type` = 'prefix'
  AND `pattern` = 'doubao-seedream'
  AND (`deleted` IS NULL OR `deleted` = 0);

UPDATE `ai_system_llm_model_match_rule`
SET `native_family` = 'qwen3',
    `channel_profile` = 'direct',
    `adapter_key` = 'openai.chat'
WHERE `provider_type_code` = 'volcengine_ark'
  AND `provider_code` = 'volcengine-ark'
  AND `match_type` = 'prefix'
  AND `pattern` = 'qwen'
  AND (`deleted` IS NULL OR `deleted` = 0);
