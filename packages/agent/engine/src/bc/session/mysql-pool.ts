import type { Pool } from 'mysql2/promise';
import { createMysqlPoolFromEnv } from '../../infra/mysql/mysql-pool.factory';

/**
 * Shared MySQL pool for Session / Turn persistence（与 Infra {@link createMysqlPoolFromEnv} 同源，避免重复解析 env）。
 */
export function createEngineMysqlPool(): Pool | null {
  return createMysqlPoolFromEnv();
}
