import { z } from 'zod';

/**
 * Discriminated-union payload schemas for outbox_events.payload_json.
 *
 * Aligned with:
 *   docs/detailed-design/09-usage-events/outbox-contract.md §3/§4/§5
 *
 * Rules (outbox-contract.md §2.2 / §2.4):
 *   - eventType values: retained lowercase dot-notation (regulation §5.2 exception)
 *   - payload field names: camelCase (regulation §3)
 *   - enum values: SNAKE_CASE UPPERCASE (regulation §5.2)
 *
 * M1 covers 3 usage event types (09-usage-events/README.md §2.1):
 *   - usage.llm_call   → UsageLlmCallPayload
 *   - usage.tool_call  → UsageToolCallPayload
 *   - usage.job_duration → UsageJobDurationPayload
 *
 * Additional outbox payload types (non-usage):
 *   - grant.approve    → GrantApprovePayload
 *   - session.end      → SessionEndPayload
 *
 * Note: z.discriminatedUnion() requires ZodObject members (not ZodEffects).
 * Cross-field validation rules are available via the *StrictSchema exports.
 */

// ─── Common ────────────────────────────────────────────────────────────────

const SfidStringSchema = z.string().regex(/^\d{1,20}$/, 'Must be SFID decimal string');

/** Common origin fields shared by all usage payloads. */
const UsageOriginSchema = z.object({
  tenant:    z.number().int().min(1),
  userId:    z.string().max(64).nullable().optional(),
  sessionId: SfidStringSchema.nullable().optional(),
  turnId:    SfidStringSchema.nullable().optional(),
});

// ─── usage.llm_call ────────────────────────────────────────────────────────

/**
 * usage.llm_call payload (schema: usage.llm_call.v1).
 * Ref: outbox-contract.md §3.2
 */
export const UsageLlmCallPayloadSchema = UsageOriginSchema.extend({
  schema:       z.literal('usage.llm_call.v1'),
  provider:     z.enum(['OPENAI', 'ANTHROPIC', 'BEDROCK', 'QWEN', 'DEEPSEEK', 'DOUBAO', 'OTHER']),
  model:        z.string().max(64),
  phase:        z.enum(['INITIAL', 'TOOL_LOOP', 'FINAL']).nullable().optional(),
  inputTokens:  z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative().nullable().optional(),
  durationMs:   z.number().int().nonnegative(),
  outcome:      z.enum(['COMPLETED', 'FAILED']),
  errorCode:    z
    .string()
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$|^$/)
    .nullable()
    .optional(),
  occurredTime: z.number().int().nonnegative(),
  extensions:   z.record(z.unknown()).nullable().optional(),
});
export type UsageLlmCallPayload = z.infer<typeof UsageLlmCallPayloadSchema>;

// ─── usage.tool_call ───────────────────────────────────────────────────────

/**
 * usage.tool_call payload (schema: usage.tool_call.v1).
 * Base shape for discriminated union use.
 * Cross-field rules available via UsageToolCallPayloadStrictSchema.
 * Ref: outbox-contract.md §4.2
 */
export const UsageToolCallPayloadSchema = UsageOriginSchema.extend({
  schema:       z.literal('usage.tool_call.v1'),
  toolCallId:   z.string().max(64).nullable().optional(),
  toolRef:      z.string().regex(/^(builtin|ext|mcp):/).max(128),
  toolName:     z.string().max(64),
  execution:    z.enum(['SYNC', 'ASYNC', 'LONG_RUNNING']),
  durationMs:   z.number().int().nonnegative(),
  outcome:      z.enum(['COMPLETED', 'FAILED', 'CANCELLED']),
  errorCode:    z
    .string()
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$|^$/)
    .nullable()
    .optional(),
  scheduled:    z.boolean().optional(),
  jobId:        SfidStringSchema.nullable().optional(),
  occurredTime: z.number().int().nonnegative(),
  extensions:   z.record(z.unknown()).nullable().optional(),
});
export type UsageToolCallPayload = z.infer<typeof UsageToolCallPayloadSchema>;

