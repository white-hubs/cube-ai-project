import { describe, expect, test } from "bun:test";

import { KB_VECTOR_RECONCILE_QUEUE_NAME } from "@cube-ai/contracts";
import { currentTenantId, tenantContextAls } from "@cube-ai/tenant-context";

import { MysqlOutboxVectorReconcileScheduler } from "./vector-reconcile-scheduler";
import { VectorReconcileWorkerService } from "./vector-reconcile-worker.service";

class FakeDatabase {
  public calls: { sql: string; params: unknown[] }[] = [];

  public async query(sql: string, params: unknown[]) {
    this.calls.push({ params, sql });
    return [];
  }
}

describe("persistent vector reconcile", () => {
  test("scheduler writes a tenant-scoped BullMQ outbox row", async () => {
    const database = new FakeDatabase();
    const scheduler = new MysqlOutboxVectorReconcileScheduler(database as never);

    await tenantContextAls.run({ tenantId: "42" }, () => scheduler.schedule({ documentId: "doc-1", reason: "FULL_INDEX" }));

    expect(database.calls).toHaveLength(1);
    expect(database.calls[0]?.params[1]).toBe(42);
    expect(database.calls[0]?.params[4]).toBe(KB_VECTOR_RECONCILE_QUEUE_NAME);
    const payload = JSON.parse(String(database.calls[0]?.params[3])) as Record<string, unknown>;
    expect(payload.tenantId).toBe("42");
    expect(payload.jobId).toBe(database.calls[0]?.params[0]);
  });

  test("worker restores tenant scope before reconciliation", async () => {
    let seenTenant: string | null = null;
    const service = {
      async reconcileDocument(documentId: string) {
        seenTenant = currentTenantId();
        return { documentId };
      },
    };
    const logger = { error() {}, info() {}, warn() {} };
    const worker = new VectorReconcileWorkerService(service as never, logger as never);

    const result = await worker.processPayload({
      documentId: "doc-1",
      jobId: "123",
      occurredTime: 1,
      reason: "MANUAL",
      schema: "kb.vector.reconcile.v1",
      tenantId: "42",
    });

    expect(String(seenTenant)).toBe("42");
    expect(result.documentId).toBe("doc-1");
  });

  test("scheduler and worker reject missing/non-numeric tenant context", async () => {
    const scheduler = new MysqlOutboxVectorReconcileScheduler(new FakeDatabase() as never);
    await expect(scheduler.schedule({ documentId: "doc-1", reason: "MANUAL" })).rejects.toThrow(/numeric tenantId/);

    const worker = new VectorReconcileWorkerService({ reconcileDocument: async () => ({}) } as never, {} as never);
    await expect(
      worker.processPayload({
        documentId: "doc-1",
        occurredTime: 1,
        reason: "MANUAL",
        schema: "kb.vector.reconcile.v1",
      }),
    ).rejects.toThrow(/missing tenantId/);
  });
});
