/**
 * JobResult contract — aligned with `docs/detailed-design/06-jobs/README.md` §3.1
 * (fields: `result_ref_json`, `error_code`, `error_detail_json`).
 *
 * Error codes follow naming-and-db-conventions §10.5 SNAKE_CASE CATEGORY_SUBJECT_REASON.
 * Job-specific codes are documented in `06-jobs/long-running-runtime.md` §10.
 */
import { z } from 'zod';
import { JobStatusSchema } from './job';

// ─── Terminal statuses only ────────────────────────────────────────────────────

export const JobTerminalStatusSchema = z.enum([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type JobTerminalStatus = z.infer<typeof JobTerminalStatusSchema>;

// ─── Error codes (long-running-runtime §10) ────────────────────────────────────

/**
 * SNAKE_CASE error codes that can appear in `jobs.error_code`.
 * Not the HTTP/SSE envelope codes — these are job-layer internal codes.
 */
export const JobErrorCodeSchema = z.enum([
  'JOB_NOT_FOUND',
  'JOB_ALREADY_TERMINAL',
  'PERMISSION_DENIED_JOB_OWNER',
  'JOB_STEP_TIMEOUT',
  'JOB_OVERALL_DEADLINE_EXCEEDED',
  'JOB_MAX_ATTEMPTS_EXCEEDED',
  'JOB_SERIALIZATION_CONFLICT',
  'JOB_CANCELLED_BY_USER',
  'PERMISSION_DENIED_AUTHZ_AT_RUNTIME',
  'TOOL_EXECUTION_NOT_IMPLEMENTED',
]);
export type JobErrorCode = z.infer<typeof JobErrorCodeSchema>;

// ─── JobResult schema ─────────────────────────────────────────────────────────

export const JobResultSchema = z.object({
  /** SFID */
  jobId: z.string().regex(/^[0-9]{10,20}$/),

  status: JobStatusSchema,

  /** Structured result reference (successful jobs only) */
  resultRef: z.unknown().optional(),

  /**
   * SNAKE_CASE error code — required when `status='FAILED'`.
   * Must match pattern `^[A-Z][A-Z0-9_]*$` per naming-and-db-conventions §10.5.
   */
  errorCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/, 'errorCode must be SNAKE_CASE UPPERCASE')
    .optional(),

  errorDetail: z.unknown().optional(),

  /** DATETIME-compatible timestamps */
  startTime: z.date().optional(),
  endTime:   z.date(),
}).refine(
  (v) => v.status !== 'FAILED' || v.errorCode != null,
  { message: 'errorCode is required when status is FAILED', path: ['errorCode'] },
);
export type JobResult = z.infer<typeof JobResultSchema>;

// ─── Cancel request ───────────────────────────────────────────────────────────

export const JobCancelRequestSchema = z.object({
  reason: z.string().max(256).optional(),
});
export type JobCancelRequest = z.infer<typeof JobCancelRequestSchema>;
