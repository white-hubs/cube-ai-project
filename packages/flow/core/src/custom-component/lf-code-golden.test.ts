import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { flowCoreFixturePaths } from "../test-helpers/fixture-paths";
import { extractLfTemplateCodeGoldens, normalizeLfCode } from "./lf-code-golden";
import { defaultCustomComponentIdentityDsl, transpileParsedDsl } from "./transpile";

const apiAllPath = flowCoreFixturePaths.apiAllPath;
const catalogPath = flowCoreFixturePaths.componentCatalogPath;

describe("lf-code golden / catalog alignment", () => {
  test("every catalog lfComponentKey with code in api-all can be normalized", () => {
    const goldens = extractLfTemplateCodeGoldens(apiAllPath);
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
      components: { lfComponentKey: string }[];
    };
    for (const c of catalog.components) {
      const lfKey = c.lfComponentKey;
      const code = goldens.get(lfKey);
      if (!code) {
        continue;
      }
      expect(normalizeLfCode(code).length).toBeGreaterThan(0);
    }
  });

  test("CustomComponent toLfCode from Cube identity matches api-all golden", () => {
    const goldens = extractLfTemplateCodeGoldens(apiAllPath);
    const g = goldens.get("CustomComponent");
    expect(g).toBeDefined();
    const out = transpileParsedDsl(defaultCustomComponentIdentityDsl());
    expect(normalizeLfCode(out)).toBe(normalizeLfCode(g!));
  });
});
