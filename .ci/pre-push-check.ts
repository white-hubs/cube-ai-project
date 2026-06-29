#!/usr/bin/env bun

import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
const IGNORED_DIRS = new Set([".git", ".husky", ".tmp", "coverage", "dist", "lib", "node_modules"]);
const FORMAT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".vue"] as const;
const SCOPE_PATTERN = String.raw`[A-Za-z0-9._-]+(?:,\s*[A-Za-z0-9._-]+)*`;
const COMMIT_ITEM_PATTERN = String.raw`(?:feat|fix|hotfix|chore|docs|test|refactor|build|ci|perf|style|revert)\(${SCOPE_PATTERN}\)`;
const SINGLE_COMMIT_SUBJECT_RE = new RegExp(String.raw`^${COMMIT_ITEM_PATTERN}: .+$`, "u");
const GROUPED_COMMIT_SUBJECT_RE = new RegExp(String.raw`^\{${COMMIT_ITEM_PATTERN}(?:,\s*${COMMIT_ITEM_PATTERN})+\}: .+$`, "u");
const PERSONAL_BRANCH_RE = /^[a-z][a-z0-9._-]*\/[A-Za-z0-9._-]+$/u;
const ZERO_SHA = "0000000000000000000000000000000000000000";

export interface DependencyPolicyViolation {
  packageJsonPath: string;
  field: string;
  dependencyName: string;
  version: string;
}

export interface CommitInfo {
  sha: string;
  subject: string;
  authorEmail: string;
}

export interface CommitPolicyViolation {
  sha: string;
  subject: string;
  authorEmail: string;
  reasons: string[];
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ChangedFile {
  status: string;
  path: string;
  oldPath?: string;
}

export type GitRunner = (args: string[]) => CommandResult;
export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export type PushMode = "manual" | "single-ref" | "first-push" | "rewritten-history" | "delete-ref";

export interface CommitRangeContext {
  mode: PushMode;
  range: string | null;
}

export interface PrePushGates {
  deps: () => Promise<unknown>;
  fmt: () => Promise<unknown>;
  lint: () => Promise<unknown>;
  build: () => Promise<unknown>;
  commit: () => Promise<unknown>;
  branch: () => Promise<unknown>;
}

function toRepoPath(root: string, filePath: string): string {
  return relative(root, filePath).replaceAll("\\", "/");
}

function readJsonFile(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function runGit(args: string[]): CommandResult {
  const result = Bun.spawnSync(["git", ...args], {
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });

  return {
    exitCode: result.exitCode ?? 1,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  const result = Bun.spawnSync([command, ...args], {
    stderr: "pipe",
    stdin: "inherit",
    stdout: "pipe",
  });

  return {
    exitCode: result.exitCode ?? 1,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

function requiredGitStdout(args: string[], git: GitRunner): string {
  const result = git(args);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout.trim();
}

function parseNameStatus(output: string): ChangedFile[] {
  return output
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const status = parts[0] ?? "";
      if (status.startsWith("R") || status.startsWith("C")) {
        return {
          oldPath: parts[1],
          path: parts[2] ?? parts[1] ?? "",
          status,
        };
      }

      return {
        path: parts[1] ?? "",
        status,
      };
    })
    .filter((file) => file.path);
}

function readDependencyMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function collectPackageJsonPaths(root: string, dir = root): string[] {
  const paths: string[] = [];

  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) {
      continue;
    }

    const fullPath = resolve(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      paths.push(...collectPackageJsonPaths(root, fullPath));
      continue;
    }

    if (entry === "package.json" && fullPath !== resolve(root, "package.json")) {
      paths.push(fullPath);
    }
  }

  return paths;
}

function isAllowedSubPackageDependencyVersion(version: string): boolean {
  return version.startsWith("catalog:") || version.startsWith("workspace:");
}

function isConcreteCatalogVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(version);
}

