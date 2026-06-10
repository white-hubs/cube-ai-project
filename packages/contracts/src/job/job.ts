import { z } from 'zod';
import { SfidSchema } from '../common/ids';
import { EpochMsSchema } from '../common/time';
import { toolCallIdSchema } from '../tool-ack/ack';

/**
 * Job status enum — SNAKE_CASE UPPERCASE (规范 §5.2).
 * Ref: docs/detailed-design/08-sdk/contracts.md §4.7
 */
export const JobStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'DEAD',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobKindSchema = z.enum([
  'BUILTIN',
  'EXT',
  'MCP',
  'MEMORY_PURGE',
  'SESSION_GC',
]);
export type JobKind = z.infer<typeof JobKindSchema>;

export const JobSchema = z.object({
  id:            SfidSchema,
  jobKind:       JobKindSchema,
  toolRef:       z.string().nullable(),
  toolName:      z.string().nullable(),
  status:        JobStatusSchema,
  attempts:      z.number().int().nonnegative(),
  sessionId:     SfidSchema.nullable(),
  turnId:        SfidSchema.nullable(),
  toolCallId:    toolCallIdSchema.nullable(),
  queuedTime:    EpochMsSchema,
  startTime:     EpochMsSchema.nullable(),
  endTime:       EpochMsSchema.nullable(),
  progress:      z.object({
    percent: z.number().min(0).max(100),
    message: z.string().max(256).optional(),
  }).nullable().optional(),
  resultSummary: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.object({
    code:    z.string(),
    message: z.string(),
  }).nullable().optional(),
  createTime:    EpochMsSchema,
  updateTime:    EpochMsSchema,
});
export type Job = z.infer<typeof JobSchema>;
