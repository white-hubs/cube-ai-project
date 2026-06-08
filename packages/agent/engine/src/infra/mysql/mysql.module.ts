import { Module } from '@dangao/bun-server';
import { MYSQL_POOL_TOKEN } from './mysql.tokens';
import { createMysqlPoolFromEnv } from './mysql-pool.factory';

/**
 * Registers optional MySQL pool from `AGENTIC_ENGINE_MYSQL_URL`.
 * Pool is omitted when unset (local dev / tests inject mocks via overrides).
 */
@Module({
  providers: [
    {
      provide: MYSQL_POOL_TOKEN,
      useFactory: () => createMysqlPoolFromEnv(),
    },
  ],
  exports: [MYSQL_POOL_TOKEN],
})
export class MysqlModule {}