function collectRootCatalogSections(rootPackageJson: Record<string, unknown>): { field: string; deps: Record<string, string> }[] {
  const sections: { field: string; deps: Record<string, string> }[] = [
    { deps: readDependencyMap(rootPackageJson.catalog), field: "catalog" },
  ];

  if (rootPackageJson.catalogs && typeof rootPackageJson.catalogs === "object") {
    for (const [catalogName, entries] of Object.entries(rootPackageJson.catalogs as Record<string, unknown>)) {
      sections.push({ deps: readDependencyMap(entries), field: `catalogs.${catalogName}` });
    }
  }

  return sections;
}

function getRootDependencyPolicyViolations(rootPackageJson: Record<string, unknown>): DependencyPolicyViolation[] {
  const violations: DependencyPolicyViolation[] = [];

  for (const { field, deps } of collectRootCatalogSections(rootPackageJson)) {
    for (const [dependencyName, version] of Object.entries(deps)) {
      if (!isConcreteCatalogVersion(version)) {
        violations.push({
          dependencyName,
          field,
          packageJsonPath: "package.json",
          version,
        });
      }
    }
  }

  for (const field of DEPENDENCY_FIELDS) {
    for (const [dependencyName, version] of Object.entries(readDependencyMap(rootPackageJson[field]))) {
      if (!isAllowedSubPackageDependencyVersion(version)) {
        violations.push({
          dependencyName,
          field,
          packageJsonPath: "package.json",
          version,
        });
      }
    }
  }

  return violations;
}

export async function getDependencyPolicyViolations(rootDir = process.cwd()): Promise<DependencyPolicyViolation[]> {
  const root = resolve(rootDir);
  const violations = getRootDependencyPolicyViolations(readJsonFile(resolve(root, "package.json")));

  for (const packageJsonPath of collectPackageJsonPaths(root).toSorted()) {
    const packageJson = readJsonFile(packageJsonPath);
    const repoPath = toRepoPath(root, packageJsonPath);

    for (const field of DEPENDENCY_FIELDS) {
      for (const [dependencyName, version] of Object.entries(readDependencyMap(packageJson[field]))) {
        if (!isAllowedSubPackageDependencyVersion(version)) {
          violations.push({
            dependencyName,
            field,
            packageJsonPath: repoPath,
            version,
          });
        }
      }
    }
  }

  return violations;
}

function isValidCommitSubject(subject: string): boolean {
  return SINGLE_COMMIT_SUBJECT_RE.test(subject) || GROUPED_COMMIT_SUBJECT_RE.test(subject);
}

/** Git 自动生成的 merge commit（Merge branch / Merge remote-tracking branch 等）。 */
export function isMergeCommitSubject(subject: string): boolean {
  return subject.startsWith("Merge ");
}

function isGuhecloudEmail(email: string): boolean {
  return email.endsWith("@guhecloud.com");
}

export function getCommitPolicyViolations(commits: CommitInfo[]): CommitPolicyViolation[] {
  return commits.flatMap((commit) => {
    const reasons: string[] = [];
    if (!isMergeCommitSubject(commit.subject) && !isValidCommitSubject(commit.subject)) {
      reasons.push("commit subject must match type(scope): message or {type(scope), type(scope)}: message");
    }
    if (!isGuhecloudEmail(commit.authorEmail)) {
      reasons.push("commit author email must end with @guhecloud.com");
    }

    return reasons.length > 0 ? [{ ...commit, reasons }] : [];
  });
}

export function isValidBranchName(branchName: string): boolean {
  return branchName === "main" || branchName.startsWith("release-") || PERSONAL_BRANCH_RE.test(branchName);
}

function parsePrePushInput(input: string): { localRef: string; localSha: string; remoteRef: string; remoteSha: string }[] {
  return input
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/u);
      if (!localRef || !localSha || !remoteRef || !remoteSha) {
        throw new Error(`invalid pre-push input line: ${line}`);
      }
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

async function readStdinWithTimeout(timeoutMs = 50): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }

  return new Promise((resolveInput) => {
    let data = "";
    let done = false;

    const finish = (): void => {
      if (done) {
        return;
      }
      done = true;
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", finish);
      process.stdin.removeListener("error", finish);
      resolveInput(data);
    };

    const onData = (chunk: string | Buffer): void => {
      data += chunk.toString();
    };

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);

    let chunk: string | Buffer | null;
    while ((chunk = process.stdin.read()) !== null) {
      data += chunk.toString();
    }

    setTimeout(finish, timeoutMs);
  });
}

