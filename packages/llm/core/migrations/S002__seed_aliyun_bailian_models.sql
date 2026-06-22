-- 阿里云百炼（内置供应商 aliyun-bailian）系统模型目录种子（ADR-0017：S 类文件，随启动幂等重跑）
-- 模型能力分类参考：https://help.aliyun.com/zh/model-studio/models
-- 文生图模型参考：https://help.aliyun.com/zh/model-studio/text-to-image
-- 文本模型参考：https://help.aliyun.com/zh/model-studio/text-generation-model
-- 依赖：表由 V001__init.sql 建立；provider/type（aliyun-bailian / dashscope）由先跑的 S001__system_seed.sql 建立。
-- 所有 INSERT 使用 ON DUPLICATE KEY UPDATE，严格幂等。

SET NAMES utf8mb4;

-- group_name 表示「模型作用」分组，便于模型管理页展示
-- model_types：reasoning=文本推理, vision=视觉理解, image_generation=文生图, video_generation=视频,
--   embedding=向量, rerank=重排序, speech_synthesis=语音合成, speech_recognition=语音识别, music_generation=音乐, tool=工具调用

INSERT INTO `ai_system_llm_model` (`id`, `system_provider_id`, `model_code`, `display_name`, `group_name`, `sort_order`, `icon_url`, `api_base_url`, `endpoint_type`, `model_types`, `is_free`, `supports_test`)
VALUES
    -- 文本生成 · 千问 3.6
    (900000000000002101, 900000000000001007, 'qwen3.6-max-preview', 'Qwen3.6 Max Preview', '文本生成-千问3.6', 10, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002102, 900000000000001007, 'qwen3.6-plus', 'Qwen3.6 Plus', '文本生成-千问3.6', 11, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002103, 900000000000001007, 'qwen3.6-flash', 'Qwen3.6 Flash', '文本生成-千问3.6', 12, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002104, 900000000000001007, 'qwen3.6-plus-2026-04-02', 'Qwen3.6 Plus 2026-04-02', '文本生成-千问3.6', 13, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002105, 900000000000001007, 'qwen3.6-flash-2026-04-16', 'Qwen3.6 Flash 2026-04-16', '文本生成-千问3.6', 14, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    -- 文本生成 · 千问 3.5
    (900000000000002106, 900000000000001007, 'qwen3.5-plus', 'Qwen3.5 Plus', '文本生成-千问3.5', 20, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002107, 900000000000001007, 'qwen3.5-flash', 'Qwen3.5 Flash', '文本生成-千问3.5', 21, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002108, 900000000000001007, 'qwen3.5-plus-2026-02-15', 'Qwen3.5 Plus 2026-02-15', '文本生成-千问3.5', 22, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002109, 900000000000001007, 'qwen3.5-flash-2026-02-23', 'Qwen3.5 Flash 2026-02-23', '文本生成-千问3.5', 23, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    -- 文本生成 · 三方（OpenAI 兼容）
    (900000000000002110, 900000000000001007, 'deepseek-v4-pro', 'DeepSeek V4 Pro', '文本生成-三方模型', 30, '/resource/v1/ai-application/deepseek.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002111, 900000000000001007, 'deepseek-v4-flash', 'DeepSeek V4 Flash', '文本生成-三方模型', 31, '/resource/v1/ai-application/deepseek.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002112, 900000000000001007, 'glm-5.1', 'GLM 5.1', '文本生成-三方模型', 32, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002113, 900000000000001007, 'glm-5', 'GLM 5', '文本生成-三方模型', 33, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002114, 900000000000001007, 'kimi-k2.6', 'Kimi K2.6', '文本生成-三方模型', 34, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002115, 900000000000001007, 'MiniMax-M2.5', 'MiniMax M2.5', '文本生成-三方模型', 35, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002116, 900000000000001007, 'deepseek-v3.2', 'DeepSeek V3.2', '文本生成-三方模型', 36, '/resource/v1/ai-application/deepseek.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    -- 视觉理解（图文/视频理解，画布语言模型可选）
    (900000000000002120, 900000000000001007, 'qwen3.5-omni-plus', 'Qwen3.5 Omni Plus', '视觉理解', 50, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,vision,tool', 0, 1),
    (900000000000002121, 900000000000001007, 'qwen3.5-omni-plus-realtime', 'Qwen3.5 Omni Plus Realtime', '全模态-实时', 51, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,vision,tool', 0, 0),
    -- 文生图（图像生成节点）
    (900000000000002130, 900000000000001007, 'qwen-image-2.0-pro', 'Qwen Image 2.0 Pro', '文生图', 60, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', 'dashscope_text2image', 'image_generation', 0, 0),
    (900000000000002131, 900000000000001007, 'wan2.7-image-pro', 'Wan 2.7 Image Pro', '文生图', 61, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', 'dashscope_text2image', 'image_generation', 0, 0),
    (900000000000002132, 900000000000001007, 'wan2.7-image', 'Wan 2.7 Image', '文生图', 62, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', 'dashscope_text2image', 'image_generation', 0, 0),
    (900000000000002133, 900000000000001007, 'wan2.6-image', 'Wan 2.6 Image', '文生图', 63, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', 'dashscope_text2image', 'image_generation', 0, 0),
    (900000000000002134, 900000000000001007, 'wan2.6-t2i', 'Wan 2.6 T2I', '文生图', 64, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', 'dashscope_text2image', 'image_generation', 0, 0),
    (900000000000002135, 900000000000001007, 'z-image-turbo', 'Z-Image Turbo', '文生图', 65, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', 'dashscope_text2image', 'image_generation', 0, 0),
    -- 视频生成（目录展示；流程节点待后续接入）
    (900000000000002140, 900000000000001007, 'happyhorse-1.0-t2v', 'HappyHorse 1.0 T2V', '视频生成', 70, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', NULL, 'video_generation', 0, 0),
    (900000000000002141, 900000000000001007, 'happyhorse-1.0-i2v', 'HappyHorse 1.0 I2V', '视频生成', 71, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', NULL, 'video_generation', 0, 0),
    (900000000000002142, 900000000000001007, 'happyhorse-1.0-r2v', 'HappyHorse 1.0 R2V', '视频生成', 72, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', NULL, 'video_generation', 0, 0),
    (900000000000002143, 900000000000001007, 'happyhorse-1.0-video-edit', 'HappyHorse 1.0 Video Edit', '视频生成', 73, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', NULL, 'video_generation', 0, 0),
    -- 向量与重排序
    (900000000000002150, 900000000000001007, 'text-embedding-v4', 'Text Embedding V4', '向量', 80, '/resource/v1/ai-application/getModel.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'embedding', 0, 0),
    (900000000000002151, 900000000000001007, 'tongyi-embedding-vision-plus', 'Tongyi Embedding Vision Plus', '向量', 81, '/resource/v1/ai-application/getModel.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'embedding,vision', 0, 0),
    (900000000000002152, 900000000000001007, 'qwen3-rerank', 'Qwen3 Rerank', '重排序', 82, '/resource/v1/ai-application/getModel.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'jina_rerank', 'rerank', 0, 0),
    -- 语音 / 音乐
    (900000000000002160, 900000000000001007, 'cosyvoice-v3.5-plus', 'CosyVoice V3.5 Plus', '语音合成', 90, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', NULL, 'speech_synthesis', 0, 0),
    (900000000000002161, 900000000000001007, 'fun-asr-realtime', 'Fun ASR Realtime', '语音识别', 91, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', NULL, 'speech_recognition', 0, 0),
    (900000000000002162, 900000000000001007, 'fun-asr', 'Fun ASR', '语音识别', 92, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', NULL, 'speech_recognition', 0, 0),
    (900000000000002163, 900000000000001007, 'fun-music-v1', 'Fun Music V1', '音乐生成', 93, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', NULL, 'music_generation', 0, 0),
    -- 兼容旧版（仍可通过 OpenAI 兼容接口调用）
    (900000000000002009, 900000000000001007, 'qwen-plus', 'Qwen Plus', '文本生成-旧版千问', 200, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1),
    (900000000000002010, 900000000000001007, 'qwen-max', 'Qwen Max', '文本生成-旧版千问', 201, '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', 'reasoning,tool', 0, 1)
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
    (900000000000003017, 'dashscope', 'aliyun-bailian', 'prefix', 'qwen3.6', 'Qwen3.6', 'Qwen3.6', '文本生成-千问3.6', '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', '{"requestShape":"openai_chat_compatible","endpointPath":"/chat/completions","method":"POST","modelField":"model","inputContainer":"messages","extraBodyFields":[{"key":"enableThinking","label":"开启思考","type":"boolean","feature":"thinking","wirePath":"enable_thinking"}]}', '{"responseShape":"openai_chat_completion","resultMapping":{"text":"choices[0].message.content","finishReason":"choices[0].finish_reason","usage":"usage"}}', '{"nodeKind":"language_model","interactionMode":"sync","primaryInput":"messages"}', 'reasoning,tool', 0, 88),
    (900000000000003018, 'dashscope', 'aliyun-bailian', 'prefix', 'qwen3.5', 'Qwen3.5', 'Qwen3.5', '文本生成-千问3.5', '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', '{"requestShape":"openai_chat_compatible","endpointPath":"/chat/completions","method":"POST","modelField":"model","inputContainer":"messages","extraBodyFields":[{"key":"enableThinking","label":"开启思考","type":"boolean","feature":"thinking","wirePath":"enable_thinking"}]}', '{"responseShape":"openai_chat_completion","resultMapping":{"text":"choices[0].message.content","finishReason":"choices[0].finish_reason","usage":"usage"}}', '{"nodeKind":"language_model","interactionMode":"sync","primaryInput":"messages"}', 'reasoning,tool', 0, 88),
    (900000000000003019, 'dashscope', 'aliyun-bailian', 'prefix', 'wan2.', 'Wan', 'Wan', '文生图', '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', 'dashscope_text2image', '{"requestShape":"dashscope_multimodal_generation","endpointPath":"/api/v1/services/aigc/multimodal-generation/generation","method":"POST","modelField":"model","inputContainer":"input","parameterContainer":"parameters","inputMapping":{"messagesPath":"input.messages","userTextPath":"input.messages[0].content[0].text"},"fields":[{"key":"negative_prompt","label":"反向提示词","type":"string"},{"key":"size","label":"分辨率","type":"string"}]}', '{"responseShape":"dashscope_multimodal_image_generation","resultMapping":{"imageUrl":"output.choices[0].message.content[0].image","usage":"usage"},"polling":{"enabled":false}}', '{"nodeKind":"image_generation","interactionMode":"sync","primaryInput":"prompt","inputs":[{"key":"prompt","type":"string","required":true}],"outputs":[{"key":"imageUrl","type":"string"}]}', 'image_generation', 0, 112),
    (900000000000003020, 'dashscope', 'aliyun-bailian', 'prefix', 'z-image', 'Z-Image', 'Z-Image', '文生图', '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', 'dashscope_text2image', '{"requestShape":"dashscope_multimodal_generation","endpointPath":"/api/v1/services/aigc/multimodal-generation/generation","method":"POST","modelField":"model","inputContainer":"input","parameterContainer":"parameters","inputMapping":{"messagesPath":"input.messages","userTextPath":"input.messages[0].content[0].text"},"fields":[{"key":"size","label":"分辨率","type":"string"}]}', '{"responseShape":"dashscope_multimodal_image_generation","resultMapping":{"imageUrl":"output.choices[0].message.content[0].image","usage":"usage"},"polling":{"enabled":false}}', '{"nodeKind":"image_generation","interactionMode":"sync","primaryInput":"prompt","inputs":[{"key":"prompt","type":"string","required":true}],"outputs":[{"key":"imageUrl","type":"string"}]}', 'image_generation', 0, 112),
    (900000000000003021, 'dashscope', 'aliyun-bailian', 'contains', 'happyhorse', 'HappyHorse', 'HappyHorse', '视频生成', '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', NULL, NULL, NULL, NULL, 'video_generation', 0, 105),
    (900000000000003022, 'dashscope', 'aliyun-bailian', 'prefix', 'text-embedding', 'Text Embedding', 'Embedding', '向量', '/resource/v1/ai-application/getModel.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', NULL, NULL, NULL, 'embedding', 0, 125),
    (900000000000003023, 'dashscope', 'aliyun-bailian', 'prefix', 'tongyi-embedding', 'Tongyi Embedding', 'Embedding', '向量', '/resource/v1/ai-application/getModel.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', NULL, NULL, NULL, 'embedding,vision', 0, 125),
    (900000000000003024, 'dashscope', 'aliyun-bailian', 'prefix', 'qwen3-rerank', 'Qwen Rerank', 'Rerank', '重排序', '/resource/v1/ai-application/getModel.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'jina_rerank', NULL, NULL, NULL, 'rerank', 0, 125),
    (900000000000003025, 'dashscope', 'aliyun-bailian', 'prefix', 'cosyvoice', 'CosyVoice', 'CosyVoice', '语音合成', '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', NULL, NULL, NULL, NULL, 'speech_synthesis', 0, 105),
    (900000000000003026, 'dashscope', 'aliyun-bailian', 'prefix', 'fun-asr', 'Fun ASR', 'ASR', '语音识别', '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', NULL, NULL, NULL, NULL, 'speech_recognition', 0, 105),
    (900000000000003027, 'dashscope', 'aliyun-bailian', 'prefix', 'fun-music', 'Fun Music', 'Music', '音乐生成', '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com', NULL, NULL, NULL, NULL, 'music_generation', 0, 105),
    (900000000000003028, 'dashscope', 'aliyun-bailian', 'contains', 'omni', 'Qwen Omni', 'Qwen Omni', '视觉理解', '/resource/v1/ai-application/qwen.png', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai', '{"requestShape":"openai_chat_compatible","endpointPath":"/chat/completions","method":"POST","modelField":"model","inputContainer":"messages"}', '{"responseShape":"openai_chat_completion","resultMapping":{"text":"choices[0].message.content","usage":"usage"}}', '{"nodeKind":"language_model","interactionMode":"sync","primaryInput":"messages"}', 'reasoning,vision,tool', 0, 95)
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
SET `native_family` = 'qwen3',
    `channel_profile` = 'direct',
    `adapter_key` = 'openai.chat'
WHERE `provider_type_code` = 'dashscope'
  AND `provider_code` = 'aliyun-bailian'
  AND `match_type` = 'prefix'
  AND `pattern` IN ('qwen3.6', 'qwen3.5')
  AND (`deleted` IS NULL OR `deleted` = 0);

UPDATE `ai_system_llm_model_match_rule`
SET `native_family` = 'wan',
    `channel_profile` = 'direct',
    `adapter_key` = 'dashscope.multimodal_image'
WHERE `provider_type_code` = 'dashscope'
  AND `provider_code` = 'aliyun-bailian'
  AND `match_type` = 'prefix'
  AND `pattern` IN ('wan2.', 'z-image')
  AND (`deleted` IS NULL OR `deleted` = 0);
