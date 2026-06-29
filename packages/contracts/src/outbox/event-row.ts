import { z } from "zod";

import { AuditFieldsSchema } from "../common/audit";
import { SfidSchema } from "../common/ids";
import { EpochMsSchema } from "../common/time";

/**
 * Outbox event channel enum (authority: 06-jobs/README.md §4.2).
 * Naming: lowercase_snake (routing key, NOT a business event type).
 */
export const OutboxChannelSchema = z.enum([
  "bullmq_job",
  "message_service",
  "usage_bus",
  /** Usage events routed to downstream `agentic-usage-events` (Phase 3 P3-11). */
  "usage_event",
  "descriptor_reload",
  "authz_invalidate",
  "session_lifecycle",
]);
export type OutboxChannel = z.infer<typeof OutboxChannelSchema>;

export const OutboxStatusSchema = z.enum(["PENDING", "PUBLISHED", "FAILED", "DEAD"]);
export type OutboxStatus = z.infer<typeof OutboxStatusSchema>;

/**
 * Zod schema for the `outbox_events` table row.
 *
 * Aligned with:
 *   docs/detailed-design/06-jobs/README.md §4.1 (outbox_events DDL)
 *
 * DDL:
 *   CREATE TABLE outbox_events (
 *     id                BIGINT(20)    NOT NULL,
 *     tenant            INT(10)       NOT NULL,
 *     channel           VARCHAR(48)   NOT NULL,
 *     event_type        VARCHAR(64)   NOT NULL,
 *     payload_json      JSON          NOT NULL,
 *     target            VARCHAR(128)  NULL,
 *     status            VARCHAR(16)   NOT NULL,
 *     attempts          INT           NOT NULL DEFAULT 0,
 *     last_error        VARCHAR(1024) NULL,
 *     schedule_time     DATETIME(3)   NOT NULL,
 *     publish_time      DATETIME(3)   NULL,
 *     next_attempt_time DATETIME(3)   NULL,
 *     deleted           BIGINT(20)    NOT NULL DEFAULT 0,
 *     -- + 10 audit fields
 *   )
 */
export const OutboxEventRowSchema = AuditFieldsSchema.extend({
  attempts: z.number().int().nonnegative(),
  channel: OutboxChannelSchema,
  /**
   * event_type: retained lowercase dot-notation (regulation §5.2 exception).
   * Examples: 'usage.job_duration', 'session.created', 'job.completed'
   */
  eventType: z.string().max(64),
  id: SfidSchema,
  lastError: z.string().max(1024).nullable(),
  nextAttemptTime: EpochMsSchema.nullable(),
  /** JSON payload (camelCase keys per regulation §3). */
  payloadJson: z.unknown(),
  publishTime: EpochMsSchema.nullable(),
  /** Epoch ms: earliest time Relay may scan this row. */
  scheduleTime: EpochMsSchema,
  status: OutboxStatusSchema,
  /** Optional routing key (e.g. BullMQ queue name). */
  target: z.string().max(128).nullable(),
});

export type OutboxEventRow = z.infer<typeof OutboxEventRowSchema>;

/**
 * Input for appending a new outbox row.
 * Caller omits id and audit fields (generated server-side), as well as status/retry fields.
 */
export type AppendOutboxInput = Omit<
  OutboxEventRow,
  | "id"
  | "createBy"
  | "creatorId"
  | "creatorType"
  | "createTime"
  | "updateBy"
  | "updaterId"
  | "updaterType"
  | "updateTime"
  | "deleted"
  | "status"
  | "attempts"
  | "lastError"
  | "publishTime"
  | "nextAttemptTime"
>;