function mergeBaseRange(git: GitRunner): string {
  return `${requiredGitStdout(["merge-base", "main", "HEAD"], git)}..HEAD`;
}

export function resolveCommitRange(prePushInput = "", git: GitRunner = runGit): CommitRangeContext {
  const refs = parsePrePushInput(prePushInput);
  if (refs.length === 0) {
    return { mode: "manual", range: mergeBaseRange(git) };
  }

  const nonDeleteRefs = refs.filter((ref) => ref.localSha !== ZERO_SHA);
  if (nonDeleteRefs.length === 0) {
    return { mode: "delete-ref", range: null };
  }
  if (nonDeleteRefs.length > 1) {
    throw new Error("pre-push only supports pushing one non-delete ref at a time");
  }

  const ref = nonDeleteRefs[0];
  const headSha = requiredGitStdout(["rev-parse", "HEAD"], git);
  if (ref.localSha !== headSha) {
    throw new Error("pre-push local SHA is not current HEAD");
  }
  if (ref.remoteSha === ZERO_SHA) {
    return { mode: "first-push", range: mergeBaseRange(git) };
  }

  const ancestor = git(["merge-base", "--is-ancestor", ref.remoteSha, "HEAD"]);
  if (ancestor.exitCode === 0) {
    return { mode: "single-ref", range: `${ref.remoteSha}..HEAD` };
  }

  return { mode: "rewritten-history", range: mergeBaseRange(git) };
}

function getChangedFiles(range: string): ChangedFile[] {
  const result = runGit(["diff", "--name-status", "--diff-filter=ACMRTD", range]);
  if (result.exitCode !== 0) {
    throw new Error(`git diff failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return parseNameStatus(result.stdout);
}

function assertCleanWorkingTree(): void {
  const status = runGit(["status", "--porcelain"]);
  if (status.exitCode !== 0) {
    throw new Error(`git status failed: ${status.stderr.trim() || status.stdout.trim()}`);
  }
  if (status.stdout.trim()) {
    throw new Error("working tree must be clean before pre-push auto-format can run");
  }
}

export async function runPrePushChecks(gates: PrePushGates): Promise<void> {
  await gates.deps();
  await gates.fmt();
  await gates.lint();
  await gates.build();
  await gates.commit();
  await gates.branch();
}

async function runDependencyGate(): Promise<void> {
  const violations = await getDependencyPolicyViolations(process.cwd());
  if (violations.length === 0) {
    console.log("deps gate: passed");
    return;
  }

  console.error("deps gate failed: dependency versions must use workspace/catalog policy");
  for (const violation of violations) {
    console.error(`- ${violation.packageJsonPath} ${violation.field}.${violation.dependencyName} = ${violation.version}`);
  }
  throw new Error("deps gate failed");
}

function isFormatableFile(filePath: string): boolean {
  return FORMAT_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export async function runAutoFormatGate(changedFiles: ChangedFile[], runner: CommandRunner = runCommand): Promise<void> {
  const files = unique(
    changedFiles
      .filter((file) => !file.status.startsWith("D"))
      .map((file) => file.path)
      .filter((value) => isFormatableFile(value)),
  );

  if (files.length === 0) {
    console.log("✅ fmt gate: 没有需要格式化的文件");
    return;
  }

  const fmt = await runner("bunx", ["oxfmt", "--write", ...files]);
  if (fmt.exitCode !== 0) {
    throw new Error(`fmt gate failed: ${fmt.stderr.trim() || fmt.stdout.trim()}`);
  }

  const status = await runner("git", ["status", "--porcelain", "--", ...files]);
  if (status.exitCode !== 0) {
    throw new Error(`git status failed after fmt: ${status.stderr.trim() || status.stdout.trim()}`);
  }
  if (!status.stdout.trim()) {
    console.log("✅ fmt gate: 格式无变动");
    return;
  }

  const add = await runner("git", ["add", "--", ...files]);
  if (add.exitCode !== 0) {
    throw new Error(`git add failed after fmt: ${add.stderr.trim() || add.stdout.trim()}`);
  }

  const commit = await runner("git", ["commit", "-m", "chore(fmt): auto-format"]);
  if (commit.exitCode !== 0) {
    throw new Error(`auto-format commit failed: ${commit.stderr.trim() || commit.stdout.trim()}`);
  }

  throw new Error("auto-format commit created; please run git push again");
}

function isLintableFile(filePath: string): boolean {
  return isFormatableFile(filePath);
}

async function runLintGate(changedFiles: ChangedFile[]): Promise<void> {
  const files = unique(
    changedFiles
      .filter((file) => !file.status.startsWith("D"))
      .map((file) => file.path)
      .filter((value) => isLintableFile(value)),
  );

  if (files.length === 0) {
    console.log("lint gate: no lintable files");
    return;
  }

  const lint = await runCommand("bun", ["run", "oxlint", "--quiet", "--no-error-on-unmatched-pattern", ...files]);
  if (lint.stdout.trim()) {
    console.log(lint.stdout.trim());
  }
  if (lint.stderr.trim()) {
    console.error(lint.stderr.trim());
  }
  if (lint.exitCode !== 0) {
    throw new Error("lint gate failed");
  }
  console.log("lint gate: passed");
}

async function runBuildGate(): Promise<void> {
  const build = await runCommand("bun", ["run", "build"]);
  if (build.stdout.trim()) {
    console.log(build.stdout.trim());
  }
  if (build.stderr.trim()) {
    console.error(build.stderr.trim());
  }
  if (build.exitCode !== 0) {
    throw new Error("build gate failed");
  }
  console.log("build gate: passed");
}

function getCommitsInRange(range: string): CommitInfo[] {
  const result = runGit(["log", "--format=%H%x1f%s%x1f%ae", range]);
  if (result.exitCode !== 0) {
    throw new Error(`git log failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha = "", subject = "", authorEmail = ""] = line.split("\u001F");
      return { authorEmail, sha, subject };
    });
}

