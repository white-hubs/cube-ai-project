import "reflect-metadata";
import { describe, expect, test } from "bun:test";

import { LibraryController, ListingController } from "../../../../packages/agent/engine/src/bc/descriptor/listing.controller";
import { PluginCatalogController } from "../../../../packages/agent/engine/src/bc/descriptor/plugin-catalog.controller";
import { MyShelfController } from "../../../../packages/agent/engine/src/bc/descriptor/shelf.controller";
import { DOMAIN_PREFIX_MOUNTS, applyDomainPrefixMounts } from "./domain-prefix-mounts";

/**
 * Read the @Controller base path written by `@dangao/bun-server` without
 * depending on its (unexported) metadata symbol: the decorator stores an
 * object carrying a string `path`, which is the only class-level metadata
 * shaped that way.
 */
function readControllerBase(ctor: object): string | undefined {
  for (const key of Reflect.getMetadataKeys(ctor)) {
    const meta = Reflect.getMetadata(key, ctor) as unknown;
    if (meta && typeof meta === "object" && typeof (meta as { path?: unknown }).path === "string") {
      return (meta as { path: string }).path;
    }
  }
  return undefined;
}

describe("applyDomainPrefixMounts", () => {
  test("overwrites every mapped controller @Controller base to its domain-qualified path", () => {
    applyDomainPrefixMounts();
    for (const { controller, base } of DOMAIN_PREFIX_MOUNTS) {
      expect(readControllerBase(controller)).toBe(base);
    }
  });

  test("mapping table is two-axis: domain-qualified, no /v1, both consumption + management present", () => {
    const bases = DOMAIN_PREFIX_MOUNTS.map((m) => m.base);

    // every entry is qualified under one of the four domains
    expect(bases.every((b) => /^\/(agent|llm|flow|kb)(\/|$)/u.test(b))).toBe(true);

    // consumption axis
    expect(bases).toContain("/agent/sessions");
    expect(bases).toContain("/agent/mcp/descriptor");
    expect(bases).toContain("/llm/providers");
    expect(bases).toContain("/flow/run");
    expect(bases).toContain("/kb/search");

    // management axis (/console) + legacy alias (/agent/{kind})
    expect(bases).toContain("/agent/console");
    expect(bases).toContain("/agent");
    expect(bases).toContain("/llm/console");
    expect(bases).toContain("/flow/console/flows");
    expect(bases).toContain("/kb/console/documents");

    // /v1 OpenAI gateway is exempt — it must never be remapped here
    expect(bases.some((b) => b.startsWith("/v1"))).toBe(false);
  });

  test("mounts marketplace controllers under the descriptor console base", () => {
    const consoleControllers = new Set(DOMAIN_PREFIX_MOUNTS.filter((m) => m.base === "/agent/console").map((m) => m.controller));

    expect(consoleControllers.has(ListingController)).toBe(true);
    expect(consoleControllers.has(LibraryController)).toBe(true);
    expect(consoleControllers.has(MyShelfController)).toBe(true);
    expect(consoleControllers.has(PluginCatalogController)).toBe(true);
  });
});
