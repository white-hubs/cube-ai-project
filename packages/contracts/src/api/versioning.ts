import { z } from "zod";

/**
 * API version negotiation constants and schemas.
 *
 * Regulation references:
 * - `01-api/README.md §1 API-2` — `/v1` prefix; semver-compatible
 * - `naming-and-db-conventions.md §12.5` — X-Agentic-* header names
 * - `ADR-0010` — X-Agentic-Version negotiation strategy
 *
 * Format: `{major}.{minor}` (no `v` prefix).
 * Example: `"1.0"`, `"1.3"`.
 */
export const AgenticVersionSchema = z.string().regex(/^\d+\.\d+$/u, 'Version must be in {major}.{minor} format, e.g. "1.0"');

export type AgenticVersion = z.infer<typeof AgenticVersionSchema>;

/** The current engine API version exposed via `X-Agentic-Engine-Version` response header. */
export const CURRENT_API_VERSION: AgenticVersion = "1.0";

/**
 * Canonical HTTP header names for API versioning handshake.
 *
 * Source of truth: `../versioning/header.ts` (aligned with
 * `docs/detailed-design/08-sdk/versioning.md` v2.0 — `SDK` is uppercase
 * per regulation §6, e.g. `X-Agentic-SDK-Version`). This file re-exports
 * the same constants for convenience inside the `api/` namespace.
 */
export {
  HEADER_SDK_VERSION,
  HEADER_CONTRACTS_VERSION,
  HEADER_ENGINE_VERSION,
  HEADER_SDK_DEPRECATED,
  HEADER_SDK_MIN_SUPPORTED,
} from "../versioning/header";

/**
 * Negotiation result: whether the client SDK version is compatible with the
 * engine's current version.
 */
export interface VersionNegotiationResult {
  compatible: boolean;
  deprecated: boolean;
  engineVersion: AgenticVersion;
  minimumSupportedVersion: AgenticVersion;
}

/**
 * Inclusive `[min, max]` window of accepted client versions.
 * Both bounds are `{major}.{minor}` AgenticVersion strings.
 */
interface VersionRange {
  min: AgenticVersion;
  max: AgenticVersion;
}

/**
 * N=1 backward-compatibility matrix (engine version → accepted SDK range).
 *
 * Engine `1.x` accepts the entire `1.x` line (`1.0` ≤ sdk ≤ `1.99`); a future
 * `2.0` engine entry would still accept `1.x` clients (one-major back) per
 * ADR-0010 (X3 hybrid). Adding a new engine version means adding one entry
 * here and bumping `CURRENT_API_VERSION`.
 *
 * ref: docs/adr/ADR-0010-x3-hybrid-architecture.md
 *      docs/technical-design/phase-4/T11-version-compat-matrix.md §1
 */
const COMPATIBILITY_MATRIX: Record<AgenticVersion, VersionRange> = {
  "1.0": { max: "1.99", min: "1.0" },
};

/**
 * `deprecated:true` is reported when the client is still inside the
 * compatibility window but at or below the version configured here. `null`
 * disables the deprecation warning for that engine version.
 */
const DEPRECATED_BELOW: Record<AgenticVersion, AgenticVersion | null> = {
  "1.0": null,
};

/** Lexicographic compare of two `{major}.{minor}` versions. */
function compareVersion(a: AgenticVersion, b: AgenticVersion): -1 | 0 | 1 {
  const [aMaj, aMin] = a.split(".").map(Number);
  const [bMaj, bMin] = b.split(".").map(Number);
  if (aMaj! !== bMaj!) {
    return aMaj! < bMaj! ? -1 : 1;
  }
  if (aMin! !== bMin!) {
    return aMin! < bMin! ? -1 : 1;
  }
  return 0;
}

function isWithin(v: AgenticVersion, range: VersionRange): boolean {
  return compareVersion(v, range.min) >= 0 && compareVersion(v, range.max) <= 0;
}

/**
 * Negotiate a client SDK version against `CURRENT_API_VERSION`.
 *
 * Behaviour (ADR-0010 hybrid):
 * - `null` client (header missing) → loose accept (`compatible:true`).
 * - Invalid `{major}.{minor}` format → `compatible:false`.
 * - Inside `COMPATIBILITY_MATRIX[engine]` window → `compatible:true`.
 * - `deprecated:true` only when compatible AND `< DEPRECATED_BELOW[engine]`.
 *
 * Engine version (1.0 today) and minimum supported version are always set
 * so middleware can echo them via response headers regardless of outcome.
 */
export function negotiateVersion(clientSdkVersion: string | null): VersionNegotiationResult {
  const engine = CURRENT_API_VERSION;
  const range = COMPATIBILITY_MATRIX[engine];
  const minSupp = range?.min ?? engine;

  // null / undefined header (truly absent) → loose accept; an empty string
  // is a malformed header value and falls through to schema validation below.
  if (clientSdkVersion === null || clientSdkVersion === undefined) {
    return {
      compatible: true,
      deprecated: false,
      engineVersion: engine,
      minimumSupportedVersion: minSupp,
    };
  }

  if (!AgenticVersionSchema.safeParse(clientSdkVersion).success) {
    return {
      compatible: false,
      deprecated: false,
      engineVersion: engine,
      minimumSupportedVersion: minSupp,
    };
  }

  const v = clientSdkVersion as AgenticVersion;
  const compatible = range ? isWithin(v, range) : false;
  const deprecatedBelow = DEPRECATED_BELOW[engine] ?? null;
  const deprecated = compatible && deprecatedBelow !== null && compareVersion(v, deprecatedBelow) < 0;

  return {
    compatible,
    deprecated,
    engineVersion: engine,
    minimumSupportedVersion: minSupp,
  };
}
