import { describe, expect, test } from "bun:test";

import { KB_INGEST_EVENT_TYPE, InMemoryIngestScheduler, MysqlOutboxIngestScheduler } from "./ingest-scheduler";

class FakeDatabaseService {
  public calls: { sql: string; params: unknown[] }[] = [];

  public async query(_sql: string, _params: unknown[] = []) {
    this.calls.push({ params: _params, sql: _sql });
    return [];
  }
}

describe("InMemoryIngestScheduler", () => {
  test("schedules kb.ingest.v1 with optional forceFull for W3.5", async () => {
    const scheduler = new InMemoryIngestScheduler();
    await scheduler.schedule({
      documentId: "101",
      forceFull: true,
      importJobId: "202",
      tenantId: "t1",
    });

    expect(KB_INGEST_EVENT_TYPE).toBe("kb.ingest");
    expect(scheduler.events).toHaveLength(1);
    expect(scheduler.events[0]?.schema).toBe("kb.ingest.v1");
    expect(scheduler.events[0]?.forceFull).toBe(true);
    expect(scheduler.pendingCount()).toBe(1);
    const claimed = scheduler.claim();
    expect(claimed?.attempt).toBe(1);
    expect(scheduler.pendingCount()).toBe(0);
  });
});

describe("MysqlOutboxIngestScheduler", () => {
  test("writes idempotent kb.ingest.v1 outbox row targeting the KB BullMQ queue", async () => {
    const database = new FakeDatabaseService();
    const scheduler = new MysqlOutboxIngestScheduler(database as never);
    await scheduler.schedule({
      documentId: "101",
      importJobId: "1234567890123456789",
      maxAttempts: 4,
      tenantId: "42",
    });

    expect(database.calls).toHaveLength(1);
    expect(database.calls[0]?.sql).toContain("INSERT INTO outbox_events");
    expect(database.calls[0]?.sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(database.calls[0]?.params[0]).toBe("1234567890123456789");
    expect(database.calls[0]?.params[1]).toBe(42);
    expect(database.calls[0]?.params[2]).toBe("kb.ingest");
    expect(database.calls[0]?.params[4]).toBe("agentic-kb-ingest");
    expect(JSON.parse(String(database.calls[0]?.params[3]))).toMatchObject({
      jobId: "1234567890123456789",
      maxAttempts: 4,
      schema: "kb.ingest.v1",
    });
  });

  test("fails closed when tenant cannot be represented by the shared outbox schema", async () => {
    const database = new FakeDatabaseService();
    const scheduler = new MysqlOutboxIngestScheduler(database as never);
    await expect(scheduler.schedule({ documentId: "101", importJobId: "1234567890123456789", tenantId: "tenant-a" })).rejects.toThrow(
      "numeric tenantId",
    );
    expect(database.calls).toHaveLength(0);
  });
});
