import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { InMemoryCatalogStore } from "../../packages/llm/core/src/catalog/in-memory-catalog.store";
import type { CatalogMysqlPool } from "../../packages/llm/core/src/catalog/repositories";
import {
  loadGhcloudCatalogSourceFromFile,
  mapGhcloudCatalogToLlmCore,
  migrateCatalog,
  parseCatalogMigrateCliArgs,
  writeCatalogToMysql,
} from "./catalog-migrate";

const fixturePath = fileURLToPath(new URL("./fixtures/sample-ghcloud-catalog.json", import.meta.url));

/** 记录所有 SQL 的假 Pool，用于离线校验写入路径而不连真实 MySQL。 */
class RecordingPool implements CatalogMysqlPool {
  readonly calls: Array<{ sql: string; values?: unknown[] }> = [];
  async query(sql: string, values?: unknown[]): Promise<[unknown, unknown]> {
    // 防回归：INSERT/UPDATE 的 `?` 占位符数量必须与传入值数量一致
    // （真实 MySQL 会以 ER_WRONG_VALUE_COUNT_ON_ROW 报错，离线 mock 默认发现不了）。
    if (values && /\b(INSERT|UPDATE)\b/i.test(sql)) {
      const placeholders = (sql.match(/\?/g) ?? []).length;
      if (placeholders !== values.length) {
        throw new Error(`SQL 占位符(${placeholders}) 与值(${values.length}) 数量不匹配: ${sql.replace(/\s+/g, " ").slice(0, 120)}…`);
      }
    }
    this.calls.push({ sql, values });
    return [[], []];
  }
}

describe("catalog-migrate dry-run", () => {
  test("maps ghcloud rows to llm-core entity ids as strings", async () => {
    const source = await loadGhcloudCatalogSourceFromFile(fixturePath);
    const { seed } = mapGhcloudCatalogToLlmCore(source);

    expect(seed.systemTypes?.[0]?.id).toBe("1");
    expect(seed.systemProviders?.[0]?.id).toBe("10");
    expect(seed.tenantProviders?.[0]?.api_key).toBe("sk-exported");
    expect(seed.tenantModels?.[0]?.system_model_id).toBe("100");
  });

  test("dry-run (mysql target) returns counts without connecting", async () => {
    const source = await loadGhcloudCatalogSourceFromFile(fixturePath);
    const result = await migrateCatalog({ source, dryRun: true, target: "mysql" });

    expect(result.dryRun).toBe(true);
    expect(result.counts).toEqual({
      systemTypes: 1,
      systemProviders: 1,
      systemModels: 1,
      matchRules: 1,
      tenantProviders: 1,
      tenantModels: 1,
    });
  });

  test("in-memory seed loads into InMemoryCatalogStore", async () => {
    const source = await loadGhcloudCatalogSourceFromFile(fixturePath);
    const { seed } = mapGhcloudCatalogToLlmCore(source);
    const store = new InMemoryCatalogStore(seed);

    expect(store.listTenantProviders(900001)).toHaveLength(1);
    expect(store.findTenantModelByCode(900001, "gpt-4o")?.model_code).toBe("gpt-4o");
  });

  test("mysql write path emits real columnar DDL + system/tenant upserts with credentials", async () => {
    const source = await loadGhcloudCatalogSourceFromFile(fixturePath);
    const pool = new RecordingPool();

    await writeCatalogToMysql(pool, source);

    const ddl = pool.calls.filter((c) => /CREATE TABLE IF NOT EXISTS/i.test(c.sql));
    expect(ddl.length).toBe(6);

    // 系统目录写真实列式表
    expect(pool.calls.some((c) => /INSERT INTO ai_system_llm_provider_type/i.test(c.sql))).toBe(true);
    expect(pool.calls.some((c) => /INSERT INTO ai_system_llm_model\b/i.test(c.sql))).toBe(true);

    // 租户供应商：保留原 id/tenant + 凭据
    const tenantProviderInsert = pool.calls.find((c) => /INSERT INTO ai_application_tenant_llm_provider/i.test(c.sql));
    expect(tenantProviderInsert?.values).toContain("sk-exported");

    // 租户模型：model_code 列
    const tenantModelInsert = pool.calls.find((c) => /INSERT INTO ai_application_tenant_llm_model/i.test(c.sql));
    expect(tenantModelInsert?.values).toContain("gpt-4o");
  });

  test("parseCatalogMigrateCliArgs recognizes --dry-run and mysql target", () => {
    const parsed = parseCatalogMigrateCliArgs([
      "--source",
      "/tmp/export.json",
      "--dry-run",
      "--target",
      "mysql",
      "--mysql-url",
      "mysql://u:p@h:3306/db",
    ]);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.sourcePath).toBe("/tmp/export.json");
    expect(parsed.target).toBe("mysql");
    expect(parsed.mysqlUrl).toBe("mysql://u:p@h:3306/db");
  });
});
