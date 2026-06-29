import { describe, expect, test } from "bun:test";

import { assertNonEmptyString } from "./index";

describe("assertNonEmptyString", () => {
  test("returns trimmed string", () => {
    expect(assertNonEmptyString("  x  ", "f")).toBe("x");
  });
  test("throws on empty", () => {
    expect(() => assertNonEmptyString("   ", "field")).toThrow("field is required");
  });
});
