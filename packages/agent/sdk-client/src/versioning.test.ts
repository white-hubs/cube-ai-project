import { describe, expect, test } from "bun:test";

import { SDK_VERSION, buildVersionHeaders, readVersionResponseHeaders } from "./versioning";

/**
 * Unit tests for versioning module.
 * Ref: P1-09 design doc §7 / sdk-core.md §12.1
 */
describe("buildVersionHeaders", () => {
  test("injects x-agentic-sdk-version header (lowercase, RFC 7230)", () => {
    const headers = buildVersionHeaders();
    expect(headers["x-agentic-sdk-version"]).toBe(SDK_VERSION);
  });

  test("injects x-agentic-contracts-version header", () => {
    const headers = buildVersionHeaders();
    expect(headers["x-agentic-contracts-version"]).toBeDefined();
    expect(typeof headers["x-agentic-contracts-version"]).toBe("string");
  });

  test("injects x-client-name header with sdk version", () => {
    const headers = buildVersionHeaders();
    expect(headers["x-client-name"]).toContain(SDK_VERSION);
  });

  test("injects x-request-id as a UUID v4", () => {
    const headers = buildVersionHeaders();
    const reqId = headers["x-request-id"];
    expect(reqId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
  });

  test("two calls produce different x-request-id values", () => {
    const h1 = buildVersionHeaders();
    const h2 = buildVersionHeaders();
    expect(h1["x-request-id"]).not.toBe(h2["x-request-id"]);
  });
});

describe("readVersionResponseHeaders", () => {
  test("detects deprecated SDK flag (case-insensitive via Headers)", () => {
    const headers = new Headers({ "x-agentic-sdk-deprecated": "true" });
    const result = readVersionResponseHeaders(headers);
    expect(result.isDeprecated).toBe(true);
  });

  test("returns false for non-deprecated response", () => {
    const headers = new Headers();
    const result = readVersionResponseHeaders(headers);
    expect(result.isDeprecated).toBe(false);
  });

  test("reads engine version from header", () => {
    const headers = new Headers({ "x-agentic-engine-version": "2.3.1" });
    const result = readVersionResponseHeaders(headers);
    expect(result.engineVersion).toBe("2.3.1");
  });
});
