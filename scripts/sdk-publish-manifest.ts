/**
 * Single source of truth for @cube-ai/* SDK npm publish order and registry.
 *
 * Topological order:
 *   contracts → leaf SDKs (no inter-SDK deps) → assistant → vue
 */
/** Nexus private hosted repo — publish target only (install uses npm-group). */
export const SDK_PUBLISH_REGISTRY = "http://nexus.guhecloud.com:8888/repository/npm-hosted/" as const;

/** Workspace-relative package directories, in publish dependency order. */
export const SDK_PUBLISH_PACKAGES = [
  "packages/contracts",
  "packages/agent/sdk-client",
  "packages/agent/sdk-client-mock",
  "packages/flow/sdk-client",
  "packages/flow/sdk-console",
  "packages/kb/sdk-client",
  "packages/kb/sdk-console",
  "packages/llm/sdk-console",
  "packages/agent/sdk-console",
  "packages/agent/sdk-client-assistant",
  "packages/agent/sdk-client-vue",
] as const;

export type SdkPublishPackagePath = (typeof SDK_PUBLISH_PACKAGES)[number];

export const SDK_MIRRORED_DOCS = ["README.md"] as const;