async function runCommitGate(range: string): Promise<void> {
  const commits = getCommitsInRange(range);
  const violations = getCommitPolicyViolations(commits);
  if (violations.length === 0) {
    console.log("commit gate: passed");
    return;
  }

  console.error("commit gate failed:");
  for (const violation of violations) {
    console.error(`- ${violation.sha.slice(0, 7)} ${violation.subject} <${violation.authorEmail}>`);
    for (const reason of violation.reasons) {
      console.error(`  ${reason}`);
    }
  }
  throw new Error("commit gate failed");
}

async function runBranchGate(): Promise<void> {
  const branch = requiredGitStdout(["rev-parse", "--abbrev-ref", "HEAD"], runGit);
  if (isValidBranchName(branch)) {
    console.log("branch gate: passed");
    return;
  }
  throw new Error(`branch gate failed: ${branch} must be main, release-*, or <person>/<name>`);
}

async function main(): Promise<void> {
  const prePushInput = await readStdinWithTimeout();
  const context = resolveCommitRange(prePushInput);
  if (context.mode === "delete-ref" || !context.range) {
    console.log("delete ref push: skipped local pre-push checks");
    return;
  }

  const changedFiles = getChangedFiles(context.range);
  console.log(`pre-push mode: ${context.mode}`);
  console.log(`commit range: ${context.range}`);
  console.log(`changed files: ${changedFiles.length}`);

  await runPrePushChecks({
    branch: runBranchGate,
    build: runBuildGate,
    commit: async () => runCommitGate(context.range),
    deps: runDependencyGate,
    fmt: async () => {
      assertCleanWorkingTree();
      await runAutoFormatGate(changedFiles);
    },
    lint: async () => runLintGate(changedFiles),
  });

  console.log("pre-push checks passed");
}

if (import.meta.path === Bun.main || process.argv[1]?.endsWith("pre-push-check.ts")) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`pre-push failed: ${message}`);
    process.exit(1);
  }
}
