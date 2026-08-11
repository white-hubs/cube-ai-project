import { describe, expect, test } from "bun:test";

import { makeMockAppConfig } from "../../../test-helpers/mock-app-config";
import { GenerationActivationSupersededError } from "../../vector-store/services/vectorization.service";
import { InMemoryIngestScheduler } from "./ingest-scheduler";
import { IngestWorkerService } from "./ingest-worker.service";

class FakeLogger {
  public info() {}
  public warn() {}
  public error() {}
}

class FakeDocumentRepository {
  public docs = new Map<string, Record<string, unknown>>();
  public updates: { id: string; patch: Record<string, unknown> }[] = [];

  public async findById(id: string) {
    return this.docs.get(id) ?? null;
  }

  public async update(id: string, patch: Record<string, unknown>) {
    this.updates.push({ id, patch });
    const prev = this.docs.get(id) ?? { id };
    this.docs.set(id, { ...prev, ...patch });
    return this.docs.get(id);
  }
}

class FakeImportJobRepository {
  public jobs = new Map<string, Record<string, unknown>>();
  public updates: { id: string; patch: Record<string, unknown> }[] = [];
  public recoveryPages = 0;

  public async update(id: string, patch: Record<string, unknown>) {
    this.updates.push({ id, patch });
    const prev = this.jobs.get(id) ?? { id };
    this.jobs.set(id, { ...prev, ...patch });
    return this.jobs.get(id);
  }

  public async listRecoverableJobs(limit = 200) {
    return this.listRecoverableJobsPage({ limit });
  }

  public async listRecoverableJobsPage(params: { limit?: number; after?: { createTime: Date; id: string } }) {
    this.recoveryPages += 1;
    const limit = params.limit ?? 200;
    return [...this.jobs.values()]
      .filter((job) => job.status === "pending" || job.status === "processing")
      .map((job) => ({
        ...job,
        create_time: job.create_time instanceof Date ? job.create_time : new Date(0),
        document_id: String(job.document_id ?? "101"),
        id: String(job.id),
      }))
      .toSorted((left, right) => {
        const byTime = left.create_time.getTime() - right.create_time.getTime();
        return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
      })
      .filter((job) => {
        if (!params.after) return true;
        const byTime = job.create_time.getTime() - params.after.createTime.getTime();
        return byTime > 0 || (byTime === 0 && job.id > params.after.id);
      })
      .slice(0, limit);
  }
}

class FakeObjectStorage {
  public async getObject() {
    return new TextEncoder().encode("hello world");
  }
}

class FakeIngestionService {
  public calls = 0;
  public failTimes = 0;
  public forceFullSeen: Array<boolean | undefined> = [];
  public thrownError: Error | null = null;

  public async ingestDocument(params: { forceFull?: boolean }) {
    this.calls += 1;
    this.forceFullSeen.push(params.forceFull);
    if (this.thrownError) {
      throw this.thrownError;
    }
    if (this.calls <= this.failTimes) {
      return {
        chunkCount: 0,
        contentChecksum: null,
        documentStatus: "failed" as const,
        embeddedCount: 0,
        embeddingModelCode: null,
        errorMessage: "transient failure",
        importJobStatus: "failed" as const,
        indexStatus: "failed" as const,
        parseStatus: "failed" as const,
        totalCharCount: 0,
      };
    }
    return {
      chunkCount: 1,
      contentChecksum: "a".repeat(64),
      documentStatus: "indexed" as const,
      embeddedCount: 1,
      embeddingModelCode: "doubao-embedding-vision-251215",
      errorMessage: null,
      importJobStatus: "completed" as const,
      indexStatus: "success" as const,
      parseStatus: "success" as const,
      totalCharCount: 11,
    };
  }
}

function createWorker(
  overrides: {
    config?: ReturnType<typeof makeMockAppConfig>;
    documents?: FakeDocumentRepository;
    importJobs?: FakeImportJobRepository;
    ingestion?: FakeIngestionService;
    scheduler?: InMemoryIngestScheduler;
  } = {},
) {
  const scheduler = overrides.scheduler ?? new InMemoryIngestScheduler();
  const documents = overrides.documents ?? new FakeDocumentRepository();
  const importJobs = overrides.importJobs ?? new FakeImportJobRepository();
  const ingestion = overrides.ingestion ?? new FakeIngestionService();
  const config = overrides.config ?? makeMockAppConfig({ ingestionMaxAttempts: 3 });

  documents.docs.set("101", {
    id: "101",
    mime_type: "text/plain",
    name: "note.txt",
    storage_bucket: "docs",
    storage_key: "key-1",
    tenant_id: "t1",
  });
  importJobs.jobs.set("202", { id: "202", document_id: "101", status: "pending", tenant_id: "t1" });

  const worker = new IngestWorkerService(
    config,
    scheduler,
    documents as never,
    importJobs as never,
    new FakeObjectStorage() as never,
    ingestion as never,
    new FakeLogger() as never,
  );
  return { documents, importJobs, ingestion, scheduler, worker };
}

