/** Compose `VAR=` → empty string; must not become tachu capabilityMapping model. */
export function resolveNonEmptyModel(raw: string | undefined, fallback?: string): string {
  if (raw === undefined) return fallback ?? '';
  const trimmed = raw.trim();
  if (trimmed.length > 0) return trimmed;
  return fallback ?? '';
}

export const TACHU_INTERNAL_TOOL_NAMES = ['load_skill', 'read_skill_resource'] as const;

export const TACHU_ENGINE_TOKEN = Symbol.for('agentic.tachu.engine');
export const TURN_CONTEXT_HOLDER_TOKEN = Symbol.for('agentic.tachu.turnContextHolder');
export const TURN_AWARE_EMBEDDING_RUNTIME_TOKEN = Symbol.for(
  'agentic.tachu.turnAwareEmbeddingRuntime',
);
export const MEMORY_PROJECTION_RELAY_TOKEN = Symbol.for(
  'agentic.tachu.memoryProjectionRelay',
);
export const MEMORY_PROJECTION_LEADER_KEY = 'agentic:engine:memory-projection:leader';
