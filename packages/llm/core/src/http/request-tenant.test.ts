import { describe, expect, test } from "bun:test";

import { createEnvFallbackTenantResolver, parseTenantId } from "./request-tenant";

describe("parseTenantId", () => {
  test("parses numeric tenant header strings", () => {
    expect(parseTenantId("58197260")).toBe(58197260);
    expect(parseTenantId("  42  ")).toBe(42);
  });

  test("returns undefined for empty or non-numeric input", () => {
    expect(parseTenantId(undefined)).toBeUndefined();
    expect(parseTenantId("")).toBeUndefined();
    expect(parseTenantId("   ")).toBeUndefined();
    expect(parseTenantId("abc")).toBeUndefined();
  });
});

describe("createEnvFallbackTenantResolver — ai-center wiring", () => {
  test("prefers active tenant from resolveActive over env fallback", () => {
    const resolve = createEnvFallbackTenantResolver(() => 58197260);
    expect(resolve()).toBe(58197260);
  });
});
