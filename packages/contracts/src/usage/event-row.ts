import { z } from "zod";

import { AuditFieldsSchema } from "../common/audit";
import { SfidSchema } from "../common/ids";
import { EpochMsSchema } from "../common/time";

/**
 * Zod schema for the `usage_events` table row (hot table, 7-day retention).
 *
 * Aligned with:
 *   docs/detailed-design/09-usage-events/README.md §5.1 (usage_events DDL)
 *
 * DDL excerpt:
 *   CREATE TABLE usage_events (
 *     id             BIGINT(20)   NOT NULL,
 *     tenant         INT(10)      NOT NULL,
 *     event_type     VARCHAR(48)  NOT NULL,
 *     user_id        VARCHAR(64)  NULL,
 *     session_id     BIGINT(20)   NULL,
 *     turn_id        BIGINT(20)   NULL,
 *     tool_call_id   VARCHAR(64)  NULL,
 *     job_id         BIGINT(20)   NULL,
 *     outcome        VARCHAR(16)  NULL,
 *     payload_json   JSON         NOT NULL,
 *     duration_ms    INT          NULL,
 *     input_tokens   INT          NULL,
 *     output_tokens  INT          NULL,
 *     tool_ref       VARCHAR(128) NULL,
 *     model          VARCHAR(64)  NULL,
 *     provider       VARCHAR(32)  NULL,
 *     error_code     VARCHAR(64)  NULL,
 *     occurred_time  DATETIME(3)  NOT NULL,
 *     deleted        BIGINT(20)   NOT NULL DEFAULT 0,
 *     -- + 10 audit fields
 *   )
 *
 * Event types are lowercase dot-notation (regulation §5.2 exception).
 * outcome / finalStatus enums are SNAKE_CASE UPPERCASE (regulation §5.2).
 */
export const UsageEventTypeSchema = z.enum(["usage.llm_call", "usage.tool_call", "usage.job_duration"]);
export type UsageEventType = z.infer<typeof UsageEventTypeSchema>;

export const UsageOutcomeSchema = z.enum(["COMPLETED", "FAILED", "CANCELLED"]);
export type UsageOutcome = z.infer<typeof UsageOutcomeSchema>;

export const UsageEventRowSchema = AuditFieldsSchema.extend({
  id: SfidSchema,
  eventType: UsageEventTypeSchema,

  // Traceability (SFID strings for BigInt ids, VARCHAR(64) for user/toolCallId)
  userId: z.string().max(64).nullable(),
  sessionId: SfidSchema.nullable(),
  turnId: SfidSchema.nullable(),
  toolCallId: z.string().max(64).nullable(),
  jobId: SfidSchema.nullable(),

  // Common dimension
  outcome: UsageOutcomeSchema.nullable(),

  // Full payload (camelCase keys)
  payloadJson: z.unknown(),

  // Flattened query-optimization columns (nullable, filled per event_type)
  durationMs: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  toolRef: z.string().max(128).nullable(),
  model: z.string().max(64).nullable(),
  provider: z.string().max(32).nullable(),
  errorCode: z.string().max(64).nullable(),

  // Business time (may differ from createTime by Bus lag)
  occurredTime: EpochMsSchema,
});

export type UsageEventRow = z.infer<typeof UsageEventRowSchema>;

/**
 * In-memory UsageEvent (before DB insertion).
 * Bus and Outbox routes both converge to this structure before Consumer writes to DB.
 * Aligned with: 09-usage-events/outbox-contract.md §2.1
 */
export const UsageEventSchema = z.object({
  eventType: UsageEventTypeSchema,
  id: SfidSchema,
  occurredTime: EpochMsSchema,
  /** Per-type payload — see outbox/payloads.ts for individual schemas. */
  payload: z.unknown(),
});
export type UsageEvent = z.infer<typeof UsageEventSchema>;
