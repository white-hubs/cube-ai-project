import { describe, expect, test } from "bun:test";

import {
  buildAclMysqlPredicate,
  buildAclQdrantMustClause,
  buildDocumentAccessMysqlPredicate,
  buildDocumentAccessQdrantMustClauses,
  buildMetadataMysqlPredicate,
  resolveAccessFilter,
} from "./document-access-filter";

describe("W4.1 document access dual-leg filters", () => {
  test("W4.1-H1: Qdrant ACL must excludes tagged docs without overlap (fail-closed when empty groups)", () => {
    const clause = buildAclQdrantMustClause([]);
    // Qdrant nested Filter: `should` only (no ES minimum_should_match).
    expect(clause.minimum_should_match).toBeUndefined();
    expect(clause.min_should).toBeUndefined();
    const should = clause.should as Record<string, unknown>[];
    expect(should.some((item) => "is_null" in item)).toBe(true);
    expect(should.some((item) => "is_empty" in item)).toBe(true);
    expect(should.some((item) => "key" in item && (item as { key: string }).key === "aclGroupIds")).toBe(false);

    const withGroups = buildAclQdrantMustClause(["eng", "ops"]);
    const withAny = (withGroups.should as Record<string, unknown>[]).find((item) => (item as { key?: string }).key === "aclGroupIds") as {
      match: { any: string[] };
    };
    expect(withAny.match.any).toEqual(["eng", "ops"]);
  });

  test("W4.1-H2: MySQL ACL predicate keeps legacy empty and requires overlap for tagged", () => {
    const pred = buildAclMysqlPredicate([]);
    expect(pred.sql).toContain("acl_group_ids_json IS NULL");
    expect(pred.sql).toContain("JSON_LENGTH");
    expect(pred.sql).toContain("JSON_OVERLAPS");
    expect(pred.params).toEqual(["[]"]);

    const withGroups = buildAclMysqlPredicate(["g-fire"]);
    expect(withGroups.params).toEqual([JSON.stringify(["g-fire"])]);
  });

  test("W4.1-H3: metadata AND filters apply on both legs", () => {
    const mysql = buildMetadataMysqlPredicate({
      createdAtFrom: "2026-01-01T00:00:00.000Z",
      createdAtTo: "2026-12-31T23:59:59.999Z",
      docType: "standard",
      lang: "zh",
      tags: ["消防", "安全"],
    });
    expect(mysql.sql).toContain("doc_created_at >= ?");
    expect(mysql.sql).toContain("doc_created_at <= ?");
    expect(mysql.sql).toContain("doc_type = ?");
    expect(mysql.sql).toContain("lang = ?");
    expect(mysql.sql).toContain("JSON_CONTAINS");
    expect(mysql.params).toEqual([
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-12-31T23:59:59.999Z"),
      "standard",
      "zh",
      JSON.stringify("消防"),
      JSON.stringify("安全"),
    ]);

    const qdrant = buildDocumentAccessQdrantMustClauses({
      filters: { createdAtFrom: "2026-01-01T00:00:00.000Z", docType: "standard", tags: ["消防"] },
      identity: { groupIds: ["g1"] },
    });
    expect(qdrant.some((c) => (c as { key?: string }).key === "docType")).toBe(true);
    expect(qdrant.some((c) => (c as { key?: string }).key === "tags")).toBe(true);
    expect(qdrant.some((c) => (c as { key?: string }).key === "createdAt")).toBe(true);
    expect(qdrant[0]).toEqual(buildAclQdrantMustClause(["g1"]));
  });

  test("legacy empty ACL remains visible even when caller has no groups", () => {
    const combined = buildDocumentAccessMysqlPredicate({ identity: null });
    expect(combined.sql).toContain("acl_group_ids_json IS NULL");
    expect(combined.sql).toContain("JSON_OVERLAPS");
    // empty overlap array cannot match tagged docs → fail-closed for tagged
    expect(combined.params[0]).toBe("[]");
  });

  test("resolveAccessFilter uses identity seam only", () => {
    expect(resolveAccessFilter({ identity: { groupIds: ["a"] } }).allowedGroupIds).toEqual(["a"]);
    expect(resolveAccessFilter({ allowedGroupIds: ["b"], identity: { groupIds: ["a"] } }).allowedGroupIds).toEqual(["b"]);
  });
});
