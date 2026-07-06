import { describe, expect, test } from "bun:test";

import {
  mapLegacyTriggerToActivation,
  migrateSkillContentTriggerToActivation,
  migrateSkillTriggerToActivationInMysql,
  parseSkillActivationCliArgs,
  type MigrateMysqlPool,
} from "./skill-trigger-to-activation";

describe("mapLegacyTriggerToActivation", () => {
  test("maps known trigger values (explicit → manual)", () => {
    expect(mapLegacyTriggerToActivation("always")).toEqual({ mode: "always" });
    expect(mapLegacyTriggerToActivation("semantic")).toEqual({ mode: "semantic" });
    expect(mapLegacyTriggerToActivation("explicit")).toEqual({ mode: "manual" });
    expect(mapLegacyTriggerToActivation({ type: "explicit" })).toEqual({ mode: "manual" });
  });

  test("falls back to semantic for retired/unknown/missing values", () => {
    expect(mapLegacyTriggerToActivation("keyword")).toEqual({ mode: "semantic" });
    expect(mapLegacyTriggerToActivation("custom")).toEqual({ mode: "semantic" });
    expect(mapLegacyTriggerToActivation(undefined)).toEqual({ mode: "semantic" });
    expect(mapLegacyTriggerToActivation(123)).toEqual({ mode: "semantic" });
  });
});

describe("migrateSkillContentTriggerToActivation", () => {
  test("rewrites trigger string → activation and drops trigger", () => {
    const { content, changed } = migrateSkillContentTriggerToActivation({
      description: "d",
      instructions: "i",
      trigger: "explicit",
    });
    expect(changed).toBe(true);
    expect(content).toEqual({ description: "d", instructions: "i", activation: { mode: "manual" } });
  });

  test("drops stray trigger but keeps existing activation", () => {
    const { content, changed } = migrateSkillContentTriggerToActivation({
      description: "d",
      instructions: "i",
      activation: { mode: "always" },
      trigger: "semantic",
    });
    expect(changed).toBe(true);
    expect(content).toEqual({ description: "d", instructions: "i", activation: { mode: "always" } });
  });

  test("is a no-op when already migrated (activation, no trigger)", () => {
    const input = { description: "d", instructions: "i", activation: { mode: "manual" } };
    const { content, changed } = migrateSkillContentTriggerToActivation(input);
    expect(changed).toBe(false);
    expect(content).toBe(input);
  });

  test("is a no-op for legacy row without trigger/activation (read-side defaults semantic)", () => {
    const input = { description: "d", instructions: "i" };
    const { changed } = migrateSkillContentTriggerToActivation(input);
    expect(changed).toBe(false);
  });

  test("is idempotent", () => {
    const once = migrateSkillContentTriggerToActivation({ description: "d", instructions: "i", trigger: "explicit" });
    const twice = migrateSkillContentTriggerToActivation(once.content);
    expect(twice.changed).toBe(false);
    expect(twice.content).toEqual({ description: "d", instructions: "i", activation: { mode: "manual" } });
  });

  test("tolerates non-object content", () => {
    expect(migrateSkillContentTriggerToActivation(null)).toEqual({ content: null, changed: false });
    expect(migrateSkillContentTriggerToActivation("x")).toEqual({ content: "x", changed: false });
  });
});

/** Fake pool that records queries and serves canned SELECT rows. */
function makeFakePool(rows: { heads: unknown[]; versions: unknown[] }): {
  pool: MigrateMysqlPool;
  writes: { sql: string; params: unknown[] }[];
} {
  const writes: { sql: string; params: unknown[] }[] = [];
  const pool: MigrateMysqlPool = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("SELECT") && sql.includes("tenant_descriptors") && sql.includes("draft_content_json") && !sql.includes("JOIN")) {
        return [rows.heads, undefined];
      }
      if (sql.includes("SELECT") && sql.includes("tenant_descriptor_versions")) {
        return [rows.versions, undefined];
      }
      writes.push({ sql, params });
      return [{ affectedRows: 1 }, undefined];
    },
    async end() {},
  };
  return { pool, writes };
}

describe("migrateSkillTriggerToActivationInMysql", () => {
  const heads = [
    { id: "skl_1", tenant: 7, draft_content_json: { description: "d", instructions: "i", trigger: "explicit" } },
    { id: "skl_2", tenant: 7, draft_content_json: { description: "d", instructions: "i", activation: { mode: "semantic" } } },
  ];
  const versions = [
    { descriptor_id: "skl_1", tenant: 7, version_no: 1, content_json: '{"description":"d","instructions":"i","trigger":"semantic"}' },
  ];

  test("dry-run scans but writes nothing", async () => {
    const { pool, writes } = makeFakePool({ heads, versions });
    const result = await migrateSkillTriggerToActivationInMysql(pool, { dryRun: true });
    expect(result.scanned).toEqual({ heads: 2, versions: 1 });
    expect(result.changed).toEqual({ heads: 1, versions: 1 });
    expect(writes).toHaveLength(0);
  });

  test("applies UPDATEs for changed rows only", async () => {
    const { pool, writes } = makeFakePool({ heads, versions });
    const result = await migrateSkillTriggerToActivationInMysql(pool, { dryRun: false });
    expect(result.changed).toEqual({ heads: 1, versions: 1 });
    expect(writes).toHaveLength(2);
    // head UPDATE carries migrated JSON (trigger removed, activation added)
    const headWrite = writes.find((w) => w.sql.includes("UPDATE tenant_descriptors"));
    expect(headWrite?.params[1]).toBe("skl_1");
    expect(JSON.parse(headWrite?.params[0] as string)).toEqual({
      description: "d",
      instructions: "i",
      activation: { mode: "manual" },
    });
    const versionWrite = writes.find((w) => w.sql.includes("UPDATE tenant_descriptor_versions"));
    expect(JSON.parse(versionWrite?.params[0] as string)).toEqual({
      description: "d",
      instructions: "i",
      activation: { mode: "semantic" },
    });
  });
});

describe("parseSkillActivationCliArgs", () => {
  test("parses --dry-run and --mysql-url", () => {
    expect(parseSkillActivationCliArgs(["--dry-run"])).toEqual({ dryRun: true });
    expect(parseSkillActivationCliArgs(["--mysql-url", "mysql://x"])).toEqual({ dryRun: false, mysqlUrl: "mysql://x" });
  });
});
