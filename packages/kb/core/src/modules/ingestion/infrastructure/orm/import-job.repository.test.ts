import { type Logger } from "@dangao/bun-server";
import { describe, expect, test } from "bun:test";

import { tenantContextAls } from "@cube-ai/tenant-context";

import { ImportJobRepositoryOrm } from "./import-job.repository";

const fakeLogger = {
  debug() {},
  error() {},
  info() {},
  log() {},
  trace() {},
  warn() {},
} as unknown as Logger;

class RecoveryDatabaseService {
  public readonly calls: { params?: unknown[]; sql: string }[] = [];

  public query<T = unknown>(sql: string, params?: unknown[]): T[] {
    this.calls.push({ params, sql });
    return [];
  }
}

describe("ImportJobRepositoryOrm recovery paging", () => {
  test("uses a tenant-scoped create_time/id keyset cursor", async () => {
    const database = new RecoveryDatabaseService();
    const repository = new ImportJobRepositoryOrm(database as never, fakeLogger);
    const cursorTime = new Date("2026-01-01T00:00:00.000Z");

    await tenantContextAls.run({ tenantId: "tenant-a" }, () =>
      repository.listRecoverableJobsPage({
        after: { createTime: cursorTime, id: "job-200" },
        limit: 5000,
      }),
    );

    const call = database.calls[0];
    expect(call?.sql).toContain("create_time > ? OR (create_time = ? AND id > ?)");
    expect(call?.sql).toContain("tenant_id = ?");
    expect(call?.sql).toContain("ORDER BY create_time ASC, id ASC LIMIT ?");
    expect(call?.params).toEqual([cursorTime, cursorTime, "job-200", "tenant-a", 1000]);
  });
});
