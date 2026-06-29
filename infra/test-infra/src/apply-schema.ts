import { join } from "node:path";

import { createMigrationRunner } from "@cube-ai/mysql-migration";

import { testInfraLog } from "./log";
import { findMonorepoRoot } from "./repo-path";

function isTransientMysqlConnectErr(e: unknown): boolean {
  const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
  const msg = e instanceof Error ? e.message : String(e);
  return (
    code === "PROTOCOL_CONNECTION_LOST" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    msg.includes("PROTOCOL_CONNECTION_LOST") ||
    msg.includes("ECONNREFUSED")
  );
}

function repoRoot(): string {
  return findMonorepoRoot(import.meta.dirname);
}

async function runMigrationsWithRetry(mysqlUrl: string, migrationsDir: string, historyTable: string): Promise<void> {
  const maxAttempts = 30;
  const delayMs = 500;
  // MySQL testcontainers often accept TCP before the first session is stable.
  await new Promise((r) => setTimeout(r, 300));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await createMigrationRunner({ historyTable, migrationsDir, mysqlUrl }).run();
      testInfraLog(`Migrations applied: ${historyTable}.`);
      return;
    } catch (e) {
      if (!isTransientMysqlConnectErr(e) || attempt === maxAttempts) {
        throw e;
      }
      testInfraLog(
        `${historyTable}: transient error (attempt ${attempt}/${maxAttempts}), retry in ${delayMs}ms — ${e instanceof Error ? e.message : String(e)}`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/**
 * engine 域 schema —— 走生产同款 migration runner（ADR-0017），
 * 唯一权威 = `packages/agent/engine/migrations/`，与 `apps/ai-center/src/migrations.ts` 对齐。
 */
export async function applyMinimalMysqlSchema(mysqlUrl: string): Promise<void> {
  testInfraLog("Applying engine domain migrations (sessions/turns/jobs/grants/outbox…)…");
  await runMigrationsWithRetry(mysqlUrl, join(repoRoot(), "packages/agent/engine/migrations"), "engine_schema_migrations");
}

/**
 * `grants` 表（AuthZ MySQL 持久化）已含在 engine V001 中；保留此入口兼容既有测试，
 * 幂等 —— runner 经 history 表跳过已应用版本。
 */
export async function applyGrantsMysqlSchema(mysqlUrl: string): Promise<void> {
  await applyMinimalMysqlSchema(mysqlUrl);
}

/**
 * flow / kb / llm-catalog 域表 + engine schema，供 ai-center 集成测试。
 * 使用 mysql-migration runner（ADR-0017），与应用启动路径完全对齐。
 */
export async function applyAiCenterDomainMysqlSchemas(mysqlUrl: string): Promise<void> {
  await applyMinimalMysqlSchema(mysqlUrl);

  const root = repoRoot();
  const domainMigrations = [
    { historyTable: "flow_schema_migrations", migrationsDir: join(root, "packages/flow/core/migrations") },
    { historyTable: "llm_catalog_schema_migrations", migrationsDir: join(root, "packages/llm/core/migrations") },
    { historyTable: "kb_schema_migrations", migrationsDir: join(root, "packages/kb/core/migrations") },
    { historyTable: "flow_studio_schema_migrations", migrationsDir: join(root, "packages/flow/studio/migrations") },
  ];

  for (const domain of domainMigrations) {
    testInfraLog(`Applying migrations: ${domain.historyTable}…`);
    await createMigrationRunner({ mysqlUrl, ...domain }).run();
  }
}
