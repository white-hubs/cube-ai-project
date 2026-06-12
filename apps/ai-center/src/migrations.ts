import { join } from 'node:path';
import { createMigrationRunner } from '@cube-ai/mysql-migration';

const root = new URL('../../../../', import.meta.url).pathname;

const DOMAIN_MIGRATIONS = [
  { migrationsDir: join(root, 'packages/agent/engine/migrations'), historyTable: 'engine_schema_migrations' },
  { migrationsDir: join(root, 'packages/flow/core/migrations'),    historyTable: 'flow_schema_migrations' },
  { migrationsDir: join(root, 'packages/llm/core/migrations'),     historyTable: 'llm_catalog_schema_migrations' },
  { migrationsDir: join(root, 'packages/kb/core/migrations'),      historyTable: 'kb_schema_migrations' },
  { migrationsDir: join(root, 'packages/flow/studio/migrations'),  historyTable: 'flow_studio_schema_migrations' },
] as const;

export async function runAllDomainMigrations(mysqlUrl: string): Promise<void> {
  for (const domain of DOMAIN_MIGRATIONS) {
    await createMigrationRunner({ mysqlUrl, ...domain }).run();
  }
}