describe("IngestWorkerService", () => {
  test("startup recovery runs in background and cannot block HTTP bootstrap", async () => {
    const { worker } = createWorker();
    let startCalls = 0;
    let finishRecovery!: (value: number) => void;
    const recovery = new Promise<number>((resolve) => {
      finishRecovery = resolve;
    });
    worker.start = async () => {
      startCalls += 1;
    };
    worker.recoverPendingJobsFromMysql = async () => recovery;

    await worker.onModuleInit();

    expect(startCalls).toBe(1);
    finishRecovery(0);
    await recovery;
  });

  test("W3.3-H2: fake worker eventually reaches indexed", async () => {
    const { documents, importJobs, scheduler, worker } = createWorker();
    await scheduler.schedule({
      attempt: 1,
      documentId: "101",
      importJobId: "202",
      tenantId: "t1",
    });

    const processed = await worker.drain();
    expect(processed).toBe(1);
    expect(documents.docs.get("101")?.status).toBe("indexed");
    expect(importJobs.jobs.get("202")?.status).toBe("completed");
  });

  test("W3.3-H3: retries within limit then dead-letters", async () => {
    const ingestion = new FakeIngestionService();
    ingestion.failTimes = 99;
    const { documents, importJobs, scheduler, worker } = createWorker({
      config: makeMockAppConfig({ ingestionMaxAttempts: 3 }),
      ingestion,
    });
    await scheduler.schedule({
      attempt: 1,
      documentId: "101",
      importJobId: "202",
      tenantId: "t1",
    });

    await worker.drain(10);

    expect(ingestion.calls).toBe(3);
    expect(worker.deadLetters).toHaveLength(1);
    expect(worker.deadLetters[0]?.attempts).toBe(3);
    expect(String(documents.docs.get("101")?.error_message)).toContain("dead-letter");
    expect(importJobs.jobs.get("202")?.status).toBe("failed");
    expect(documents.docs.get("101")?.status).toBe("failed");
  });

  test("recovers pending MySQL import jobs into the configured scheduler after restart", async () => {
    const { documents, importJobs, scheduler, worker } = createWorker();
    documents.docs.set("101", {
      chunk_overlap: 50,
      chunk_size: 1000,
      id: "101",
      mime_type: "application/pdf",
      name: "note.pdf",
      parse_status: "pending",
      status: "parsing",
      storage_bucket: "docs",
      storage_key: "key-1",
      tenant_id: "t1",
      text_chunk_mode: "auto",
    });
    // Insertion order approximates create_time ASC; last row wins as "latest" per document.
    importJobs.jobs.set("201", { document_id: "101", id: "201", status: "pending", tenant_id: "t1" });
    importJobs.jobs.set("202", { document_id: "101", id: "202", status: "pending", tenant_id: "t1" });

    const recovered = await worker.recoverPendingJobsFromMysql();
    expect(recovered).toBe(1);
    expect(scheduler.pendingCount()).toBe(1);
    expect(importJobs.jobs.get("201")?.status).toBe("failed");
    expect(String(importJobs.jobs.get("201")?.error_message)).toContain("superseded");

    const processed = await worker.drain();
    expect(processed).toBe(1);
    expect(documents.docs.get("101")?.status).toBe("indexed");
    expect(importJobs.jobs.get("202")?.status).toBe("completed");
  });

  test("keyset-pages through every recoverable job instead of silently stopping at the first page", async () => {
    const { documents, importJobs, scheduler, worker } = createWorker();
    documents.docs.clear();
    importJobs.jobs.clear();
    for (let index = 1; index <= 5; index += 1) {
      const documentId = String(100 + index);
      const jobId = String(200 + index);
      documents.docs.set(documentId, {
        id: documentId,
        mime_type: "text/plain",
        name: `${documentId}.txt`,
        parse_status: "pending",
        status: "parsing",
        storage_bucket: "docs",
        storage_key: `key-${documentId}`,
        tenant_id: "t1",
      });
      importJobs.jobs.set(jobId, {
        create_time: new Date(`2026-01-01T00:00:0${index}.000Z`),
        document_id: documentId,
        id: jobId,
        status: "pending",
        tenant_id: "t1",
      });
    }

    const recovered = await worker.recoverPendingJobsFromMysql(2);

    expect(recovered).toBe(5);
    expect(scheduler.pendingCount()).toBe(5);
    expect(importJobs.recoveryPages).toBe(3);
  });

  test("W3.3-H3: recovers after transient failures within limit", async () => {
    const ingestion = new FakeIngestionService();
    ingestion.failTimes = 2;
    const { documents, importJobs, scheduler, worker } = createWorker({
      config: makeMockAppConfig({ ingestionMaxAttempts: 3 }),
      ingestion,
    });
    await scheduler.schedule({
      attempt: 1,
      documentId: "101",
      forceFull: true,
      importJobId: "202",
    });

    await worker.drain(10);

    expect(ingestion.calls).toBe(3);
    expect(ingestion.forceFullSeen.every((v) => v === true)).toBe(true);
    expect(worker.deadLetters).toHaveLength(0);
    expect(documents.docs.get("101")?.status).toBe("indexed");
    expect(importJobs.jobs.get("202")?.status).toBe("completed");
  });

  test("an import superseded by a newer active generation cannot clobber document status", async () => {
    const ingestion = new FakeIngestionService();
    ingestion.thrownError = new GenerationActivationSupersededError("101");
    const { documents, importJobs, worker } = createWorker({ ingestion });
    documents.docs.set("101", {
      active_generation_job_id: "303",
      id: "101",
      index_status: "success",
      mime_type: "text/plain",
      name: "note.txt",
      parse_status: "success",
      status: "indexed",
      storage_bucket: "docs",
      storage_key: "key-1",
      tenant_id: "t1",
    });

    const outcome = await worker.processClaimed({
      attempt: 1,
      documentId: "101",
      importJobId: "202",
      occurredTime: 1,
      schema: "kb.ingest.v1",
    });

    expect(outcome).toBe("completed");
    expect(ingestion.calls).toBe(0);
    expect(documents.docs.get("101")?.status).toBe("indexed");
    expect(documents.docs.get("101")?.index_status).toBe("success");
    expect(importJobs.jobs.get("202")?.status).toBe("failed");
    expect(String(importJobs.jobs.get("202")?.error_message)).toContain("superseded");
  });
});
