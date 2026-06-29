import { describe, expect, test } from "bun:test";

import { tenantContextAls } from "@cube-ai/ai-center/platform/server-shared";

import { currentTenantId, isGlobalAccessEnabled, requireScopedTenantId } from "./access-context";

describe("requireScopedTenantId", () => {
  test("returns tenant id when tenant context is set", () => {
    tenantContextAls.run({ tenantId: "42" }, () => {
      expect(requireScopedTenantId(() => new Error("no tenant"))).toBe("42");
    });
  });

  test("throws the factory error when no tenant context exists", () => {
    expect(() => requireScopedTenantId(() => new Error("tenant scope required"))).toThrow("tenant scope required");
  });

  test("throws when tenant id is blank", () => {
    tenantContextAls.run({ tenantId: "   " }, () => {
      expect(() => requireScopedTenantId(() => new Error("blank tenant"))).toThrow("blank tenant");
    });
  });

  test("throws when tenant id is empty string", () => {
    tenantContextAls.run({ tenantId: "" }, () => {
      expect(() => requireScopedTenantId(() => new Error("empty tenant"))).toThrow("empty tenant");
    });
  });
});

describe("re-exported access helpers", () => {
  test("currentTenantId mirrors @cube-ai/ai-center/platform/server-shared behavior", () => {
    expect(currentTenantId()).toBeNull();
    tenantContextAls.run({ tenantId: " 7 " }, () => {
      expect(currentTenantId()).toBe("7");
    });
  });

  test("isGlobalAccessEnabled reflects bypassTenantIsolation flag", () => {
    expect(isGlobalAccessEnabled()).toBe(false);
    tenantContextAls.run({ bypassTenantIsolation: true, tenantId: "1" }, () => {
      expect(isGlobalAccessEnabled()).toBe(true);
    });
    tenantContextAls.run({ bypassTenantIsolation: false, tenantId: "1" }, () => {
      expect(isGlobalAccessEnabled()).toBe(false);
    });
  });
});
