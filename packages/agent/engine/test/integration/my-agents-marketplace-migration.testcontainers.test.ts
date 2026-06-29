import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type Pool, type RowDataPacket, createPool } from "mysql2/promise";

import {
  type MysqlRedisStack,
  applyMinimalMysqlSchema,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlRedis,
  stopTrackedTestcontainersIfAny,
} from "@cube-ai/test-infra";

/**
 * My Agents / Library marketplace schema (ADR-0030) — MySQL Testcontainers.
 *
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/my-agents-marketplace-migration.testcontainers.test.ts
 */

const run = await resolveShouldRunTestcontainers();
const stackHolder: { current: MysqlRedisStack | null } = { current: null };
const HOOK_MS = 1_800_000;

if (run) {
  setDefaultTimeout(3_600_000);
  registerProcessShutdown(
    async () => {
      await stopTrackedTestcontainersIfAny();
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
    },
    { exitProcessAfterSignal: true },
  );
}

async function tableNames(pool: Pool): Promise<Set<string>> {
  const [rows] = await pool.query<RowDataPacket[]>("SHOW TABLES");
  return new Set(rows.map((row) => String(Object.values(row)[0])));
}

async function columnNames(pool: Pool, table: string): Promise<Set<string>> {
  const [rows] = await pool.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${table}\``);
  return new Set(rows.map((row) => String(row.Field)));
}

async function indexNames(pool: Pool, table: string): Promise<Set<string>> {
  const [rows] = await pool.query<RowDataPacket[]>(`SHOW INDEX FROM \`${table}\``);
  return new Set(rows.map((row) => String(row.Key_name)));
}

(run ? describe : describe.skip)("My Agents marketplace migration [testcontainers]", () => {
  beforeAll(async () => {
    const s = await startMysqlRedis();
    try {
      await applyMinimalMysqlSchema(s.mysqlUrl);
      stackHolder.current = s;
    } catch (e) {
      await s.stop();
      throw e;
    }
  }, HOOK_MS);

  afterAll(async () => {
    if (stackHolder.current) {
      await stackHolder.current.stop().catch(() => {});
      stackHolder.current = null;
    }
    await stopTrackedTestcontainersIfAny();
  });

  test(
    "V005 adds owner/draft columns and marketplace projection tables",
    async () => {
      const s = stackHolder.current!;
      await applyMinimalMysqlSchema(s.mysqlUrl);

      const pool = createPool({
        bigNumberStrings: true,
        connectionLimit: 2,
        supportBigNumbers: true,
        uri: s.mysqlUrl,
      });

      try {
        const descriptorColumns = await columnNames(pool, "tenant_descriptors");
        expect(descriptorColumns).toContain("owner_user_id");
        expect(descriptorColumns).toContain("draft_content_json");
        expect(descriptorColumns).toContain("copied_from");
        expect(await indexNames(pool, "tenant_descriptors")).toContain("idx_tenant_kind_owner");

        const tables = await tableNames(pool);
        expect(tables).toContain("descriptor_listing");
        expect(tables).toContain("user_descriptor_shelf");
        expect(tables).toContain("user_available_tool");

        expect(await columnNames(pool, "descriptor_listing")).toEqual(
          new Set([
            "descriptor_id",
            "tenant",
            "listed",
            "shared_version_no",
            "publisher_user_id",
            "listed_time",
            "unlisted_time",
            "create_by",
            "create_time",
            "update_by",
            "update_time",
          ]),
        );
        expect(await columnNames(pool, "user_descriptor_shelf")).toEqual(
          new Set([
            "id",
            "tenant",
            "user_id",
            "target_kind",
            "target_id",
            "source",
            "pin_version_no",
            "enabled",
            "deleted",
            "create_by",
            "create_time",
            "update_by",
            "update_time",
          ]),
        );
        expect(await columnNames(pool, "user_available_tool")).toEqual(
          new Set(["id", "tenant", "user_id", "tool_name", "enabled", "deleted", "create_by", "create_time", "update_by", "update_time"]),
        );

        const [history] = await pool.query<RowDataPacket[]>(`SELECT filename FROM engine_schema_migrations WHERE version = '005'`);
        expect(history[0]?.filename).toBe("V005__my_agents_marketplace.sql");
      } finally {
        await pool.end();
      }
    },
    HOOK_MS,
  );
});
