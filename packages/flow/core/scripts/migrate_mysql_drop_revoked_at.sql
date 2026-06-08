-- 将 api_keys / oauth 的作废语义从 revoked_at 迁到 deleted（与 Cube 其它表一致）。
-- 在已有库上执行一次；新建库请直接使用 init_mysql.sql。

-- api_keys：已撤销行写入 deleted 时间戳（毫秒，与应用层 deletedValue() 一致）
UPDATE `api_keys`
SET `deleted` = UNIX_TIMESTAMP(`revoked_at`) * 1000
WHERE `revoked_at` IS NOT NULL;

ALTER TABLE `api_keys` DROP COLUMN `revoked_at`;

UPDATE `oauth_access_tokens`
SET `deleted` = UNIX_TIMESTAMP(`revoked_at`) * 1000
WHERE `revoked_at` IS NOT NULL;

ALTER TABLE `oauth_access_tokens` DROP COLUMN `revoked_at`;

UPDATE `oauth_refresh_tokens`
SET `deleted` = UNIX_TIMESTAMP(`revoked_at`) * 1000
WHERE `revoked_at` IS NOT NULL;

ALTER TABLE `oauth_refresh_tokens` DROP COLUMN `revoked_at`;
