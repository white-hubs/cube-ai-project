import { describe, expect, test } from "bun:test";

import { type DeveloperApiContext, developerApiAls } from "@cube-ai/tenant-context";

describe("developerApiAls", () => {
  test("has no store outside run", () => {
    expect(developerApiAls.getStore()).toBeUndefined();
  });

  test("exposes tenant-level key context inside run", () => {
    const ctx: DeveloperApiContext = {
      accessLevel: "tenant",
      apiKeyId: "key-1",
      flowIdScope: "flow-9",
      tenantId: "42",
    };
    developerApiAls.run(ctx, () => {
      const store = developerApiAls.getStore();
      expect(store?.apiKeyId).toBe("key-1");
      expect(store?.flowIdScope).toBe("flow-9");
      expect(store?.accessLevel).toBe("tenant");
      expect(store?.tenantId).toBe("42");
    });
  });

  test("supports system-level keys with null tenant and unrestricted flow scope", () => {
    const ctx: DeveloperApiContext = {
      accessLevel: "system",
      apiKeyId: "sys-key",
      flowIdScope: null,
      tenantId: null,
    };
    developerApiAls.run(ctx, () => {
      const store = developerApiAls.getStore();
      expect(store?.accessLevel).toBe("system");
      expect(store?.tenantId).toBeNull();
      expect(store?.flowIdScope).toBeNull();
    });
  });

  test("survives async boundaries and does not leak after run", async () => {
    const ctx: DeveloperApiContext = {
      accessLevel: "tenant",
      apiKeyId: "key-async",
      flowIdScope: null,
      tenantId: "1",
    };
    await developerApiAls.run(ctx, async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(developerApiAls.getStore()?.apiKeyId).toBe("key-async");
    });
    expect(developerApiAls.getStore()).toBeUndefined();
  });
});
