import { describe, expect, it } from "bun:test";

import { InstallRequestSchema, ShelfEntryViewSchema, ShelfPatchSchema, ShelfSourceSchema } from "./index";

describe("shelf schemas", () => {
  it("defaults installs to floating ref mode", () => {
    expect(InstallRequestSchema.parse({ ref: "agt_123" })).toEqual({
      mode: "ref",
      pin: false,
      ref: "agt_123",
    });
    expect(InstallRequestSchema.parse({ pin: true, ref: "agt_123" }).pin).toBe(true);
    expect(InstallRequestSchema.parse({ mode: "copy", ref: "agt_123" }).mode).toBe("copy");
  });

  it("accepts the three shelf source kinds", () => {
    expect(ShelfSourceSchema.parse("authored")).toBe("authored");
    expect(ShelfSourceSchema.parse("ref")).toBe("ref");
    expect(ShelfSourceSchema.parse("copy")).toBe("copy");
    expect(ShelfSourceSchema.safeParse("fork").success).toBe(false);
  });

  it("projects shelf entries with effective runnable status", () => {
    const parsed = ShelfEntryViewSchema.parse({
      displayName: "Support Agent",
      effectiveVersionNo: 2,
      enabled: true,
      id: "she_123",
      pinVersionNo: null,
      runnableStatus: "runnable",
      source: "ref",
      targetId: "agt_123",
      targetKind: "agent",
    });

    expect(parsed.pinVersionNo).toBeNull();
    expect(parsed.runnableStatus).toBe("runnable");
  });

  it("validates shelf patch fields independently", () => {
    expect(ShelfPatchSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(ShelfPatchSchema.parse({ pin: true })).toEqual({ pin: true });
    expect(ShelfPatchSchema.parse({ enabled: true, pin: false })).toEqual({
      enabled: true,
      pin: false,
    });
    expect(ShelfPatchSchema.safeParse({ enabled: "yes" }).success).toBe(false);
  });
});
