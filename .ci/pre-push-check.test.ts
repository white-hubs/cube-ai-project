import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  getCommitPolicyViolations,
  getDependencyPolicyViolations,
  isValidBranchName,
  resolveCommitRange,
  runAutoFormatGate,
  runPrePushChecks,
} from "./pre-push-check";

const tempRoots: string[] = [];
const ZERO_SHA = "0".repeat(40);

function fakePrePushGit(args: string[]) {
  if (args.join(" ") === "rev-parse HEAD") return { exitCode: 0, stdout: "headsha\n", stderr: "" };
  if (args.join(" ") === "merge-base main HEAD") return { exitCode: 0, stdout: "basesha\n", stderr: "" };
  if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
    return { exitCode: args[2] === "remote-ok" ? 0 : 1, stdout: "", stderr: "" };
  }
  throw new Error(`unexpected git args: ${args.join(" ")}`);
}

function createTempRepo(): string {
  const root = join(process.env.HOME ?? ".", ".tmp", `cube-ai-pre-push-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("commit gate", () => {
  test("accepts scoped single and grouped commit titles with guhecloud author emails", () => {
    expect(
      getCommitPolicyViolations([
        {
          sha: "a1",
          subject: "feat(agent): add debug session preview",
          authorEmail: "yanquan@guhecloud.com",
        },
        {
          sha: "b2",
          subject: "chore(agent, sdk): align package metadata",
          authorEmail: "dev.ops@guhecloud.com",
        },
        {
          sha: "c3",
          subject: "{feat(agent), hotfix(sdk)}: support console push gate",
          authorEmail: "foo@guhecloud.com",
        },
      ]),
    ).toEqual([]);
  });

  test("rejects invalid commit title shapes and non-guhecloud author emails", () => {
    const violations = getCommitPolicyViolations([
      {
        sha: "a1",
        subject: "merge(agent): unsupported type",
        authorEmail: "yanquan@guhecloud.com",
      },
      {
        sha: "b2",
        subject: "feat: missing scope",
        authorEmail: "yanquan@guhecloud.com",
      },
      {
        sha: "c3",
        subject: "feat(agent): valid title with wrong email",
        authorEmail: "yanquan@example.com",
      },
    ]);

    expect(violations).toHaveLength(3);
    expect(violations.map((item) => item.sha)).toEqual(["a1", "b2", "c3"]);
    expect(violations[0]?.reasons).toContain("commit subject must match type(scope): message or {type(scope), type(scope)}: message");
    expect(violations[1]?.reasons).toContain("commit subject must match type(scope): message or {type(scope), type(scope)}: message");
    expect(violations[2]?.reasons).toContain("commit author email must end with @guhecloud.com");
  });
});

describe("branch gate", () => {
  test("accepts main, release branches, and personal slash branches", () => {
    expect(isValidBranchName("main")).toBe(true);
    expect(isValidBranchName("release-2026.06")).toBe(true);
    expect(isValidBranchName("yanquan/agent-console-sdk")).toBe(true);
  });

  test("rejects non-release top-level branches and invalid personal prefixes", () => {
    expect(isValidBranchName("feature")).toBe(false);
    expect(isValidBranchName("yanquan")).toBe(false);
    expect(isValidBranchName("YanQuan/foo")).toBe(false);
    expect(isValidBranchName("yanquan/foo/bar")).toBe(false);
  });
});

describe("pre-push context", () => {
  test("uses remoteSha..HEAD for ordinary pushes and merge-base..HEAD for first push or rewritten history", () => {
    expect(resolveCommitRange("refs/heads/me/x headsha refs/heads/me/x remote-ok\n", fakePrePushGit)).toEqual({
      mode: "single-ref",
      range: "remote-ok..HEAD",
    });
    expect(resolveCommitRange(`refs/heads/me/x headsha refs/heads/me/x ${ZERO_SHA}\n`, fakePrePushGit)).toEqual({
      mode: "first-push",
      range: "basesha..HEAD",
    });
    expect(resolveCommitRange("refs/heads/me/x headsha refs/heads/me/x remote-old\n", fakePrePushGit)).toEqual({
      mode: "rewritten-history",
      range: "basesha..HEAD",
    });
  });
});

describe("pre-push pipeline", () => {
  test("runs gates in the requested order", async () => {
    const order: string[] = [];

    await runPrePushChecks({
      deps: async () => order.push("deps"),
      fmt: async () => order.push("fmt"),
      lint: async () => order.push("lint"),
      build: async () => order.push("build"),
      commit: async () => order.push("commit"),
      branch: async () => order.push("branch"),
    });

    expect(order).toEqual(["deps", "fmt", "lint", "build", "commit", "branch"]);
  });
});

describe("fmt gate", () => {
  test("creates an auto-format commit and aborts when oxfmt changes files", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = async (command: string, args: string[]) => {
      calls.push({ command, args });
      if (command === "git" && args[0] === "status") {
        return { exitCode: 0, stdout: " M packages/foo/src/index.ts\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await expect(runAutoFormatGate([{ status: "M", path: "packages/foo/src/index.ts" }], runner)).rejects.toThrow(
      "auto-format commit created",
    );

    expect(calls).toEqual([
      { command: "bunx", args: ["oxfmt", "--write", "packages/foo/src/index.ts"] },
      { command: "git", args: ["status", "--porcelain", "--", "packages/foo/src/index.ts"] },
      { command: "git", args: ["add", "--", "packages/foo/src/index.ts"] },
      { command: "git", args: ["commit", "-m", "chore(fmt): auto-format"] },
    ]);
  });
});

describe("deps gate", () => {
  test("rejects sub-package dependencies that do not use workspace or catalog protocol", async () => {
    const root = createTempRepo();
    mkdirSync(join(root, "packages", "bad"), { recursive: true });
    writeJson(join(root, "package.json"), {
      private: true,
      workspaces: ["packages/*"],
      catalog: {
        zod: "4.4.3",
      },
    });
    writeJson(join(root, "packages", "bad", "package.json"), {
      name: "@cube-ai/bad",
      dependencies: {
        zod: "^4.4.3",
      },
    });

    await expect(getDependencyPolicyViolations(root)).resolves.toEqual([
      {
        packageJsonPath: "packages/bad/package.json",
        field: "dependencies",
        dependencyName: "zod",
        version: "^4.4.3",
      },
    ]);
  });

  test("accepts catalog, named catalog, and workspace protocols in sub-packages", async () => {
    const root = createTempRepo();
    mkdirSync(join(root, "apps", "ok"), { recursive: true });
    writeJson(join(root, "package.json"), {
      private: true,
      workspaces: ["apps/*"],
      catalog: {
        zod: "4.4.3",
      },
      catalogs: {
        vue: {
          vue: "3.5.35",
        },
      },
    });
    writeJson(join(root, "apps", "ok", "package.json"), {
      name: "@cube-ai/ok",
      dependencies: {
        "@cube-ai/contracts": "workspace:*",
        zod: "catalog:",
        vue: "catalog:vue",
      },
    });

    await expect(getDependencyPolicyViolations(root)).resolves.toEqual([]);
  });

  test("rejects root dependency literals and non-concrete catalog versions", async () => {
    const root = createTempRepo();
    writeJson(join(root, "package.json"), {
      private: true,
      workspaces: ["packages/*"],
      catalog: {
        zod: "^4.4.3",
      },
      devDependencies: {
        typescript: "6.0.3",
      },
    });

    await expect(getDependencyPolicyViolations(root)).resolves.toEqual([
      {
        packageJsonPath: "package.json",
        field: "catalog",
        dependencyName: "zod",
        version: "^4.4.3",
      },
      {
        packageJsonPath: "package.json",
        field: "devDependencies",
        dependencyName: "typescript",
        version: "6.0.3",
      },
    ]);
  });
});
