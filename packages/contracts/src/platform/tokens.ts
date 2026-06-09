/**
 * DI tokens for the platform Adapter Ports (flow invoke / flow catalog / knowledge / LLM). Mirrors the convention
 * established by `@cube-ai/agentic-adapters/tokens.ts`:
 *   Symbol.for('agentic.adapter.<bc>.<port>')
 * Engine BCs and the platform-adapters-ghcloud package both consume these
 * symbols via the shared global registry.
 *
 * **Naming decision (M0.T6, 2026-06-06):** retain `agentic.*` namespace — do not migrate to `agent.*`
 * in one shot (global Symbol.for strings). See `docs/migration/decisions/M0-T6-di-token-namespace.md`.
 *
 * ref: docs/technical-design/plans/2026-05-08-platform-adapters-ghcloud.md
 */

export const AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN = Symbol.for(
  'agentic.adapter.platform.flowInvoker',
);

export const AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN = Symbol.for(
  'agentic.adapter.platform.flowCatalog',
);

export const AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN = Symbol.for(
  'agentic.adapter.platform.knowledgeQuery',
);

export const AGENTIC_PLATFORM_LLM_CATALOG_TOKEN = Symbol.for(
  'agentic.adapter.platform.llmCatalog',
);

export const AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN = Symbol.for(
  'agentic.adapter.platform.llmProvider',
);

export const LLM_PROVIDER_ICON_STORE_TOKEN = Symbol.for(
  'agentic.adapter.platform.llmProviderIconStore',
);
