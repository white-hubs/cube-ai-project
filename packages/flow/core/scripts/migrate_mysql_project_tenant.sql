-- 将租户键从 projects.id 迁移到 projects.project_id（slug），并回填子表。
-- 在维护窗口执行；执行前请备份数据库。

-- 1) 为 projects 回填 tenant project_id（未设置时）
UPDATE `projects`
SET `project_id` = CONCAT('p', REPLACE(`id`, '-', ''))
WHERE (`project_id` IS NULL OR TRIM(`project_id`) = '') AND `deleted` = 0;

-- 2) 子表：将原先存的内部 id 换为租户 project_id（JOIN 当前未删除的 projects）
UPDATE `flows` f
INNER JOIN `projects` p ON f.`project_id` = p.`id` AND p.`deleted` = 0
SET f.`project_id` = p.`project_id`;

UPDATE `flow_graphs` g
INNER JOIN `projects` p ON g.`project_id` = p.`id` AND p.`deleted` = 0
SET g.`project_id` = p.`project_id`;

UPDATE `playground_sessions` s
INNER JOIN `projects` p ON s.`project_id` = p.`id` AND p.`deleted` = 0
SET s.`project_id` = p.`project_id`;

UPDATE `playground_messages` m
INNER JOIN `projects` p ON m.`project_id` = p.`id` AND p.`deleted` = 0
SET m.`project_id` = p.`project_id`;

UPDATE `custom_component_templates` t
INNER JOIN `projects` p ON t.`project_id` = p.`id` AND p.`deleted` = 0
SET t.`project_id` = p.`project_id`;

UPDATE `api_keys` k
INNER JOIN `projects` p ON k.`project_id` = p.`id` AND p.`deleted` = 0
SET k.`project_id` = p.`project_id`
WHERE COALESCE(k.`access_level`, 'project') != 'system';

UPDATE `auth_users` u
INNER JOIN `projects` p ON u.`default_project_id` = p.`id` AND p.`deleted` = 0
SET u.`default_project_id` = p.`project_id`;

UPDATE `oauth_access_tokens` t
INNER JOIN `projects` p ON t.`project_id` = p.`id` AND p.`deleted` = 0
SET t.`project_id` = p.`project_id`;

UPDATE `oauth_refresh_tokens` t
INNER JOIN `projects` p ON t.`project_id` = p.`id` AND p.`deleted` = 0
SET t.`project_id` = p.`project_id`;

UPDATE `webhook_invocations` w
INNER JOIN `projects` p ON w.`project_id` = p.`id` AND p.`deleted` = 0
SET w.`project_id` = p.`project_id`;

UPDATE `app_kv` k
INNER JOIN `projects` p ON k.`project_id` = p.`id` AND p.`deleted` = 0
SET k.`project_id` = p.`project_id`;

-- 3) 知识库（若同库）
UPDATE `document_directory_record` d
INNER JOIN `projects` p ON d.`project_id` = p.`id` AND p.`deleted` = 0
SET d.`project_id` = p.`project_id`;

UPDATE `document_record` d
INNER JOIN `projects` p ON d.`project_id` = p.`id` AND p.`deleted` = 0
SET d.`project_id` = p.`project_id`;

UPDATE `document_chunk` d
INNER JOIN `projects` p ON d.`project_id` = p.`id` AND p.`deleted` = 0
SET d.`project_id` = p.`project_id`;

UPDATE `document_import_job` d
INNER JOIN `projects` p ON d.`project_id` = p.`id` AND p.`deleted` = 0
SET d.`project_id` = p.`project_id`;

-- 4) 约束与类型（按实际 MySQL 版本调整；若 uk_projects_tenant_project_id 已存在则跳过）
-- ALTER TABLE `projects` MODIFY `project_id` VARCHAR(64) NOT NULL;
-- CREATE UNIQUE INDEX `uk_projects_tenant_project_id` ON `projects` (`project_id`);

-- ALTER TABLE `playground_messages` MODIFY `id` BIGINT(20) UNSIGNED NOT NULL;
-- ALTER TABLE `api_keys` MODIFY `id` BIGINT(20) UNSIGNED NOT NULL;
