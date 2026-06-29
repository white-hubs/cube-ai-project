import { describe, expect, test } from "bun:test";

import { AgenticVersionSchema, CURRENT_API_VERSION, HEADER_ENGINE_VERSION, HEADER_SDK_VERSION, negotiateVersion } from "@cube-ai/contracts";

describe("AgenticVersionSchema", () => {
  test('accepts "1.0"', () => {
    expect(AgenticVersionSchema.safeParse("1.0").success).toBe(true);
  });

  test('accepts "1.12"', () => {
    expect(AgenticVersionSchema.safeParse("1.12").success).toBe(true);
  });

  test('rejects "v1.0" (no v prefix allowed)', () => {
    // 01-api/README.md §1 API-2: no `v` prefix in version string
    expect(AgenticVersionSchema.safeParse("v1.0").success).toBe(false);
  });

  test('rejects "1" (must have minor)', () => {
    expect(AgenticVersionSchema.safeParse("1").success).toBe(false);
  });

  test("rejects empty string", () => {
    expect(AgenticVersionSchema.safeParse("").success).toBe(false);
  });

  test('rejects "1.0.0" (semver; only major.minor)', () => {
    expect(AgenticVersionSchema.safeParse("1.0.0").success).toBe(false);
  });
});

describe("CURRENT_API_VERSION", () => {
  test("is a valid AgenticVersion", () => {
    expect(AgenticVersionSchema.safeParse(CURRENT_API_VERSION).success).toBe(true);
  });

  test('is "1.0" for M1 Phase 1', () => {
    expect(CURRENT_API_VERSION).toBe("1.0");
  });
});

describe("negotiateVersion (N=1 backward window — T11)", () => {
  test("null client → compatible:true (loose accept, ADR-0010 hybrid)", () => {
    const r = negotiateVersion(null);
    expect(r.compatible).toBe(true);
    expect(r.deprecated).toBe(false);
    expect(r.engineVersion).toBe(CURRENT_API_VERSION);
    expect(r.minimumSupportedVersion).toBe("1.0");
  });

  test('exact "1.0" → compatible', () => {
    expect(negotiateVersion("1.0").compatible).toBe(true);
  });

  test('"1.99" (upper edge) → compatible', () => {
    expect(negotiateVersion("1.99").compatible).toBe(true);
  });

  test('"1.5" (mid range) → compatible', () => {
    const r = negotiateVersion("1.5");
    expect(r.compatible).toBe(true);
    expect(r.deprecated).toBe(false);
  });

  test('"2.0" (out of upper range) → not compatible', () => {
    const r = negotiateVersion("2.0");
    expect(r.compatible).toBe(false);
    expect(r.deprecated).toBe(false);
  });

  test('"0.9" (below min) → not compatible', () => {
    expect(negotiateVersion("0.9").compatible).toBe(false);
  });

  test("invalid string forms → not compatible", () => {
    expect(negotiateVersion("xxx").compatible).toBe(false);
    expect(negotiateVersion("1.0.0").compatible).toBe(false);
    expect(negotiateVersion("").compatible).toBe(false);
    expect(negotiateVersion("v1.0").compatible).toBe(false);
  });

  test("engineVersion always echoes CURRENT_API_VERSION (even on incompatible)", () => {
    const r = negotiateVersion("2.0");
    expect(r.engineVersion).toBe(CURRENT_API_VERSION);
    expect(r.minimumSupportedVersion).toBe("1.0");
  });

  test("minimumSupportedVersion is a valid AgenticVersion (T11 + Phase 1 carry-over)", () => {
    const r = negotiateVersion("0.9");
    expect(AgenticVersionSchema.safeParse(r.minimumSupportedVersion).success).toBe(true);
  });

  test("deprecated stays false when DEPRECATED_BELOW[engine] is null", () => {
    expect(negotiateVersion("1.0").deprecated).toBe(false);
    expect(negotiateVersion("1.99").deprecated).toBe(false);
  });
});

describe("header constants (naming-and-db-conventions.md §12.5)", () => {
  test("HEADER_ENGINE_VERSION is X-Agentic-Engine-Version", () => {
    expect(HEADER_ENGINE_VERSION).toBe("X-Agentic-Engine-Version");
  });

  test("HEADER_SDK_VERSION is X-Agentic-SDK-Version (SDK uppercase per 08-sdk/versioning.md v2.0)", () => {
    expect(HEADER_SDK_VERSION).toBe("X-Agentic-SDK-Version");
  });
});
