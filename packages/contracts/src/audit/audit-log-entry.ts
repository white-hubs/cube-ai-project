import { z } from 'zod';
import { SfidSchema } from '../common/ids';

/**
 * TenantSchema — inline here to avoid importing from engine internals.
 * tenant=0 allowed for system-level audit events (SEC4 §1.3).
 * ref: audit-requirements.md §2 + tenant-isolation-matrix.md §1.3
 */
const TenantInternalSchema = z.number().int().nonnegative().max(4_294_967_295);

/**
 * Actor descriptor — dual-subject model (ADR-0004).
 * ref: audit-requirements.md §2.2
 */
export const AuditActorSchema = z.object({
  /** Platform user id (nullable when action is SERVICE-initiated). */
  userId: z.string().nullable(),
  /** ServicePrincipal / agent id (nullable for pure user actions). */
  agentId: z.string().nullable(),
  /** tenant INT(10); 0 = system; SEC4 §1.3 */
  tenant: TenantInternalSchema,
  /** ref: audit-requirements.md §2.2 principal_type */
  principalType: z.enum(['USER', 'SERVICE', 'SYSTEM']),
});
export type AuditActor = z.infer<typeof AuditActorSchema>;

/**
 * Full AuditLogEntry — matches `audit_events` table fields.
 * ref: audit-requirements.md §2.1 DDL
 *
 * Rules:
 * - eventType: lowercase.dotted format (e.g. 'grant.created') — SEC5 §3.1 exception
 * - eventSchema: 'audit-{domain}-{action}-v{N}' pattern
 * - severity: 1=INFO, 2=NOTICE, 3=WARNING, 4=CRITICAL
 * - payloadJson keys: camelCase (SEC5 §5.2)
 * - PII forbidden in payloadJson: no access_token, phone, id_card (SEC5 §5.2)
 */
export const AuditLogEntrySchema = z.object({
  id: SfidSchema,
  tenant: TenantInternalSchema,

  /**
   * lowercase.dotted event type; ref: audit-requirements.md §3
   * Allows underscores in segments: 'cross_tenant.violation', 'auth.login_success'
   */
  eventType: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/,
      'eventType must be lowercase.dotted (e.g. grant.created, cross_tenant.violation)',
    ),

  /** Schema version; ref: audit-requirements.md §2.2 */
  eventSchema: z
    .string()
    .regex(
      /^audit-[a-z0-9][a-z0-9._-]*-v\d+$/,
      'eventSchema must match audit-{name}-v{N}',
    ),

  /** 1=INFO 2=NOTICE 3=WARNING 4=CRITICAL; ref: audit-requirements.md §2.2 */
  severity: z.number().int().min(1).max(4),

  /** Event business time (epoch ms); distinct from create_time (DB insert time). */
  occurredTime: z.number().int().positive(),

  actor: AuditActorSchema,

  traceId: z.string().nullable(),
  sessionId: SfidSchema.nullable(),
  turnId: SfidSchema.nullable(),
  toolCallId: z.string().nullable(),
  jobId: SfidSchema.nullable(),
  grantRequestId: SfidSchema.nullable(),

  /** Human-readable subject, e.g. 'grant(18203...)' or 'session(...)'. */
  subject: z.string().nullable(),

  outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED', 'PARTIAL']),

  /**
   * Event-specific payload with camelCase keys.
   * Forbidden keys (SEC5 §5.2): accessToken, refreshToken, privateKey, phone, idCard.
   */
  payloadJson: z.record(z.string(), z.unknown()).nullable(),

  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

/**
 * Subset used when calling AuditLogWriter.write().
 * id / tenant / occurredTime are filled by the writer itself.
 */
export type AuditLogEntryInput = Omit<
  AuditLogEntry,
  'id' | 'tenant' | 'occurredTime'
>;