/** Strict schema with cross-field rules (for emit-time validation). */
export const UsageToolCallPayloadStrictSchema = UsageToolCallPayloadSchema.superRefine(
  (data, ctx) => {
    if (data.execution === 'LONG_RUNNING' && data.outcome === 'COMPLETED' && !data.jobId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'jobId is required when execution=LONG_RUNNING and outcome=COMPLETED',
      });
    }
    if (data.outcome === 'FAILED' && !data.errorCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'errorCode is required when outcome=FAILED',
      });
    }
  },
);

// ─── usage.job_duration ────────────────────────────────────────────────────

/**
 * usage.job_duration payload (schema: usage.job_duration.v1).
 * Base shape for discriminated union use.
 * Cross-field rules available via UsageJobDurationPayloadStrictSchema.
 * Channel: outbox (strong-consistency path).
 * Ref: outbox-contract.md §5.2
 */
export const UsageJobDurationPayloadSchema = UsageOriginSchema.extend({
  schema:           z.literal('usage.job_duration.v1'),
  jobId:            SfidStringSchema,
  toolRef:          z.string().regex(/^(builtin|ext|mcp):/).max(128),
  toolName:         z.string().max(64),
  totalDurationMs:  z.number().int().nonnegative(),
  waitDurationMs:   z.number().int().nonnegative(),
  execDurationMs:   z.number().int().nonnegative(),
  attempts:         z.number().int().min(1),
  finalStatus:      z.enum(['COMPLETED', 'FAILED', 'CANCELLED']),
  errorCode:        z
    .string()
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$|^$/)
    .nullable()
    .optional(),
  occurredTime:     z.number().int().nonnegative(),
  extensions:       z.record(z.unknown()).nullable().optional(),
});
export type UsageJobDurationPayload = z.infer<typeof UsageJobDurationPayloadSchema>;

/** Strict schema with cross-field rules (for emit-time validation). */
export const UsageJobDurationPayloadStrictSchema = UsageJobDurationPayloadSchema.superRefine(
  (data, ctx) => {
    if (data.finalStatus === 'FAILED' && !data.errorCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'errorCode is required when finalStatus=FAILED',
      });
    }
  },
);

// ─── grant.approve ─────────────────────────────────────────────────────────

/** Non-usage outbox payload: grant approval event. */
export const GrantApprovePayloadSchema = z.object({
  schema:         z.literal('grant.approve.v1'),
  grantId:        SfidStringSchema,
  grantRequestId: SfidStringSchema,
  tenant:         z.number().int().min(1),
  userId:         z.string().max(64).nullable(),
  toolRef:        z.string().max(128),
  decision:       z.enum(['APPROVED', 'DENIED']),
  occurredTime:   z.number().int().nonnegative(),
});
export type GrantApprovePayload = z.infer<typeof GrantApprovePayloadSchema>;

// ─── session.end ───────────────────────────────────────────────────────────

/** Non-usage outbox payload: session end event. */
export const SessionEndPayloadSchema = z.object({
  schema:       z.literal('session.end.v1'),
  sessionId:    SfidStringSchema,
  tenant:       z.number().int().min(1),
  userId:       z.string().max(64).nullable(),
  reason:       z.enum(['USER_CLOSED', 'ADMIN_ARCHIVED', 'SYSTEM_TIMEOUT', 'ERROR']),
  occurredTime: z.number().int().nonnegative(),
});
export type SessionEndPayload = z.infer<typeof SessionEndPayloadSchema>;

// ─── Discriminated union (all known outbox payload types) ─────────────────

export const OutboxPayloadSchema = z.discriminatedUnion('schema', [
  UsageLlmCallPayloadSchema,
  UsageToolCallPayloadSchema,
  UsageJobDurationPayloadSchema,
  GrantApprovePayloadSchema,
  SessionEndPayloadSchema,
]);
export type OutboxPayload = z.infer<typeof OutboxPayloadSchema>;
