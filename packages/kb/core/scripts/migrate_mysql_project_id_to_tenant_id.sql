-- kb-core：存量 MySQL 库将 project_id 列改名为 tenant_id（ADR-0012 addendum）。
-- 新建库请直接使用 kb-mysql-schema / deploy/docker-compose/mysql/init/04-kb.sql，无需执行本文件。
--
-- 适用：库中 document_* 表仍为 project_id，而代码已切换为 tenant_id 时。
-- 幂等：若列已是 tenant_id，对应 ALTER 会失败，可跳过该表。

USE agentic_engine;

ALTER TABLE `document_directory_record` CHANGE COLUMN `project_id` `tenant_id` VARCHAR(64) NULL;
ALTER TABLE `document_record` CHANGE COLUMN `project_id` `tenant_id` VARCHAR(64) NULL;
ALTER TABLE `document_import_job` CHANGE COLUMN `project_id` `tenant_id` VARCHAR(64) NULL;
ALTER TABLE `document_chunk` CHANGE COLUMN `project_id` `tenant_id` VARCHAR(64) NULL;
