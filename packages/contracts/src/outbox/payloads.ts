import { z } from "zod";

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
 *   - grant.approve         → GrantApprovePayload
 *   - session.end           → SessionEndPayload
 *   - kb.vector.reconcile   → KbVectorReconcilePayload
 *   - kb.ingest             → KbIngestPayload
 *
 * Note: z.discriminatedUnion() requires ZodObject members (not ZodEffects).
 * Cross-field validation rules are available via the *StrictSchema exports.
 */

// ─── Common ────────────────────────────────────────────────────────────────

const SfidStringSchema = z.string().regex(/^\d{1,20}$/u, "Must be SFID decimal string");

/** Common origin fields shared by all usage payloads. */
const UsageOriginSchema = z.object({
  sessionId: SfidStringSchema.nullable().optional(),
  tenant: z.number().int().min(1),
  turnId: SfidStringSchema.nullable().optional(),
  userId: z.string().max(64).nullable().optional(),
});

// ─── usage.llm_call ────────────────────────────────────────────────────────

/**
 * usage.llm_call payload (schema: usage.llm_call.v1).
 * Ref: outbox-contract.md §3.2
 */
export const UsageLlmCallPayloadSchema = UsageOriginSchema.extend({
  cachedTokens: z.number().int().nonnegative().nullable().optional(),
  durationMs: z.number().int().nonnegative(),
  errorCode: z
    .string()
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$|^$/u)
    .nullable()
    .optional(),
  extensions: z.record(z.string(), z.unknown()).nullable().optional(),
  inputTokens: z.number().int().nonnegative(),
  model: z.string().max(64),
  occurredTime: z.number().int().nonnegative(),
  outcome: z.enum(["COMPLETED", "FAILED"]),
  outputTokens: z.number().int().nonnegative(),
  phase: z.enum(["INITIAL", "TOOL_LOOP", "FINAL"]).nullable().optional(),
  provider: z.enum(["OPENAI", "ANTHROPIC", "BEDROCK", "QWEN", "DEEPSEEK", "DOUBAO", "OTHER"]),
  schema: z.literal("usage.llm_call.v1"),
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
  durationMs: z.number().int().nonnegative(),
  errorCode: z
    .string()
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$|^$/u)
    .nullable()
    .optional(),
  execution: z.enum(["SYNC", "ASYNC", "LONG_RUNNING"]),
  extensions: z.record(z.string(), z.unknown()).nullable().optional(),
  jobId: SfidStringSchema.nullable().optional(),
  occurredTime: z.number().int().nonnegative(),
  outcome: z.enum(["COMPLETED", "FAILED", "CANCELLED"]),
  scheduled: z.boolean().optional(),
  schema: z.literal("usage.tool_call.v1"),
  toolCallId: z.string().max(64).nullable().optional(),
  toolName: z.string().max(64),
  toolRef: z
    .string()
    .regex(/^(builtin|ext|mcp):/u)
    .max(128),
});
export type UsageToolCallPayload = z.infer<typeof UsageToolCallPayloadSchema>;

/** Strict schema with cross-field rules (for emit-time validation). */
export const UsageToolCallPayloadStrictSchema = UsageToolCallPayloadSchema.superRefine((data, ctx) => {
  if (data.execution === "LONG_RUNNING" && data.outcome === "COMPLETED" && !data.jobId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "jobId is required when execution=LONG_RUNNING and outcome=COMPLETED",
    });
  }
  if (data.outcome === "FAILED" && !data.errorCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "errorCode is required when outcome=FAILED",
    });
  }
});

// ─── usage.job_duration ────────────────────────────────────────────────────

/**
 * usage.job_duration payload (schema: usage.job_duration.v1).
 * Base shape for discriminated union use.
 * Cross-field rules available via UsageJobDurationPayloadStrictSchema.
 * Channel: outbox (strong-consistency path).
 * Ref: outbox-contract.md §5.2
 */
export const UsageJobDurationPayloadSchema = UsageOriginSchema.extend({
  attempts: z.number().int().min(1),
  errorCode: z
    .string()
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$|^$/u)
    .nullable()
    .optional(),
  execDurationMs: z.number().int().nonnegative(),
  extensions: z.record(z.string(), z.unknown()).nullable().optional(),
  finalStatus: z.enum(["COMPLETED", "FAILED", "CANCELLED"]),
  jobId: SfidStringSchema,
  occurredTime: z.number().int().nonnegative(),
  schema: z.literal("usage.job_duration.v1"),
  toolName: z.string().max(64),
  toolRef: z
    .string()
    .regex(/^(builtin|ext|mcp):/u)
    .max(128),
  totalDurationMs: z.number().int().nonnegative(),
  waitDurationMs: z.number().int().nonnegative(),
});
export type UsageJobDurationPayload = z.infer<typeof UsageJobDurationPayloadSchema>;

