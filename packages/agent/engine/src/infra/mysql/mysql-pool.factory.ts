import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';

/**
 * Build a lazy MySQL pool from env. No TCP handshake until first query (R24).
 *
 * `AGENTIC_ENGINE_MYSQL_URL` — URI form per mysql2 (`mysql://user:pass@host:3306/db`).
 */
export function createMysqlPoolFromEnv(): Pool | null {
  // 仅用 process.env：`spawn`/`exec` 注入的 URL 在此可见；Bun.env 在子进程里未必同步应用级变量。
  const url = process.env.AGENTIC_ENGINE_MYSQL_URL?.trim();
  if (!url) return null;
  // SFID 等 BIGINT 超过 JS 安全整数：必须以字符串表示，避免 JSON/路由中的精度丢失
  return mysql.createPool({
    uri: url,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
}
