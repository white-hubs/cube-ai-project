-- playground_sessions：移除 uk_playground_default_flow(flow_id, is_default, deleted)，
-- 改为「生成列 + 唯一索引」，与 SQLite 一致：每 flow 至多一条默认会话，允许多条非默认会话。
--
-- 在已有 MySQL 库上手动执行一次（MySQL 5.7.6+）。
-- 执行前请确认：同一 flow_id 下不存在两条 is_default=1 且 deleted=0 的记录，否则会 ADD UNIQUE 失败。
--
-- 新建库无需执行本文件，请直接使用 init_mysql.sql。

ALTER TABLE `playground_sessions` DROP INDEX `uk_playground_default_flow`;

ALTER TABLE `playground_sessions` ADD COLUMN `flow_default_scope` VARCHAR(64) GENERATED ALWAYS AS (
  CASE WHEN `is_default` = 1 AND `deleted` = 0 THEN `flow_id` ELSE NULL END
) STORED AFTER `last_message`;

ALTER TABLE `playground_sessions` ADD UNIQUE KEY `uk_playground_one_default_per_flow` (`flow_default_scope`);