/** Strict schema with cross-field rules (for emit-time validation). */
export const UsageJobDurationPayloadStrictSchema = UsageJobDurationPayloadSchema.superRefine((data, ctx) => {
  if (data.finalStatus === "FAILED" && !data.errorCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "errorCode is required when finalStatus=FAILED",
    });
  }
});

// ─── grant.approve ─────────────────────────────────────────────────────────

/** Non-usage outbox payload: grant approval event. */
export const GrantApprovePayloadSchema = z.object({
  decision: z.enum(["APPROVED", "DENIED"]),
  grantId: SfidStringSchema,
  grantRequestId: SfidStringSchema,
  occurredTime: z.number().int().nonnegative(),
  schema: z.literal("grant.approve.v1"),
  tenant: z.number().int().min(1),
  toolRef: z.string().max(128),
  userId: z.string().max(64).nullable(),
});
export type GrantApprovePayload = z.infer<typeof GrantApprovePayloadSchema>;

// ─── session.end ───────────────────────────────────────────────────────────

/** Non-usage outbox payload: session end event. */
export const SessionEndPayloadSchema = z.object({
  occurredTime: z.number().int().nonnegative(),
  reason: z.enum(["USER_CLOSED", "ADMIN_ARCHIVED", "SYSTEM_TIMEOUT", "ERROR"]),
  schema: z.literal("session.end.v1"),
  sessionId: SfidStringSchema,
  tenant: z.number().int().min(1),
  userId: z.string().max(64).nullable(),
});
export type SessionEndPayload = z.infer<typeof SessionEndPayloadSchema>;

// ─── kb.vector.reconcile ───────────────────────────────────────────────────

/** Outbox event type for MySQL-authoritative vector reconcile (W3.1). */
export const KB_VECTOR_RECONCILE_EVENT_TYPE = "kb.vector.reconcile" as const;

/**
 * Non-usage outbox payload: kb vector store reconcile (schema: kb.vector.reconcile.v1).
 * MySQL is authoritative; consumers call the shared VectorReconcileService.
 */
export const KbVectorReconcilePayloadSchema = z.object({
  documentId: z.string().min(1).max(64),
  jobId: z
    .string()
    .regex(/^\d{1,19}$/u)
    .optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(),
  occurredTime: z.number().int().nonnegative(),
  reason: z.enum(["FULL_INDEX", "SINGLE_CHUNK", "DELETE_DOCUMENT", "MANUAL"]),
  schema: z.literal("kb.vector.reconcile.v1"),
  tenantId: z.string().min(1).max(64).optional(),
});
export type KbVectorReconcilePayload = z.infer<typeof KbVectorReconcilePayloadSchema>;

// ─── kb.ingest ─────────────────────────────────────────────────────────────

/** Outbox event type for async document ingestion (W3.3). */
export const KB_INGEST_EVENT_TYPE = "kb.ingest" as const;

/**
 * Non-usage outbox payload: kb document ingest (schema: kb.ingest.v1).
 * HTTP enqueues; worker claims → IngestionService.ingestDocument.
 * `forceFull` is reserved for W3.5 incremental re-embed.
 */
export const KbIngestPayloadSchema = z.object({
  attempt: z.number().int().min(1).optional(),
  chunkOverlap: z.number().int().nonnegative().optional(),
  chunkSize: z.number().int().positive().optional(),
  documentId: z.string().min(1).max(64),
  /** Reserved for W3.5 — when true, worker must full re-embed (ignored until W3.5). */
  forceFull: z.boolean().optional(),
  importJobId: z.string().min(1).max(64),
  maxAttempts: z.number().int().min(1).max(20).optional(),
  occurredTime: z.number().int().nonnegative(),
  schema: z.literal("kb.ingest.v1"),
  separator: z.string().max(64).optional(),
  tableChunkMode: z.enum(["auto", "row", "window"]).optional(),
  tenantId: z.string().max(64).nullable().optional(),
  textChunkMode: z.enum(["auto", "block", "merge"]).optional(),
});
export type KbIngestPayload = z.infer<typeof KbIngestPayloadSchema>;

// ─── Discriminated union (all known outbox payload types) ─────────────────

export const OutboxPayloadSchema = z.discriminatedUnion("schema", [
  UsageLlmCallPayloadSchema,
  UsageToolCallPayloadSchema,
  UsageJobDurationPayloadSchema,
  GrantApprovePayloadSchema,
  SessionEndPayloadSchema,
  KbVectorReconcilePayloadSchema,
  KbIngestPayloadSchema,
]);
export type OutboxPayload = z.infer<typeof OutboxPayloadSchema>;
