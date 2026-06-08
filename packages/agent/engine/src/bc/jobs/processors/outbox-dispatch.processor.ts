/**
 * Outbox-Dispatch Processor — consumes a BullMQ job carrying an outbox_events row id,
 * loads the row from MySQL, and invokes the composite Outbox dispatcher (P3-08 path).
 *
 * ref: bullmq-protocol §5 / P3-09 §3.4
 */
import { z } from 'zod';
import type { OutboxDispatcherI } from '@cube-ai/bun-server-ext-outbox';
import type { JobDataService } from '../job-data.service';

export const OUTBOX_DISPATCH_JOB_NAME = 'outbox.dispatch' as const;

export const OutboxDispatchJobPayloadSchema = z.object({
  outboxEventId: z.string().regex(/^[0-9]{19}$/),
});

export interface OutboxDispatchProcessorDeps {
  jobData: JobDataService;
  dispatcher: OutboxDispatcherI;
}

export async function runOutboxDispatchProcessor(
  data: unknown,
  deps: OutboxDispatchProcessorDeps,
): Promise<{ ok: boolean }> {
  const parsed = OutboxDispatchJobPayloadSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid outbox-dispatch payload: ${parsed.error.message}`);
  }

  const row = await deps.jobData.loadOutboxRowAsContract(parsed.data.outboxEventId);
  if (!row) {
    throw new Error(`outbox_events row not found: ${parsed.data.outboxEventId}`);
  }

  await deps.dispatcher.dispatch(row);
  return { ok: true };
}
