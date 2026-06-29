import { AGENTIC_CONTRACTS_VERSION } from "@cube-ai/contracts";

/**
 * Protocol version sent as `X-Agentic-SDK-Version` (must be `{major}.{minor}`).
 * Must fall within the engine `COMPATIBILITY_MATRIX` for `CURRENT_API_VERSION`
 * (today `1.0` accepts `1.0`…`1.99`). This is independent of the npm/package
 * semver in package.json (`0.0.1-alpha.0`, etc.).
 */
export const SDK_VERSION = "1.0";

/**
 * Inject versioning headers into an outgoing request.
 * Uses string literals to avoid circular-import TDZ issues with contracts constants.
 * Ref: docs/detailed-design/08-sdk/versioning.md §3 / sdk-core.md §4.5
 */
export function buildVersionHeaders(): Record<string, string> {
  return {
    "x-agentic-contracts-version": AGENTIC_CONTRACTS_VERSION,
    "x-agentic-sdk-version": SDK_VERSION,
    "x-client-name": `agent-sdk-client@${SDK_VERSION}`,
    "x-request-id": crypto.randomUUID(),
  };
}

/**
 * Check response for SDK deprecation warning.
 * Returns the deprecated flag and engine version if present.
 */
export function readVersionResponseHeaders(headers: Headers): {
  isDeprecated: boolean;
  engineVersion: string | null;
} {
  return {
    engineVersion: headers.get("x-agentic-engine-version"),
    isDeprecated: headers.get("x-agentic-sdk-deprecated") === "true",
  };
}
