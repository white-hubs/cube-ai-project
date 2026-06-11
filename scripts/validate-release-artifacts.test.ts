import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateSdkDistBundle } from "./validate-release-artifacts";

describe("validateSdkDistBundle", () => {
  test("rejects empty re-export shell", () => {
    const root = join(tmpdir(), `sdk-dist-shell-${Date.now()}`);
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(
      join(root, "dist/index.js"),
      "export {\n  createKbClient,\n  KbClient\n};\n",
    );

    const errors: string[] = [];
    validateSdkDistBundle(errors, "@cube-ai/kb-sdk-client", root, "dist/index.js");
    expect(errors.some((e) => e.includes("empty re-export shell"))).toBe(true);
  });

  test("accepts bundled implementation", () => {
    const root = join(tmpdir(), `sdk-dist-bundle-${Date.now()}`);
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(
      join(root, "dist/index.js"),
      `${"// ".repeat(200)}class KbClient {}\nfunction createKbClient() {}\n`,
    );

    const errors: string[] = [];
    validateSdkDistBundle(errors, "@cube-ai/kb-sdk-client", root, "dist/index.js");
    expect(errors).toEqual([]);
  });
});
