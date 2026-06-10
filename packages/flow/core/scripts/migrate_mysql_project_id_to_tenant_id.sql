-- flow-core：存量 MySQL 库将 project_id 列改名为 tenant_id（ADR-0012 addendum）。
-- 新建库请直接使用 init_mysql.sql / deploy/docker-compose/mysql/init/02-flow.sql，无需执行本文件。
--
-- 适用：库中 flows 等表仍为 project_id，而代码已切换为 tenant_id 时。
-- 幂等：若列已是 tenant_id 则跳过（需手动逐表确认，或先 SHOW COLUMNS）。

USE agentic_engine;

ALTER TABLE `flows` CHANGE COLUMN `project_id` `tenant_id` VARCHAR(64) NOT NULL;
ALTER TABLE `flow_graphs` CHANGE COLUMN `project_id` `tenant_id` VARCHAR(64) NOT NULL;
ALTER TABLE `playground_sessions` CHANGE COLUMN `project_id` `tenant_id` VARCHAR(64) NOT NULL;
ALTER TABLE `playground_messages` CHANGE COLUMN `project_id` `tenant_id` VARCHAR(64) NOT NULL;
ALTER TABLE `custom_component_templates` CHANGE COLUMN `project_id` `tenant_id` VARCHAR(64) NOT NULL;
ALTER TABLE `webhook_invocations` CHANGE COLUMN `project_id` `tenant_id` VARCHAR(64) NOT NULL;
ALTER TABLE `app_kv` CHANGE COLUMN `project_id` `tenant_id` VARCHAR(64) NULL;
