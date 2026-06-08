import { z } from 'zod';
import { SfidSchema } from '../common/ids';
import { EpochMsSchema } from '../common/time';

/**
 * Session lifecycle outbox events.
 * channel = 'session_lifecycle'; eventType = lowercase.dotted (regulation §5.2 exception)
 * All payload fields: camelCase (regulation §5.2)
 *
 * ref: docs/detailed-design/05-session/lifecycle.md §7 Outbox 事件清单
 */
export const SessionOpenedEventSchema = z.object({
  eventType: z.literal('session.created'),
  sessionId: SfidSchema,
  /** epoch ms */
  createTime: EpochMsSchema,
  agentId: SfidSchema,
  agentVersionNo: z.number().int().positive(),
  /** VARCHAR(64) external user id */
  userId: z.string().max(64),
});
export type SessionOpenedEvent = z.infer<typeof SessionOpenedEventSchema>;

export const SessionClosedEventSchema = z.object({
  eventType: z.literal('session.closed'),
  sessionId: SfidSchema,
  /** epoch ms */
  closeTime: EpochMsSchema,
});
export type SessionClosedEvent = z.infer<typeof SessionClosedEventSchema>;

export const SessionReopenedEventSchema = z.object({
  eventType: z.literal('session.reopened'),
  sessionId: SfidSchema,
  reopenTime: EpochMsSchema,
});
export type SessionReopenedEvent = z.infer<typeof SessionReopenedEventSchema>;

export const SessionDeletedEventSchema = z.object({
  eventType: z.literal('session.deleted'),
  sessionId: SfidSchema,
  /** epoch ms of soft-delete (deleted column value) */
  deleted: EpochMsSchema,
});
export type SessionDeletedEvent = z.infer<typeof SessionDeletedEventSchema>;

/**
 * Discriminated union of all session lifecycle outbox events.
 * ref: lifecycle.md §7
 */
export const SessionLifecycleEventSchema = z.discriminatedUnion('eventType', [
  SessionOpenedEventSchema,
  SessionClosedEventSchema,
  SessionReopenedEventSchema,
  SessionDeletedEventSchema,
]);
export type SessionLifecycleEvent = z.infer<typeof SessionLifecycleEventSchema>;

// Turn lifecycle Outbox events (channel=session_lifecycle)
// NOTE: Named with "Outbox" suffix to avoid collision with SSE TurnStartedEvent in sse/event-base.ts

export const TurnStartedOutboxEventSchema = z.object({
  eventType: z.literal('turn.started'),
  turnId: SfidSchema,
  sessionId: SfidSchema,
  turnNo: z.number().int().positive(),
  startTime: EpochMsSchema,
});
export type TurnStartedOutboxEvent = z.infer<typeof TurnStartedOutboxEventSchema>;

export const TurnCompletedOutboxEventSchema = z.object({
  eventType: z.literal('turn.completed'),
  turnId: SfidSchema,
  closeTime: EpochMsSchema,
  durationMs: z.number().int().nonnegative(),
  tokenUsage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    })
    .optional(),
});
export type TurnCompletedOutboxEvent = z.infer<typeof TurnCompletedOutboxEventSchema>;

export const TurnCancelledOutboxEventSchema = z.object({
  eventType: z.literal('turn.cancelled'),
  turnId: SfidSchema,
  /** UPPERCASE reason (regulation §5.2) */
  reason: z.enum([
    'USER_REQUEST',
    'TIMEOUT',
    'ADMINISTRATIVE',
    'CONSENT_TIMEOUT',
    'CONSENT_DENIED',
    'ENGINE_DRAINING',
  ]),
  closeTime: EpochMsSchema,
});
export type TurnCancelledOutboxEvent = z.infer<typeof TurnCancelledOutboxEventSchema>;

export const TurnFailedOutboxEventSchema = z.object({
  eventType: z.literal('turn.failed'),
  turnId: SfidSchema,
  /** SNAKE_CASE CATEGORY_SUBJECT_REASON error code (regulation §6) */
  errorCode: z.string().regex(/^[A-Z][A-Z_]+$/),
  closeTime: EpochMsSchema,
});
export type TurnFailedOutboxEvent = z.infer<typeof TurnFailedOutboxEventSchema>;

export const TurnLifecycleEventSchema = z.discriminatedUnion('eventType', [
  TurnStartedOutboxEventSchema,
  TurnCompletedOutboxEventSchema,
  TurnCancelledOutboxEventSchema,
  TurnFailedOutboxEventSchema,
]);
export type TurnLifecycleEvent = z.infer<typeof TurnLifecycleEventSchema>;
