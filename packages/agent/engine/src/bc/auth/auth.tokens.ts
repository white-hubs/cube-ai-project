/** DI tokens — Symbol.for namespace per Phase 3 shared-context §9.3 */
export const AUTH_TOKENS = {
  MOCK_OBO_SERVICE: Symbol.for('agentic.auth.mockOboService'),
  DUAL_SUBJECT_SERVICE: Symbol.for('agentic.auth.dualSubjectService'),
  REDIS_CLIENT: Symbol.for('agentic.auth.redisClient'),
} as const;
