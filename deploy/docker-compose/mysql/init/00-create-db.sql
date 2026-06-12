-- 仅确保数据库存在（MYSQL_DATABASE 环境变量已在 Docker entrypoint 中创建，此文件作为兜底）。
-- Schema 迁移由应用启动时 mysql-migration runner 执行（ADR-0017）。
CREATE DATABASE IF NOT EXISTS cube_ai_center CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
