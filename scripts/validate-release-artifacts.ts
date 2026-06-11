#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import {
  SDK_MIRRORED_DOCS,
  SDK_PUBLISH_PACKAGES,
  SDK_PUBLISH_REGISTRY,
  type SdkPublishPackagePath,
} from "./sdk-publish-manifest";

export interface ReleaseArtifactValidationOptions {
  root?: string;
  requireBuiltArtifacts?: boolean;
  requireMirroredDocs?: boolean;
}

export interface ReleaseArtifactValidationResult {
  ok: boolean;
  version?: string;
  errors: string[];
}

type JsonObject = Record<string, unknown>;

function readJson(path: string): JsonObject {
  return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function collectPathStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectPathStrings);
  const obj = asObject(value);
  if (!obj) return [];
  return Object.values(obj).flatMap(collectPathStrings);
}

function normalizePackageRelativePath(path: string): string {
  return normalize(path.replace(/^\.\//, ""));
}

function validateFileExists(
  errors: string[],
  pkgRoot: string,
  path: string,
  label: string,
): void {
  if (!existsSync(join(pkgRoot, path))) {
    errors.push(`${label} missing: ${path}`);
  }
}

function validateSdkPackage(
  root: string,
  relPath: SdkPublishPackagePath,
  expectedVersion: string | undefined,
  opts: Required<
    Pick<ReleaseArtifactValidationOptions, "requireBuiltArtifacts" | "requireMirroredDocs">
  >,
  errors: string[],
): string | undefined {
  const pkgRoot = join(root, relPath);
  const json = readJson(join(pkgRoot, "package.json"));
  const name = asString(json.name) ?? relPath;
  const version = asString(json.version);

  if (!version) errors.push(`${name} has no package version`);
  if (expectedVersion && version && version !== expectedVersion) {
    errors.push(`${name} version ${version} does not match lockstep ${expectedVersion}`);
  }
  if (json.private === true) errors.push(`${name} must not be private`);

  const publishConfig = asObject(json.publishConfig);
  if (!publishConfig) {
    errors.push(`${name} missing publishConfig`);
  } else {
    const registry = asString(publishConfig.registry);
    if (!registry) {
      errors.push(`${name} publishConfig.registry is required`);
    } else if (registry !== SDK_PUBLISH_REGISTRY) {
      errors.push(
        `${name} publishConfig.registry must be ${SDK_PUBLISH_REGISTRY} (got ${registry})`,
      );
    }
    if (!asString(publishConfig.access)) {
      errors.push(`${name} publishConfig.access is required`);
    }
  }

  const files = Array.isArray(json.files) ? json.files : [];
  if (!files.includes("dist")) {
    errors.push(`${name} files[] must include dist`);
  }

  const publishExports = asObject(publishConfig?.exports);
  const declaredPaths = [
    asString(publishConfig?.main),
    asString(publishConfig?.types),
    ...collectPathStrings(publishExports),
  ].filter((path): path is string => Boolean(path));

  if (declaredPaths.length === 0) {
    errors.push(`${name} publishConfig must declare main/types/exports artifacts`);
  }

  for (const declaredPath of new Set(declaredPaths)) {
    const rel = normalizePackageRelativePath(declaredPath);
    if (opts.requireBuiltArtifacts) {
      validateFileExists(errors, pkgRoot, rel, `${name} declared artifact`);
    }
  }

  if (opts.requireMirroredDocs) {
    for (const doc of SDK_MIRRORED_DOCS) {
      validateFileExists(errors, pkgRoot, doc, `${name} mirrored doc`);
    }
  }

  return version;
}

export function validateReleaseArtifacts(
  options: ReleaseArtifactValidationOptions = {},
): ReleaseArtifactValidationResult {
  const root = options.root ?? process.cwd();
  const requireBuiltArtifacts = options.requireBuiltArtifacts ?? false;
  const requireMirroredDocs = options.requireMirroredDocs ?? true;
  const errors: string[] = [];

  let version: string | undefined;
  for (const relPath of SDK_PUBLISH_PACKAGES) {
    version =
      validateSdkPackage(
        root,
        relPath,
        version,
        { requireBuiltArtifacts, requireMirroredDocs },
        errors,
      ) ?? version;
  }

  return { ok: errors.length === 0, version, errors };
}

function parseCliArgs(argv: string[]): ReleaseArtifactValidationOptions {
  const options: ReleaseArtifactValidationOptions = {};
  for (const arg of argv) {
    if (arg === "--require-built-artifacts") {
      options.requireBuiltArtifacts = true;
    } else if (arg === "--require-mirrored-docs") {
      options.requireMirroredDocs = true;
    } else if (arg === "--allow-doc-drift") {
      options.requireMirroredDocs = false;
    } else if (arg.startsWith("--root=")) {
      options.root = arg.slice("--root=".length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

if (import.meta.main) {
  try {
    const result = validateReleaseArtifacts(parseCliArgs(Bun.argv.slice(2)));
    if (!result.ok) {
      console.error("[release-artifacts] validation failed:");
      for (const error of result.errors) console.error(`  - ${error}`);
      process.exit(1);
    }
    console.log(`[release-artifacts] ok${result.version ? ` (${result.version})` : ""}`);
  } catch (error) {
    console.error(`[release-artifacts] ${(error as Error).message}`);
    process.exit(1);
  }
}
