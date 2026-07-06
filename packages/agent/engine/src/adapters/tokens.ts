/**
 * DI tokens for all 6 Adapter Ports.
 *
 * Convention: Symbol.for('agentic.<bc>.<name>')  — shared-context.md §7.2
 * `<bc>` = bounded-context = "adapter"
 *
 * Consumers resolve these from `@dangao/bun-server`'s container:
 *   container.resolve(AGENTIC_PROVIDER_TOKEN)
 *
 * Legacy TACHU_* exports kept for backward-compat; removed in M2-Phase2.
 */

// ─── Canonical token names (agentic.adapter.*) ───────────────────────────────

export const AGENTIC_PROVIDER_TOKEN = Symbol.for("agentic.adapter.provider");

export const AGENTIC_VECTOR_STORE_TOKEN = Symbol.for("agentic.adapter.vectorStore");

/** Pure-vector Qdrant index for memory projection + recall. */
export const TACHU_VECTOR_INDEX_TOKEN = Symbol.for("agentic.adapter.vectorIndex");

export const AGENTIC_MEMORY_SYSTEM_TOKEN = Symbol.for("agentic.adapter.memorySystem");

export const AGENTIC_SAFETY_MODULE_TOKEN = Symbol.for("agentic.adapter.safetyModule");

export const AGENTIC_OBSERVABILITY_TOKEN = Symbol.for("agentic.adapter.observability");

export const AGENTIC_EXECUTION_BACKEND_TOKEN = Symbol.for("agentic.adapter.executionBackend");

// ─── Legacy aliases (deprecated — remove in M2-Phase2) ───────────────────────
/** @deprecated use AGENTIC_PROVIDER_TOKEN */
export const TACHU_PROVIDER_ADAPTER_TOKEN = AGENTIC_PROVIDER_TOKEN;
/** @deprecated use AGENTIC_VECTOR_STORE_TOKEN */
export const TACHU_VECTOR_STORE_TOKEN = AGENTIC_VECTOR_STORE_TOKEN;
/** @deprecated use AGENTIC_MEMORY_SYSTEM_TOKEN */
export const TACHU_MEMORY_SYSTEM_TOKEN = AGENTIC_MEMORY_SYSTEM_TOKEN;
/** @deprecated use AGENTIC_SAFETY_MODULE_TOKEN */
export const TACHU_SAFETY_MODULE_TOKEN = AGENTIC_SAFETY_MODULE_TOKEN;
/** @deprecated use AGENTIC_OBSERVABILITY_TOKEN */
export const TACHU_OBSERVABILITY_EMITTER_TOKEN = AGENTIC_OBSERVABILITY_TOKEN;
/** @deprecated use AGENTIC_EXECUTION_BACKEND_TOKEN */
export const TACHU_EXECUTION_BACKEND_TOKEN = AGENTIC_EXECUTION_BACKEND_TOKEN;
