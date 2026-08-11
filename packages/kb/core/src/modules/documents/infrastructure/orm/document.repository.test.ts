import { type Logger } from "@dangao/bun-server";
import { describe, expect, test } from "bun:test";

import { tenantContextAls } from "@cube-ai/tenant-context";

import { DocumentRepositoryOrm } from "./document.repository";

const fakeLogger = {
  debug() {},
  error() {},
  info() {},
  log() {},
  trace() {},
  warn() {},
} as unknown as Logger;

class ActivationDatabaseService {
  public readonly calls: { sql: string; params?: unknown[] }[] = [];
  public activeGenerationId = "legacy";
  public activeGenerationJobId: string | null = null;
  public acceptUpdate = true;

  public query<T = unknown>(sql: string, params?: unknown[]): T[] {
    this.calls.push({ params, sql });
    if (sql.startsWith("UPDATE document_record") && this.acceptUpdate) {
      this.activeGenerationId = String(params?.[0]);
      if (sql.includes("active_generation_job_id = ?")) {
        this.activeGenerationJobId = String(params?.[1]);
      }
      return [];
    }
    if (sql.startsWith("SELECT * FROM document_record")) {
      return [
        {
          active_generation_id: this.activeGenerationId,
          active_generation_job_id: this.activeGenerationJobId,
          id: "doc-1",
        },
      ] as T[];
    }
    return [];
  }
}

describe("DocumentRepositoryOrm generation activation", () => {
  test("uses tenant-scoped expected-generation and monotonic job guards", async () => {
    const database = new ActivationDatabaseService();
    const repository = new DocumentRepositoryOrm(database as never, fakeLogger);

    const activated = await tenantContextAls.run({ tenantId: "tenant-a" }, () =>
      repository.activateGeneration({
        documentId: "doc-1",
        expectedGenerationId: "legacy",
        generationId: "generation-2",
        sourceJobId: "200",
      }),
    );

    expect(activated).toBe(true);
    const update = database.calls[0];
    expect(update?.sql).toContain("active_generation_id = ?");
    expect(update?.sql).toContain("CAST(active_generation_job_id AS UNSIGNED) <= CAST(? AS UNSIGNED)");
    expect(update?.sql).toContain("tenant_id = ?");
    expect(update?.params?.slice(-3)).toEqual(["legacy", "200", "tenant-a"]);
  });

  test("reports superseded when the conditional update did not win", async () => {
    const database = new ActivationDatabaseService();
    database.acceptUpdate = false;
    database.activeGenerationId = "generation-newer";
    database.activeGenerationJobId = "300";
    const repository = new DocumentRepositoryOrm(database as never, fakeLogger);

    const activated = await tenantContextAls.run({ tenantId: "tenant-a" }, () =>
      repository.activateGeneration({
        documentId: "doc-1",
        expectedGenerationId: "legacy",
        generationId: "generation-older",
        sourceJobId: "299",
      }),
    );

    expect(activated).toBe(false);
  });

  test("metadata-only generation activation preserves the import-job watermark", async () => {
    const database = new ActivationDatabaseService();
    database.activeGenerationJobId = "300";
    const repository = new DocumentRepositoryOrm(database as never, fakeLogger);

    const activated = await tenantContextAls.run({ tenantId: "tenant-a" }, () =>
      repository.activateGeneration({
        documentId: "doc-1",
        documentPatch: { acl_group_ids_json: '["eng"]' },
        expectedGenerationId: "legacy",
        generationId: "metadata-generation",
      }),
    );

    expect(activated).toBe(true);
    expect(database.calls[0]?.sql).not.toContain("active_generation_job_id = ?");
    expect(database.activeGenerationJobId).toBe("300");
  });
});
