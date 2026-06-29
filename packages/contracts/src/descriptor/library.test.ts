import { describe, expect, it } from "bun:test";

import { AvailableToolViewSchema, InstallToolRequestSchema, LibraryItemViewSchema, PluginCatalogItemViewSchema } from "./index";

describe("library item schemas", () => {
  it("allows tenant library items to expose shared content", () => {
    const parsed = LibraryItemViewSchema.parse({
      content: { prompt: "Help support users." },
      description: "Helps support users",
      displayName: "Support Agent",
      kind: "agent",
      ref: "agt_123",
      sharedVersionNo: 3,
      tags: ["support"],
      tier: "tenant",
    });

    expect(parsed.tier).toBe("tenant");
    expect(parsed.content).toEqual({ prompt: "Help support users." });
  });

  it("keeps system library items opaque", () => {
    const parsed = LibraryItemViewSchema.parse({
      description: "Built-in capability summary",
      displayName: "System Support Agent",
      kind: "agent",
      ref: "system-support-agent",
      tags: ["system"],
      tier: "system",
    });

    expect(parsed.tier).toBe("system");
    expect("content" in parsed).toBe(false);
    expect(
      LibraryItemViewSchema.safeParse({
        content: { prompt: "hidden" },
        kind: "agent",
        ref: "system-support-agent",
        tier: "system",
      }).success,
    ).toBe(false);
  });
});

describe("plugin catalog schemas", () => {
  it("projects plugin catalog items with installed state", () => {
    const parsed = PluginCatalogItemViewSchema.parse({
      description: "Returns current date",
      displayName: "Current Date",
      installed: false,
      tags: ["builtin"],
      toolName: "currentDate",
    });

    expect(parsed.installed).toBe(false);
  });

  it("validates user available tools and install requests", () => {
    expect(AvailableToolViewSchema.parse({ enabled: true, toolName: "currentDate" })).toEqual({
      enabled: true,
      toolName: "currentDate",
    });
    expect(InstallToolRequestSchema.parse({ toolName: "currentDate" })).toEqual({
      toolName: "currentDate",
    });
    expect(InstallToolRequestSchema.safeParse({}).success).toBe(false);
  });
});
