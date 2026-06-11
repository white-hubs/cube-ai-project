import { describe, expect, test } from "bun:test";
import {
  buildPublishResolveContext,
  mergePublishConfig,
  preparePackageJsonForPublish,
  validatePreparedManifest,
} from "./prepare-sdk-package-for-publish";

describe("prepare-sdk-package-for-publish", () => {
  const ctx = buildPublishResolveContext(process.cwd());

  test("mergePublishConfig applies dist entrypoints", () => {
    const merged = mergePublishConfig({
      main: "./src/index.ts",
      exports: { ".": { import: "./src/index.ts" } },
      publishConfig: {
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
      },
    });
    expect(merged.main).toBe("./dist/index.js");
    expect(merged.exports).toEqual({
      ".": { import: "./dist/index.js", types: "./dist/index.d.ts" },
    });
  });

  test("preparePackageJsonForPublish resolves workspace and catalog deps", () => {
    const prepared = preparePackageJsonForPublish(
      {
        name: "@cube-ai/agent-sdk-client",
        main: "./src/index.ts",
        dependencies: {
          "@cube-ai/contracts": "workspace:*",
          zod: "catalog:",
        },
        peerDependencies: { vue: "catalog:" },
        devDependencies: { typescript: "catalog:" },
        publishConfig: {
          main: "./dist/index.js",
          types: "./dist/index.d.ts",
          exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
        },
      },
      ctx,
    );

    expect(prepared.dependencies).toEqual({
      "@cube-ai/contracts": ctx.workspaceVersions.get("@cube-ai/contracts"),
      zod: ctx.catalog.get("zod"),
    });
    expect(prepared.peerDependencies).toEqual({ vue: ctx.catalog.get("vue") });
    expect(prepared.devDependencies).toBeUndefined();
    expect(prepared.publishConfig).toBeUndefined();

    const validation = validatePreparedManifest(prepared);
    expect(validation.ok).toBe(true);
  });

  test("validatePreparedManifest rejects src entrypoints", () => {
    const validation = validatePreparedManifest({
      name: "@cube-ai/test",
      main: "./src/index.ts",
      exports: { ".": { import: "./src/index.ts" } },
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });
});
