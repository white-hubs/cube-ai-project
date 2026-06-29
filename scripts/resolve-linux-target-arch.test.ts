import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.join(import.meta.dir, "..");
const LIB = path.join(REPO_ROOT, "scripts/lib/resolve-linux-target-arch.sh");

function resolveFromMachine(machine: string): string {
  const result = spawnSync("bash", ["-c", `source '${LIB}' && _resolve_linux_target_arch_from_machine '${machine}'`], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "resolve-linux-target-arch failed");
  }
  return result.stdout.trim();
}

describe("resolve_linux_target_arch", () => {
  test("x86_64 maps to linux-x64", () => {
    expect(resolveFromMachine("x86_64")).toBe("linux-x64");
  });

  test("amd64 maps to linux-x64", () => {
    expect(resolveFromMachine("amd64")).toBe("linux-x64");
  });

  test("aarch64 maps to linux-arm64", () => {
    expect(resolveFromMachine("aarch64")).toBe("linux-arm64");
  });

  test("arm64 maps to linux-arm64", () => {
    expect(resolveFromMachine("arm64")).toBe("linux-arm64");
  });
});
