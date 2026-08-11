import { DatabaseService, Injectable } from "@dangao/bun-server";

import {
  KB_VECTOR_RECONCILE_EVENT_TYPE,
  KB_VECTOR_RECONCILE_QUEUE_NAME,
  KbVectorReconcilePayloadSchema,
  type KbVectorReconcilePayload,
} from "@cube-ai/contracts";
import { currentTenantId } from "@cube-ai/tenant-context";

import { generateKbRecordId } from "../../../infrastructure/kb-record-id";

/** Schedules `kb.vector.reconcile` intents; production binds the MySQL outbox implementation. */
export const VECTOR_RECONCILE_SCHEDULER_TOKEN = Symbol.for("agentic.kb.vectorReconcileScheduler");

export interface VectorReconcileScheduler {
  schedule(event: Omit<KbVectorReconcilePayload, "schema" | "occurredTime"> & { occurredTime?: number }): Promise<void>;
}

/** Production scheduler backed by the shared MySQL outbox and BullMQ relay. */
@Injectable()
export class MysqlOutboxVectorReconcileScheduler implements VectorReconcileScheduler {
  public constructor(private readonly databaseService: DatabaseService) {}

  public async schedule(event: Omit<KbVectorReconcilePayload, "schema" | "occurredTime"> & { occurredTime?: number }): Promise<void> {
    const tenantId = currentTenantId()?.trim() ?? "";
    const tenant = Number(tenantId);
    if (tenantId === "" || !/^\d+$/u.test(tenantId) || !Number.isSafeInteger(tenant) || tenant <= 0) {
      throw new Error(`kb vector reconcile requires a numeric tenantId compatible with outbox_events.tenant: ${tenantId}`);
    }
    const jobId = generateKbRecordId();
    const payload = KbVectorReconcilePayloadSchema.parse({
      ...event,
      jobId,
      maxAttempts: event.maxAttempts ?? 5,
      occurredTime: event.occurredTime ?? Date.now(),
      schema: "kb.vector.reconcile.v1",
      tenantId,
    });
    const now = new Date();
    await this.databaseService.query(
      `INSERT INTO outbox_events (
        id, tenant, channel, event_type, payload_json, target,
        status, attempts, last_error, schedule_time, publish_time, next_attempt_time,
        deleted, create_by, creator_id, creator_type, create_time,
        update_by, updater_id, updater_type, update_time
      ) VALUES (?, ?, 'bullmq_job', ?, ?, ?, 'PENDING', 0, NULL, ?, NULL, NULL, 0,
        'kb-vector-reconcile', NULL, 'system', ?, 'kb-vector-reconcile', NULL, 'system', ?)`,
      [jobId, tenant, KB_VECTOR_RECONCILE_EVENT_TYPE, JSON.stringify(payload), KB_VECTOR_RECONCILE_QUEUE_NAME, now, now, now],
    );
  }
}

@Injectable()
export class InMemoryVectorReconcileScheduler implements VectorReconcileScheduler {
  public readonly events: KbVectorReconcilePayload[] = [];

  public async schedule(event: Omit<KbVectorReconcilePayload, "schema" | "occurredTime"> & { occurredTime?: number }): Promise<void> {
    const payload = KbVectorReconcilePayloadSchema.parse({
      ...event,
      documentId: event.documentId,
      occurredTime: event.occurredTime ?? Date.now(),
      reason: event.reason,
      schema: "kb.vector.reconcile.v1",
    });
    this.events.push(payload);
  }
}

/** Event type constant re-export for outbox row writers (channel remains host-chosen, e.g. bullmq_job). */
export { KB_VECTOR_RECONCILE_EVENT_TYPE };
