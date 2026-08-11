/**
 * P1-07 jobs domain barrel.
 *
 * NOTE: `JobSchema/JobStatusSchema/JobKindSchema` (DB-row + BullMQ scheduler view)
 * collide with the canonical SDK-facing `JobSchema` from `../job/` (P1-09;
 * aligned with detailed-design/08-sdk/contracts.md §4.7). To keep the
 * top-level barrel unambiguous, this file re-exports only the symbols
 * that are NOT redefined elsewhere:
 *   - BullMQ payload (`BullMQJobPayloadSchema`)
 *   - Queue names (`JobQueueNameSchema`)
 *   - Principal snapshot (`JobPrincipalSnapshotSchema`)
 *   - Job result + terminal status + job-layer error codes
 *
 * The full P1-07 `JobSchema` lives in `./job.ts` and is consumed
 * domain-internally by `job-result.ts` only.
 */
export {
  BullMQJobPayloadSchema,
  type BullMQJobPayload,
  JobQueueNameSchema,
  KB_INGEST_QUEUE_NAME,
  KB_VECTOR_RECONCILE_QUEUE_NAME,
  type JobQueueName,
  JobPrincipalSnapshotSchema,
  type JobPrincipalSnapshot,
} from "./job";
export * from "./job-result";
