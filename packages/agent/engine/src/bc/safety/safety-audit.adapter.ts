/**
 * AuditLogSafetyAuditAdapter — bridges {@link SafetyAuditSink} (in
 * `agentic-adapters`) to engine-side {@link AuditLogWriter} (outbox-backed).
 *
 * Wired into the engine via `EngineSafetyModule` so that every `deny` /
 * `mask` decision in `BaselineSafetyAdapter.review()` lands in the audit
 * outbox under `eventType: safety.policy.violation`.
 *
 * Tenant: pulled by `AuditLogWriter` from the active `TenantContextService`
 * scope. Callers must invoke safety review inside `tenantCtx.run(tenant, …)`
 * (the existing engine request lifecycle does this in middleware).
 *
 * Best-effort: any failure is swallowed so the audit pipeline cannot break
 * the safety review flow.
 *
 * ref: docs/technical-design/phase-4/T12-safety-enterprise-wire.md §5
 * ref: audit-requirements.md §3.6 (Tenant isolation / Security category)
 */
import { Inject, Injectable } from '@dangao/bun-server';
import {
  type SafetyAuditEvent,
  type SafetyAuditSink,
} from '@cube-ai/agent-engine/adapters/safety';
import { AUDIT_LOG_WRITER_TOKEN } from '../../infra/audit/audit.module';
import type { AuditLogWriter } from '../../infra/audit/audit-log.writer';

/** Audit event type identifier. */
export const SAFETY_VIOLATION_EVENT_TYPE = 'safety.policy.violation';

/** Audit event schema id (matches `audit-{name}-v{N}` regex). */
export const SAFETY_VIOLATION_EVENT_SCHEMA = 'audit-safety-policy-violation-v1';

@Injectable()
export class AuditLogSafetyAuditAdapter implements SafetyAuditSink {
  constructor(
    @Inject(AUDIT_LOG_WRITER_TOKEN) private readonly writer: AuditLogWriter,
  ) {}

  async onViolation(event: SafetyAuditEvent): Promise<void> {
    try {
      await this.writer.write({
        eventType: SAFETY_VIOLATION_EVENT_TYPE,
        eventSchema: SAFETY_VIOLATION_EVENT_SCHEMA,
        // deny → WARNING (3); mask → NOTICE (2). Severity hierarchy matches
        // audit-categories.ts §3.6 closed set.
        severity: event.kind === 'deny' ? 3 : 2,
        actor: {
          // SafetyAdapter runs without a userId/agentId (Port boundary);
          // tenant=0 with principalType=SYSTEM marks the system-issued
          // event in the audit_events `actor` JSON column.
          userId: null,
          agentId: null,
          tenant: 0,
          principalType: 'SYSTEM',
        },
        traceId: event.context?.traceId ?? null,
        sessionId: null,
        turnId: null,
        toolCallId: null,
        jobId: null,
        grantRequestId: null,
        subject: `safety:${event.policy}`,
        outcome: event.kind === 'deny' ? 'DENIED' : 'PARTIAL',
        payloadJson: {
          kind: event.kind,
          policy: event.policy,
          reason: event.reason,
          safetyClass: event.safetyClass ?? null,
          requestId: event.context?.requestId ?? null,
          sessionIdContext: event.context?.sessionId ?? null,
          detail: event.detail ?? null,
        },
        ipAddress: null,
        userAgent: null,
      });
    } catch {
      /* best-effort: audit must never block safety decision */
    }
  }
}
