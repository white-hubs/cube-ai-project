import { join } from "node:path";

import { createMigrationRunner } from "@cube-ai/mysql-migration";

/**
 * 项目根目录。
 * - source 模式（runtime-source）：import.meta.url 是源文件路径，../../../ 正好上溯到根
 * - binary 模式（runtime-binary / runtime-binary-prebuilt）：import.meta.url 是二进制路径，
 *   相对计算失效，必须通过 AGENTIC_ENGINE_MIGRATIONS_ROOT 显式传入
 */
const root = process.env["AGENTIC_ENGINE_MIGRATIONS_ROOT"] ?? new URL("../../../", import.meta.url).pathname;

const DOMAIN_MIGRATIONS = [
  { historyTable: "engine_schema_migrations", migrationsDir: join(root, "packages/agent/engine/migrations") },
  { historyTable: "flow_schema_migrations", migrationsDir: join(root, "packages/flow/core/migrations") },
  { historyTable: "llm_catalog_schema_migrations", migrationsDir: join(root, "packages/llm/core/migrations") },
  { historyTable: "kb_schema_migrations", migrationsDir: join(root, "packages/kb/core/migrations") },
  { historyTable: "flow_studio_schema_migrations", migrationsDir: join(root, "packages/flow/studio/migrations") },
] as const;

export async function runAllDomainMigrations(mysqlUrl: string): Promise<void> {
  for (const domain of DOMAIN_MIGRATIONS) {
    await createMigrationRunner({ mysqlUrl, ...domain }).run();
  }
}
