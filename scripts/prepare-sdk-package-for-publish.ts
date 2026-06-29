#!/usr/bin/env bun
/**
 * Rewrite SDK package.json for npm publish:
 * - merge publishConfig (main / types / exports → dist)
 * - resolve workspace:* and catalog: to concrete semver ranges
 * - strip devDependencies and publishConfig from the published manifest
 */
import { existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { SDK_PUBLISH_PACKAGES, type SdkPublishPackagePath } from "./sdk-publish-manifest";

const BACKUP_ROOT = ".tmp/publish-manifest-backup";

type JsonObject = Record<string, unknown>;

export interface PublishResolveContext {
  root: string;
  workspaceVersions: ReadonlyMap<string, string>;
  catalog: ReadonlyMap<string, string>;
}

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function writeJson(path: string, value: JsonObject): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function collectWorkspacePackageJsonPaths(root: string): string[] {
  const globs = [
    "apps/*/package.json",
    "packages/*/package.json",
    "packages/*/*/package.json",
    "infra/*/package.json",
    "infra/*/*/package.json",
  ];
  const paths: string[] = [];
  for (const pattern of globs) {
    for (const child of globSync(join(root, pattern))) {
      paths.push(child);
    }
  }
  return paths;
}

export function buildPublishResolveContext(root: string): PublishResolveContext {
  const rootPkg = readJson(join(root, "package.json"));
  const workspaceVersions = new Map<string, string>();
  const catalog = new Map<string, string>();

  const rootCatalog = asObject(rootPkg.catalog);
  if (rootCatalog) {
    for (const [key, value] of Object.entries(rootCatalog)) {
      if (typeof value === "string") {
        catalog.set(key, value);
      }
    }
  }

  const nestedCatalogs = asObject(rootPkg.catalogs);
  if (nestedCatalogs) {
    for (const group of Object.values(nestedCatalogs)) {
      const entries = asObject(group);
      if (!entries) {
        continue;
      }
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value === "string") {
          catalog.set(key, value);
        }
      }
    }
  }

  for (const pkgPath of collectWorkspacePackageJsonPaths(root)) {
    const pkg = readJson(pkgPath);
    const name = pkg.name;
    const version = pkg.version;
    if (typeof name === "string" && typeof version === "string") {
      workspaceVersions.set(name, version);
    }
  }

  return { catalog, root, workspaceVersions };
}

function resolveDependencyVersion(depName: string, spec: unknown, ctx: PublishResolveContext): string | undefined {
  if (typeof spec !== "string") {
    return undefined;
  }

  if (spec.startsWith("workspace:")) {
    const version = ctx.workspaceVersions.get(depName);
    if (!version) {
      throw new Error(`workspace dependency ${depName} (${spec}) is not in the monorepo`);
    }
    return version;
  }

  if (spec === "catalog:" || spec.startsWith("catalog:")) {
    const catalogKey = spec === "catalog:" ? depName : spec.slice("catalog:".length);
    const resolved = ctx.catalog.get(catalogKey);
    if (!resolved) {
      throw new Error(`catalog entry missing for ${depName} (${spec})`);
    }
    return resolved;
  }

  return spec;
}

function resolveDependencyBlock(block: unknown, ctx: PublishResolveContext, label: string): JsonObject | undefined {
  const deps = asObject(block);
  if (!deps) {
    return undefined;
  }

  const resolved: JsonObject = {};
  for (const [depName, spec] of Object.entries(deps)) {
    const version = resolveDependencyVersion(depName, spec, ctx);
    if (!version) {
      throw new Error(`${label}.${depName} has invalid version spec`);
    }
    resolved[depName] = version;
  }
  return resolved;
}

export function mergePublishConfig(pkg: JsonObject): JsonObject {
  const publishConfig = asObject(pkg.publishConfig);
  if (!publishConfig) {
    return { ...pkg };
  }

  const merged: JsonObject = { ...pkg };
  for (const field of ["main", "types", "module", "browser", "exports"] as const) {
    if (publishConfig[field] !== undefined) {
      merged[field] = publishConfig[field];
    }
  }
  return merged;
}

export function preparePackageJsonForPublish(pkgJson: JsonObject, ctx: PublishResolveContext): JsonObject {
  const merged = mergePublishConfig(pkgJson);
  const result: JsonObject = { ...merged };

  const dependencies = resolveDependencyBlock(merged.dependencies, ctx, "dependencies");
  if (dependencies) {
    result.dependencies = dependencies;
  } else {
    delete result.dependencies;
  }

  const peerDependencies = resolveDependencyBlock(merged.peerDependencies, ctx, "peerDependencies");
  if (peerDependencies) {
    result.peerDependencies = peerDependencies;
  } else {
    delete result.peerDependencies;
  }

  const optionalDependencies = resolveDependencyBlock(merged.optionalDependencies, ctx, "optionalDependencies");
  if (optionalDependencies) {
    result.optionalDependencies = optionalDependencies;
  } else {
    delete result.optionalDependencies;
  }

  delete result.devDependencies;
  delete result.publishConfig;

  return result;
}

function backupPath(root: string, relPkgPath: string): string {
  return join(root, BACKUP_ROOT, relPkgPath, "package.json");
}

