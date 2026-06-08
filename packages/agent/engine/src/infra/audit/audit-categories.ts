/**
 * Closed set of audit event type categories used by AuditLogWriter.
 * ref: audit-requirements.md §3 (A–I categories)
 *
 * Naming convention: lowercase.dotted (SEC5 §3.1 exception to UPPERCASE rule).
 * Extending this set requires a PR + event schema version bump (SEC5 §2.3).
 */
export const AuditCategories = {
  // A. Grant lifecycle (ref: audit-requirements.md §3.2)
  GRANT_CREATED: 'grant.created',
  GRANT_UPDATED: 'grant.updated',
  GRANT_REVOKED: 'grant.revoked',
  GRANT_USED: 'grant.used',
  GRANT_REQUEST_APPROVED: 'grant.request.approved',
  GRANT_REQUEST_DENIED: 'grant.request.denied',

  // B. Authentication (ref: audit-requirements.md §3.3)
  AUTH_LOGIN_SUCCESS: 'auth.login_success',
  AUTH_JWT_VERIFY_FAILED: 'auth.jwt_verify_failed',
  AUTH_OBO_TOKEN_ISSUED: 'auth.obo_token_issued',

  // C. Tool call decisions (ref: audit-requirements.md §3.4)
  AUTHZ_DECISION: 'authz.decision',
  AUTHZ_DENY: 'authz.deny',

  // D. Secrets (ref: audit-requirements.md §3.5)
  SECRETS_DECRYPTED: 'secrets.decrypted',
  SECRETS_LOAD_FAILED: 'secrets.load_failed',
  SECRETS_ROTATED: 'secrets.rotated',
  SECRETS_ROTATION_OVERDUE: 'secrets.rotation_overdue',
  SECRETS_ROTATION_IMMINENT: 'secrets.rotation_imminent',
  SECRETS_EMERGENCY_ROTATION: 'secrets.emergency_rotation_initiated',

  // E. Tenant isolation / Security (ref: audit-requirements.md §3.6)
  CROSS_TENANT_VIOLATION: 'cross_tenant.violation',
  RATELIMIT_TRIGGERED: 'ratelimit.triggered',
  CONTENT_FILTER_BLOCKED: 'content_filter.blocked',

  // F. Descriptor (ref: audit-requirements.md §3.7)
  DESCRIPTOR_VERSION_PUBLISHED: 'descriptor.version_published',
  DESCRIPTOR_UPSERT: 'descriptor.upsert',
  DESCRIPTOR_DEPRECATED: 'descriptor.deprecated',

  // G. Session / Turn (ref: audit-requirements.md §3.8)
  SESSION_CREATED: 'session.created',
  SESSION_DELETED: 'session.deleted',
  TURN_FAILED: 'turn.failed',
  TURN_ABORTED: 'turn.aborted',

  // H. Memory / Recall (ref: audit-requirements.md §3.9)
  MEMORY_RECALL: 'memory.recall',

  // I. System actions (ref: audit-requirements.md §3.10)
  ENGINE_STARTUP: 'engine.startup',
  ENGINE_SHUTDOWN: 'engine.shutdown',
  ENGINE_DEGRADED: 'engine.degraded',
} as const;

export type AuditCategory = (typeof AuditCategories)[keyof typeof AuditCategories];

/** Severity mapping for each audit category. ref: audit-requirements.md §3 */
export const AUDIT_SEVERITY: Partial<Record<AuditCategory, number>> = {
  [AuditCategories.CROSS_TENANT_VIOLATION]: 4, // CRITICAL
  [AuditCategories.SECRETS_LOAD_FAILED]: 4,
  [AuditCategories.SECRETS_EMERGENCY_ROTATION]: 4,
  [AuditCategories.AUTH_JWT_VERIFY_FAILED]: 3, // WARNING
  [AuditCategories.GRANT_REVOKED]: 3,
  [AuditCategories.SECRETS_ROTATION_OVERDUE]: 3,
  [AuditCategories.RATELIMIT_TRIGGERED]: 2, // NOTICE
  [AuditCategories.CONTENT_FILTER_BLOCKED]: 2,
  [AuditCategories.GRANT_CREATED]: 2,
  [AuditCategories.GRANT_UPDATED]: 2,
  [AuditCategories.GRANT_REQUEST_APPROVED]: 2,
  [AuditCategories.GRANT_REQUEST_DENIED]: 2,
  [AuditCategories.SECRETS_ROTATED]: 2,
  [AuditCategories.DESCRIPTOR_VERSION_PUBLISHED]: 2,
  [AuditCategories.DESCRIPTOR_UPSERT]: 2,
  [AuditCategories.DESCRIPTOR_DEPRECATED]: 2,
  [AuditCategories.SESSION_DELETED]: 2,
  [AuditCategories.TURN_FAILED]: 2,
  // INFO (1) — everything else defaults to 1
};

/** Returns the severity level for an event type (default: 1=INFO). */
export function severityOf(eventType: AuditCategory | string): number {
  return (AUDIT_SEVERITY as Record<string, number>)[eventType] ?? 1;
}
