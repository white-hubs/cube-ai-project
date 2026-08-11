import { DatabaseService, Injectable } from "@dangao/bun-server";

import { KB_INGEST_EVENT_TYPE, KB_INGEST_QUEUE_NAME, KbIngestPayloadSchema, type KbIngestPayload } from "@cube-ai/contracts";

/**
 * Schedules `kb.ingest` intents. Production uses the MySQL outbox; the
 * in-memory implementation below is test-only.
 */
export const INGEST_SCHEDULER_TOKEN = Symbol.for("agentic.kb.ingestScheduler");

export type ScheduleIngestInput = Omit<KbIngestPayload, "schema" | "occurredTime"> & {
  occurredTime?: number;
};

export interface IngestScheduler {
  schedule(event: ScheduleIngestInput): Promise<void>;
}

/** Production scheduler backed by the shared MySQL outbox + relay. */
@Injectable()
export class MysqlOutboxIngestScheduler implements IngestScheduler {
  public constructor(private readonly databaseService: DatabaseService) {}

  public async schedule(event: ScheduleIngestInput): Promise<void> {
    const payload = KbIngestPayloadSchema.parse({
      ...event,
      occurredTime: event.occurredTime ?? Date.now(),
      schema: "kb.ingest.v1",
    });
    if (!/^\d{1,19}$/u.test(payload.importJobId)) {
      throw new Error(`kb ingest importJobId must be a 1-19 digit SFID: ${payload.importJobId}`);
    }
    const tenantId = typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";
    const tenant = Number(tenantId);
    if (tenantId === "" || !/^\d+$/u.test(tenantId) || !Number.isSafeInteger(tenant) || tenant <= 0) {
      throw new Error(`kb ingest requires a numeric tenantId compatible with outbox_events.tenant: ${String(payload.tenantId)}`);
    }

    const now = new Date();
    const wirePayload = JSON.stringify({ ...payload, jobId: payload.importJobId });
    await this.databaseService.query(
      `INSERT INTO outbox_events (
        id, tenant, channel, event_type, payload_json, target,
        status, attempts, last_error, schedule_time, publish_time, next_attempt_time,
        deleted, create_by, creator_id, creator_type, create_time,
        update_by, updater_id, updater_type, update_time
      ) VALUES (?, ?, 'bullmq_job', ?, ?, ?, 'PENDING', 0, NULL, ?, NULL, NULL, 0,
        'kb-ingest', NULL, 'system', ?, 'kb-ingest', NULL, 'system', ?)
      ON DUPLICATE KEY UPDATE
        tenant = VALUES(tenant), event_type = VALUES(event_type), payload_json = VALUES(payload_json),
        target = VALUES(target), status = 'PENDING', attempts = 0, last_error = NULL,
        schedule_time = VALUES(schedule_time), publish_time = NULL, next_attempt_time = NULL,
        update_by = VALUES(update_by), updater_type = VALUES(updater_type), update_time = VALUES(update_time)`,
      [payload.importJobId, tenant, KB_INGEST_EVENT_TYPE, wirePayload, KB_INGEST_QUEUE_NAME, now, now, now],
    );
  }
}

export type ClaimedIngestJob = KbIngestPayload & { attempt: number };

@Injectable()
export class InMemoryIngestScheduler implements IngestScheduler {
  /** All scheduled payloads (audit / test assertions). */
  public readonly events: KbIngestPayload[] = [];
  /** Pending work queue claimed by {@link IngestWorkerService}. */
  private readonly pending: ClaimedIngestJob[] = [];

  public async schedule(event: ScheduleIngestInput): Promise<void> {
    const payload = KbIngestPayloadSchema.parse({
      attempt: event.attempt,
      chunkOverlap: event.chunkOverlap,
      chunkSize: event.chunkSize,
      documentId: event.documentId,
      forceFull: event.forceFull,
      importJobId: event.importJobId,
      maxAttempts: event.maxAttempts,
      occurredTime: event.occurredTime ?? Date.now(),
      schema: "kb.ingest.v1",
      separator: event.separator,
      tableChunkMode: event.tableChunkMode,
      tenantId: event.tenantId,
      textChunkMode: event.textChunkMode,
    });
    this.events.push(payload);
    this.pending.push({
      ...payload,
      attempt: payload.attempt ?? 1,
    });
  }

  /** Claim next pending job (FIFO). Returns undefined when empty. */
  public claim(): ClaimedIngestJob | undefined {
    return this.pending.shift();
  }

  public pendingCount(): number {
    return this.pending.length;
  }
}

/** Event type constant re-export for outbox row writers (channel remains host-chosen, e.g. bullmq_job). */
export { KB_INGEST_EVENT_TYPE };