function applyPackage(root: string, relPkgPath: SdkPublishPackagePath, ctx: PublishResolveContext): void {
  const pkgJsonPath = join(root, relPkgPath, "package.json");
  const original = readJson(pkgJsonPath);
  const prepared = preparePackageJsonForPublish(original, ctx);

  const backup = backupPath(root, relPkgPath);
  mkdirSync(dirname(backup), { recursive: true });
  writeJson(backup, original);
  writeJson(pkgJsonPath, prepared);
}

function restorePackage(root: string, relPkgPath: string): boolean {
  const backup = backupPath(root, relPkgPath);
  if (!existsSync(backup)) {
    return false;
  }
  const pkgJsonPath = join(root, relPkgPath, "package.json");
  writeFileSync(pkgJsonPath, readFileSync(backup, "utf8"), "utf8");
  rmSync(backup, { force: true });
  return true;
}

export function applyAllSdkPackages(root: string = process.cwd()): void {
  const ctx = buildPublishResolveContext(root);
  for (const relPkgPath of SDK_PUBLISH_PACKAGES) {
    applyPackage(root, relPkgPath, ctx);
  }
}

export function restoreAllSdkPackages(root: string = process.cwd()): void {
  for (const relPkgPath of SDK_PUBLISH_PACKAGES) {
    restorePackage(root, relPkgPath);
  }
  const backupRoot = join(root, BACKUP_ROOT);
  if (existsSync(backupRoot)) {
    rmSync(backupRoot, { force: true, recursive: true });
  }
}

export interface PreparedManifestValidationResult {
  ok: boolean;
  errors: string[];
}

function collectPathStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPathStrings(entry));
  }
  const obj = asObject(value);
  if (!obj) {
    return [];
  }
  return Object.values(obj).flatMap((entry) => collectPathStrings(entry));
}

export function validatePreparedManifest(pkgJson: JsonObject): PreparedManifestValidationResult {
  const errors: string[] = [];
  const name = typeof pkgJson.name === "string" ? pkgJson.name : "package";

  if (pkgJson.publishConfig !== undefined) {
    errors.push(`${name} publishConfig must be removed after prepare`);
  }
  if (pkgJson.devDependencies !== undefined) {
    errors.push(`${name} devDependencies must be removed after prepare`);
  }

  const depBlocks = ["dependencies", "peerDependencies", "optionalDependencies"] as const;
  for (const block of depBlocks) {
    const deps = asObject(pkgJson[block]);
    if (!deps) {
      continue;
    }
    for (const [dep, spec] of Object.entries(deps)) {
      if (typeof spec !== "string") {
        continue;
      }
      if (spec.startsWith("workspace:") || spec.includes("catalog:")) {
        errors.push(`${name} ${block}.${dep} still has workspace/catalog spec: ${spec}`);
      }
    }
  }

  const pathStrings = [
    typeof pkgJson.main === "string" ? pkgJson.main : undefined,
    typeof pkgJson.types === "string" ? pkgJson.types : undefined,
    ...collectPathStrings(pkgJson.exports),
  ].filter((path): path is string => Boolean(path));

  for (const path of pathStrings) {
    const pointsToSrc = path.includes("/src/") || (path.endsWith(".ts") && !path.endsWith(".d.ts"));
    if (pointsToSrc) {
      errors.push(`${name} entry still points to source: ${path}`);
    }
    if (!path.startsWith("./dist/")) {
      errors.push(`${name} entry must be under ./dist/: ${path}`);
    }
  }

  return { errors, ok: errors.length === 0 };
}

function parseCliArgs(argv: string[]): { command: string; pkgPath?: string } {
  if (argv.length === 0) {
    throw new Error("usage: prepare-sdk-package-for-publish.ts <apply-all|restore-all|validate-all>");
  }
  return { command: argv[0], pkgPath: argv[1] };
}

function runCommand(root: string, command: string): void {
  if (command === "apply-all") {
    applyAllSdkPackages(root);
    console.log("[prepare-publish] applied manifest rewrite for SDK packages");
    return;
  }
  if (command === "restore-all") {
    restoreAllSdkPackages(root);
    console.log("[prepare-publish] restored original package.json files");
    return;
  }
  if (command === "validate-all") {
    validateAllSdkPackages(root);
    console.log("[prepare-publish] prepared manifests OK");
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

function validateAllSdkPackages(root: string): void {
  const ctx = buildPublishResolveContext(root);
  const errors: string[] = [];
  for (const relPkgPath of SDK_PUBLISH_PACKAGES) {
    const original = readJson(join(root, relPkgPath, "package.json"));
    const prepared = preparePackageJsonForPublish(original, ctx);
    const result = validatePreparedManifest(prepared);
    if (!result.ok) {
      errors.push(...result.errors);
    }
  }
  if (errors.length === 0) {
    return;
  }
  console.error("[prepare-publish] validation failed:");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

if (import.meta.main) {
  const root = process.cwd();
  const { command } = parseCliArgs(Bun.argv.slice(2));

  try {
    runCommand(root, command);
  } catch (error) {
    console.error(`[prepare-publish] ${(error as Error).message}`);
    process.exit(1);
  }
}
