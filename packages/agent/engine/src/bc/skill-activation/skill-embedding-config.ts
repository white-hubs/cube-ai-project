/**
 * Skill embedding model resolution (ADR-0008).
 *
 * Precedence: turn body override → session override (reserved) → env default.
 * Frontend does not select an embedding model yet; `turnModelCode` hook is reserved.
 */

export interface SkillEmbeddingModelSource {
  /** Per-turn override from API (reserved for future UI). */
  turnModelCode?: string;
  /** Per-session override (reserved). */
  sessionModelCode?: string;
}

const ENV_KEY = 'AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL';

export function resolveSkillEmbeddingModelCode(
  source?: SkillEmbeddingModelSource,
): string | undefined {
  const fromTurn = source?.turnModelCode?.trim();
  if (fromTurn && fromTurn.length > 0) {
    return fromTurn;
  }
  const fromSession = source?.sessionModelCode?.trim();
  if (fromSession && fromSession.length > 0) {
    return fromSession;
  }
  const fromEnv = process.env[ENV_KEY]?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}
