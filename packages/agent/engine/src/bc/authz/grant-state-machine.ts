/**
 * Grant state machine — 4-state lifecycle for G-A / G-B / G-D grants.
 *
 * States: PENDING → GRANTED → REVOKED | EXPIRED
 * Illegal transitions throw AgenticEngineError (INVALID_ARGUMENT).
 *
 * ref: docs/detailed-design/04-auth-and-authz/grant-lifecycle.md §2.1
 *      P1-05 prompt §6.2
 */
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import type { GrantState } from '@cube-ai/contracts';

/** Valid transitions map */
const VALID_TRANSITIONS: Record<GrantState, GrantState[]> = {
  PENDING: ['GRANTED', 'REVOKED'],
  GRANTED: ['REVOKED', 'EXPIRED'],
  REVOKED: [],
  EXPIRED: [],
};

/**
 * Validates and executes a grant state transition.
 * Returns the new state on success.
 * Throws AgenticEngineError on illegal transition.
 *
 * ref: grant-lifecycle.md §2.1 "不修改核心字段"
 */
export function transitionGrantState(
  current: GrantState,
  next: GrantState,
): GrantState {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw AgenticEngineError.fromCode(
      'INVALID_ARGUMENT_SCHEMA_VIOLATION',
      `Illegal grant state transition: ${current} → ${next}. Allowed from ${current}: [${allowed.join(', ')}]`,
    );
  }
  return next;
}

/** Derive effective GrantState from a Grant record */
export function deriveGrantState(grant: {
  deleted: number;
  revokeTime?: number;
  expireTime?: number;
}): GrantState {
  if (grant.deleted !== 0 || grant.revokeTime != null) return 'REVOKED';
  if (grant.expireTime != null && grant.expireTime < Date.now()) return 'EXPIRED';
  return 'GRANTED';
}

/** Check whether a grant is currently active (GRANTED + not expired) */
export function isGrantActive(grant: {
  deleted: number;
  revokeTime?: number;
  expireTime?: number;
}): boolean {
  return deriveGrantState(grant) === 'GRANTED';
}
