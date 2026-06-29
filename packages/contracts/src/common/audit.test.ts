import { describe, expect, test } from "bun:test";

import { AuditFieldsSchema, systemAuditFields } from "./audit";

// ref: docs/technical-design/phase-1/P1-01-foundations.md §7

describe("AuditFieldsSchema", () => {
  const validRecord = {
    createBy: "user-display-name",
    createTime: 1745700000000,
    creatorId: "1234567890123456789",
    creatorType: "USER" as const,
    deleted: 0,
    tenant: 1,
    updateBy: "user-display-name",
    updateTime: 1745700000000,
    updaterId: "1234567890123456789",
    updaterType: "USER" as const,
  };

  test("accepts a valid audit record", () => {
    expect(AuditFieldsSchema.safeParse(validRecord).success).toBe(true);
  });

  test("accepts system-generated audit record (null creator fields)", () => {
    const sys = {
      ...validRecord,
      createBy: "system",
      creatorId: null,
      creatorType: "SYSTEM" as const,
      updateBy: "system",
      updaterId: null,
      updaterType: "SYSTEM" as const,
    };
    expect(AuditFieldsSchema.safeParse(sys).success).toBe(true);
  });

  test("rejects negative deleted value", () => {
    const bad = { ...validRecord, deleted: -1 };
    expect(AuditFieldsSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects invalid creatorType", () => {
    const bad = { ...validRecord, creatorType: "INVALID" };
    expect(AuditFieldsSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects tenant out of INT(10) range", () => {
    const bad = { ...validRecord, tenant: 3_000_000_000 };
    expect(AuditFieldsSchema.safeParse(bad).success).toBe(false);
  });

  test("accepts null creatorId and updaterId", () => {
    const rec = { ...validRecord, creatorId: null, updaterId: null };
    expect(AuditFieldsSchema.safeParse(rec).success).toBe(true);
  });

  test("accepts null creatorType and updaterType", () => {
    const rec = { ...validRecord, creatorType: null, updaterType: null };
    expect(AuditFieldsSchema.safeParse(rec).success).toBe(true);
  });

  test("has exactly 10 fields", () => {
    const shape = Object.keys(AuditFieldsSchema.shape);
    expect(shape).toHaveLength(10);
  });
});

describe("systemAuditFields()", () => {
  test("returns a valid AuditFields object", () => {
    const fields = systemAuditFields(1, 1745700000000);
    expect(AuditFieldsSchema.safeParse(fields).success).toBe(true);
  });

  test('sets createBy and updateBy to "system"', () => {
    const fields = systemAuditFields(5);
    expect(fields.createBy).toBe("system");
    expect(fields.updateBy).toBe("system");
  });

  test("sets creatorType to SYSTEM", () => {
    const fields = systemAuditFields(1);
    expect(fields.creatorType).toBe("SYSTEM");
    expect(fields.updaterType).toBe("SYSTEM");
  });

  test("sets deleted to 0", () => {
    const fields = systemAuditFields(1);
    expect(fields.deleted).toBe(0);
  });
});
