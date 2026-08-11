/**
 * Job contracts — aligned with `docs/detailed-design/06-jobs/README.md` §3.
 *
 * - `jobs` table DDL (§3.1): SFID PK, tenant INT(10), DATETIME(3) times,
 *   SNAKE_CASE enums, 10 audit fields.
 * - BullMQ payload: minimal (`jobId / toolRef / tenant`) per §J3 §2.1.
 * - `idempotency_key` rule (§3.3): sha256(tenant|session|turn|toolCallId)
 */
import { z } from "zod";

// ─── Enum schemas ────────────────────────────────────────────────────────────

/** `jobs.status` — SNAKE_CASE per naming-and-db-conventions §5.2 */
export const JobStatusSchema = z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** `jobs.kind` — SNAKE_CASE per naming-and-db-conventions §5.2 */
export const JobKindSchema = z.enum(["TOOL", "CLEANUP", "OUTBOX", "MCP_DISCOVERY"]);
export type JobKind = z.infer<typeof JobKindSchema>;

/**
 * Queue names accepted in `jobs.queue`.
 * M1 only activates LONG_RUNNING_JOBS and CLEANUP (bullmq-protocol §1).
 */
export const KB_INGEST_QUEUE_NAME = "agentic-kb-ingest" as const;
export const KB_VECTOR_RECONCILE_QUEUE_NAME = "agentic-kb-vector-reconcile" as const;
export const JobQueueNameSchema = z.enum([
  "agentic-engine-long-running-jobs",
  "agentic-engine-cleanup",
  KB_INGEST_QUEUE_NAME,
  KB_VECTOR_RECONCILE_QUEUE_NAME,
]);
export type JobQueueName = z.infer<typeof JobQueueNameSchema>;

// ─── BullMQ minimal payload (J3 §2.1) ────────────────────────────────────────

/**
 * BullMQ `job.data` — minimal carrier; full job details are in MySQL `jobs`.
 * camelCase per naming-and-db-conventions §3.
 */
export const BullMQJobPayloadSchema = z.object({
  /** `jobs.id` — SFID decimal string */
  jobId: z.string().regex(/^[0-9]{10,20}$/u, "jobId must be an SFID decimal string"),
  /** `jobs.tenant` — INT(10) */
  tenant: z.number().int().positive(),
  /** `jobs.tool_ref` — metrics label convenience; optional for cleanup jobs */
  toolRef: z.string().max(128).optional(),
});
export type BullMQJobPayload = z.infer<typeof BullMQJobPayloadSchema>;

// ─── Full Job schema (application-layer; not the DB row) ─────────────────────

/**
 * Application-layer Job record.
 * Maps to the `jobs` table but uses camelCase for TS/JSON.
 * Priority / backoff fields are set at the BullMQ level (J3 §3).
 */
export const JobSchema = z.object({
  /** Times attempted; starts at 0 */
  attempts: z.number().int().min(0),

  /** DATETIME(3) audit — naming-and-db-conventions §R5-§R8 */
  createTime: z.date(),

  endTime: z.date().optional(),

  /** SFID — 19-20 decimal digits (naming-and-db-conventions §2) */
  id: z.string().regex(/^[0-9]{10,20}$/u, "id must be a SFID decimal string"),

  /** Idempotency key; sha256(tenant|session|turn|toolCallId) for TOOL kind */
  idempotencyKey: z.string().max(128),

  kind: JobKindSchema,

  maxAttempts: z.number().int().min(1).default(3),

  /** Wall-clock deadline; default now + 24 h */
  overallDeadlineTime: z.date(),

  queue: JobQueueNameSchema,

  sessionId: z
    .string()
    .regex(/^[0-9]+$/u)
    .optional(),

  startTime: z.date().optional(),

  status: JobStatusSchema,

  /** INT(10) per naming-and-db-conventions §R2 */
  tenant: z.number().int().positive(),

  /** Single-step timeout; default 5 min */
  timeoutMs: z.number().int().positive().default(300_000),

  toolCallId: z.string().max(64).optional(),

  /** Optional tracing fields */
  toolRef: z.string().max(128).optional(),

  turnId: z
    .string()
    .regex(/^[0-9]+$/u)
    .optional(),

  updateTime: z.date(),

  userId: z.string().max(64).optional(),
});
export type Job = z.infer<typeof JobSchema>;

// ─── principal_snapshot_json schema (J1 §3.2) ────────────────────────────────

/**
 * Minimal UserPrincipal snapshot stored in `jobs.principal_snapshot_json`.
 * No access-token — Worker re-exchanges via MockOBO.
 * camelCase per naming-and-db-conventions §3.
 */
export const JobPrincipalSnapshotSchema = z.object({
  capturedTime: z.number().int().positive(),
  oboAudiencesNeeded: z.array(z.string()),
  schema: z.literal("job-principal-v1"),
  scopes: z.array(z.string()),
  tenant: z.number().int().positive(),
  userId: z.string().max(64),
});
export type JobPrincipalSnapshot = z.infer<typeof JobPrincipalSnapshotSchema>;
