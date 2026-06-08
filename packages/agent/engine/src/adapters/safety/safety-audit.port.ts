/**
 * Safety policy violation event sink.
 *
 * `BaselineSafetyAdapter.review()` invokes {@link SafetyAuditSink.onViolation}
 * once per `deny` or `mask` decision. The default {@link NO_OP_SAFETY_AUDIT_SINK}
 * is wired in when no audit infrastructure is available (tests, standalone use).
 *
 * Engine-side `AuditLogSafetyAuditAdapter` (in `@cube-ai/agent-engine`) implements
 * this sink by writing a `safety.policy.violation` envelope through the
 * outbox-backed `AuditLogWriter`.
 *
 * Calls are **fire-and-forget** from `review()` — failures must not block
 * the safety decision flow.
 *
 * ref: docs/technical-design/phase-4/T12-safety-enterprise-wire.md §5
 */

export interface SafetyAuditEventContext {
  /** Engine request id (mapped from `ExecutionContext.requestId`). */
  requestId?: string;
  sessionId?: string;
  traceId?: string;
}

export interface SafetyAuditEvent {
  kind: 'deny' | 'mask';
  /** Policy id, e.g. `'pii-scan'`, `'shell-blacklist'`, `'length-check'`. */
  policy: string;
  reason: string;
  /** Optional safety class (`'L0_PUBLIC' | 'L1_USER_DATA' | …`). */
  safetyClass?: string;
  /**
   * Optional structured detail. Implementers must NOT include raw PII
   * substrings here — see `audit-requirements.md` SEC5 §5.2.
   */
  detail?: Record<string, unknown>;
  /** Correlation context extracted from `ExecutionContext`. */
  context?: SafetyAuditEventContext;
}

export interface SafetyAuditSink {
  /**
   * Notify the audit sink of a safety policy hit. Implementations must be
   * tolerant of repeated calls and slow consumers (the caller does not
   * await the returned promise).
   */
  onViolation(event: SafetyAuditEvent): Promise<void> | void;
}

/**
 * Default no-op sink. Used by `BaselineSafetyAdapter` when no audit
 * infrastructure is wired in (e.g. unit tests, standalone adapter use).
 */
export const NO_OP_SAFETY_AUDIT_SINK: SafetyAuditSink = {
  onViolation() {
    /* noop */
  },
};
