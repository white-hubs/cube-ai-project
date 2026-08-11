import { Inject, Injectable, LOGGER_TOKEN, type Logger, type OnModuleDestroy, type OnModuleInit } from "@dangao/bun-server";
import type { Worker } from "bullmq";

import { KB_INGEST_QUEUE_NAME, KbIngestPayloadSchema, type KbIngestPayload } from "@cube-ai/contracts";
import { tenantContextAls } from "@cube-ai/tenant-context";

import { APP_CONFIG_TOKEN, type AppConfig } from "../../../config/app.config";
import { buildKbBullMqConnectionFromEnv } from "../../common/bullmq-connection";
import { type ChunkingOptions } from "../../common/document-types";
import { DocumentRepositoryOrm } from "../../documents/infrastructure/orm/document.repository";
import { ObjectStorageService } from "../../object-storage/services/object-storage.service";
import { GenerationActivationSupersededError } from "../../vector-store/services/vectorization.service";
import { ImportJobRepositoryOrm } from "../infrastructure/orm/import-job.repository";
import { INGEST_SCHEDULER_TOKEN, InMemoryIngestScheduler, type ClaimedIngestJob, type IngestScheduler } from "./ingest-scheduler";
import { IngestionService } from "./ingestion.service";

export type IngestProcessOutcome = "completed" | "retry" | "dead";

export interface IngestDeadLetter {
  attempts: number;
  documentId: string;
  errorMessage: string;
  importJobId: string;
  payload: KbIngestPayload;
}

/**
 * Claims `kb.ingest` jobs and runs {@link IngestionService.ingestDocument}.
 * Retries within `ingestionMaxAttempts`; exhausted jobs become failed + dead-letter.
 */
@Injectable()
export class IngestWorkerService implements OnModuleInit, OnModuleDestroy {
  public readonly deadLetters: IngestDeadLetter[] = [];

  private running = false;
  private bullWorker: Worker | null = null;
  private startupRecovery: Promise<void> | null = null;
  private activeGlobal = 0;
  private readonly activeByTenant = new Map<string, number>();
  private readonly tenantWaiters = new Map<string, Array<() => void>>();

  public constructor(
    @Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig,
    @Inject(INGEST_SCHEDULER_TOKEN) private readonly scheduler: IngestScheduler,
    private readonly documentRepository: DocumentRepositoryOrm,
    private readonly importJobRepository: ImportJobRepositoryOrm,
    private readonly objectStorageService: ObjectStorageService,
    private readonly ingestionService: IngestionService,
    @Inject(LOGGER_TOKEN) private readonly logger: Logger,
  ) {}

  /** Auto-start on Application.listen(); nested provider is not on the root container. */
  public async onModuleInit(): Promise<void> {
    await this.start();
    if (this.config.ingestionAsyncEnabled) {
      this.logger.info("Ingest worker startup recovery scan begin");
      this.startupRecovery = this.recoverPendingJobsFromMysql()
        .then((recovered) => {
          this.logger.info(`Ingest worker startup recovery scan complete recovered=${recovered}`);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`Ingest worker startup recovery scan failed: ${message}`);
        })
        .finally(() => {
          this.startupRecovery = null;
        });
    }
  }

  public async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /**
   * MySQL `document_import_job` remains the recovery authority if an outbox event or
   * BullMQ job is missing after an interrupted deployment. Re-enqueue so Docling ingest
   * can finish and preview can read the same persisted chunks.
   */
  public async recoverPendingJobsFromMysql(limit = 200): Promise<number> {
    const jobs = await this.loadAllRecoverableJobs(limit);
    if (jobs.length === 0) {
      return 0;
    }

    // Prefer newest import job id per document (SFID / snowflake ids are time-ordered).
    const latestByDocument = new Map<string, (typeof jobs)[number]>();
    for (const job of jobs) {
      const documentId = String(job.document_id);
      const prev = latestByDocument.get(documentId);
      if (!prev || String(job.id) > String(prev.id)) {
        latestByDocument.set(documentId, job);
      }
    }

    let recovered = 0;
    for (const job of jobs) {
      const tenantId = typeof job.tenant_id === "string" ? job.tenant_id.trim() : "";
      if (tenantId === "") {
        await this.importJobRepository.update(job.id, {
          error_message: "tenant missing during worker recovery",
          status: "failed",
        });
        continue;
      }
      recovered += await tenantContextAls.run({ tenantId }, async () => {
        const documentId = String(job.document_id);
        const latest = latestByDocument.get(documentId);
        if (latest && latest.id !== job.id) {
          await this.importJobRepository.update(job.id, {
            error_message: "superseded by newer import job after worker recovery",
            status: "failed",
          });
          return 0;
        }

        const document = await this.documentRepository.findById(documentId);
        if (!document) {
          await this.importJobRepository.update(job.id, {
            error_message: "document missing during worker recovery",
            status: "failed",
          });
          return 0;
        }

        if (document.status === "indexed" && document.parse_status === "success") {
          await this.importJobRepository.update(job.id, {
            error_message: null,
            status: "completed",
          });
          return 0;
        }

        await this.scheduler.schedule({
          attempt: 1,
          chunkOverlap: document.chunk_overlap ?? undefined,
          chunkSize: document.chunk_size ?? undefined,
          documentId,
          forceFull: false,
          importJobId: job.id,
          maxAttempts: this.config.ingestionMaxAttempts,
          separator: document.chunk_separator ?? undefined,
          tableChunkMode: (document.table_chunk_mode as ChunkingOptions["tableChunkMode"]) ?? undefined,
          tenantId: document.tenant_id,
          textChunkMode: (document.text_chunk_mode as ChunkingOptions["textChunkMode"]) ?? undefined,
        });
        return 1;
      });
    }

    if (recovered > 0) {
      this.logger.info(`Ingest worker recovered ${recovered} import job(s) from MySQL into the persistent outbox`);
    }
    return recovered;
  }

  private async loadAllRecoverableJobs(pageSize: number) {
    const repository = this.importJobRepository as ImportJobRepositoryOrm & {
      listRecoverableJobsPage?: ImportJobRepositoryOrm["listRecoverableJobsPage"];
    };
    if (typeof repository.listRecoverableJobsPage !== "function") {
      return repository.listRecoverableJobs(pageSize);
    }
    const jobs: Awaited<ReturnType<ImportJobRepositoryOrm["listRecoverableJobs"]>> = [];
    let after: { createTime: Date; id: string } | undefined;
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 1000) : 200;
    for (;;) {
      const page = await repository.listRecoverableJobsPage({
        ...(after ? { after } : {}),
        limit: safePageSize,
      });
      jobs.push(...page);
      if (page.length < safePageSize) {
        break;
      }
      const last = page.at(-1)!;
      const next = { createTime: new Date(last.create_time), id: String(last.id) };
      if (after && next.createTime.getTime() === after.createTime.getTime() && next.id === after.id) {
        throw new Error("recoverable import-job keyset cursor did not advance");
      }
      after = next;
    }
    return jobs;
  }

  /** Start a BullMQ consumer. The queue remains durable when this process stops. */
  public async start(): Promise<void> {
    if (!this.config.ingestionAsyncEnabled || this.running) {
      return;
    }
    this.running = true;
    this.logger.info(`Starting persistent ingest worker queue=${KB_INGEST_QUEUE_NAME}`);
    const { Worker } = await import("bullmq");
    this.bullWorker = new Worker(
      KB_INGEST_QUEUE_NAME,
      async (bullJob) => {
        const payload = KbIngestPayloadSchema.parse(bullJob.data);
        const tenantId = payload.tenantId?.trim() ?? "";
        if (tenantId === "") {
          throw new Error(`kb ingest job is missing tenantId: ${payload.importJobId}`);
        }
        const claimed: ClaimedIngestJob = {
          ...payload,
          attempt: bullJob.attemptsMade + 1,
        };
        const outcome = await tenantContextAls.run({ tenantId }, () => this.withTenantSlot(tenantId, () => this.processClaimed(claimed)));
        if (outcome !== "completed") {
          throw new Error(
            outcome === "dead"
              ? `kb ingest dead-letter document=${claimed.documentId} importJob=${claimed.importJobId}`
              : `kb ingest retry document=${claimed.documentId} importJob=${claimed.importJobId}`,
          );
        }
        return { documentId: claimed.documentId, importJobId: claimed.importJobId, ok: true };
      },
      {
        connection: buildKbBullMqConnectionFromEnv(),
        concurrency: Math.max(1, this.config.ingestionWorkerConcurrency),
        lockDuration: 10 * 60_000,
        maxStalledCount: 1,
        prefix: "agentic:engine:bull",
        stalledInterval: 30_000,
      },
    );
    this.bullWorker.on("failed", (_job, error) => {
      this.logger.error(`KB ingest BullMQ job failed: ${error.message}`);
    });
    this.logger.info(
      `Persistent ingest worker started queue=${KB_INGEST_QUEUE_NAME} (concurrency=${this.config.ingestionWorkerConcurrency}, tenant=${this.config.ingestionWorkerTenantConcurrency})`,
    );
  }

  public async stop(): Promise<void> {
    this.running = false;
    if (this.bullWorker) {
      await this.bullWorker.close();
      this.bullWorker = null;
    }
  }

  /** Drain all pending jobs (unit tests / fake worker). */
  public async drain(maxJobs = 1000): Promise<number> {
    let processed = 0;
    while (processed < maxJobs) {
      const did = await this.processNext();
      if (!did) {
        break;
      }
      processed += 1;
    }
    return processed;
  }

  public async processNext(): Promise<boolean> {
    const memory = this.asMemoryScheduler();
    if (!memory) {
      return false;
    }
    if (this.activeGlobal >= this.config.ingestionWorkerConcurrency) {
      return false;
    }
    const job = memory.claim();
    if (!job) {
      return false;
    }
    const tenantKey = job.tenantId ?? "";
    const tenantActive = this.activeByTenant.get(tenantKey) ?? 0;
    if (tenantActive >= this.config.ingestionWorkerTenantConcurrency) {
      // Put back and skip this tick (simple fairness; avoids starving other tenants forever).
      await memory.schedule({ ...job, attempt: job.attempt });
      return false;
    }

    this.activeGlobal += 1;
    this.activeByTenant.set(tenantKey, tenantActive + 1);
    try {
      await this.processClaimed(job);
      return true;
    } finally {
      this.activeGlobal -= 1;
      const next = (this.activeByTenant.get(tenantKey) ?? 1) - 1;
      if (next <= 0) {
        this.activeByTenant.delete(tenantKey);
      } else {
        this.activeByTenant.set(tenantKey, next);
      }
    }
  }

  /** Process a single claimed/fake job (H2/H3 unit path). */
  public async processClaimed(job: ClaimedIngestJob): Promise<IngestProcessOutcome> {
    const attempt = job.attempt;
    const maxAttempts = Math.max(1, job.maxAttempts ?? this.config.ingestionMaxAttempts);

    try {
      const document = await this.documentRepository.findById(job.documentId);
      if (!document) {
        throw new Error(`document not found: ${job.documentId}`);
      }
      if (isNewerImportJob(document.active_generation_job_id, job.importJobId)) {
        await this.markImportJobSuperseded(job, "newer generation already active");
        return "completed";
      }

      await this.importJobRepository.update(job.importJobId, {
        error_message: null,
        status: "processing",
      });
      await this.documentRepository.update(job.documentId, {
        error_message: null,
        index_status: "pending",
        parse_status: "pending",
        status: "parsing",
      });

      const bytes = await this.objectStorageService.getObject({
        bucket: document.storage_bucket,
        objectKey: document.storage_key,
      });
      const file = new File([bytes], document.name, { type: document.mime_type });
      const chunkingOptions = this.chunkingFromPayload(job);

      const result = await this.ingestionService.ingestDocument({
        chunkingOptions,
        document,
        file,
        forceFull: job.forceFull,
        sourceJobId: job.importJobId,
      });

      await this.documentRepository.update(job.documentId, {
        char_count: result.totalCharCount,
        ...(chunkingOptions.chunkOverlap !== undefined ? { chunk_overlap: chunkingOptions.chunkOverlap } : {}),
        ...(chunkingOptions.separator !== undefined ? { chunk_separator: chunkingOptions.separator } : {}),
        ...(chunkingOptions.chunkSize !== undefined ? { chunk_size: chunkingOptions.chunkSize } : {}),
        content_checksum: result.contentChecksum,
        embedding_model_code: result.embeddingModelCode,
        error_message: result.errorMessage,
        index_status: result.indexStatus,
        parse_status: result.parseStatus,
        status: result.documentStatus,
        ...(chunkingOptions.tableChunkMode !== undefined ? { table_chunk_mode: chunkingOptions.tableChunkMode } : {}),
        ...(chunkingOptions.textChunkMode !== undefined ? { text_chunk_mode: chunkingOptions.textChunkMode } : {}),
      });
      await this.importJobRepository.update(job.importJobId, {
        chunk_count: result.chunkCount,
        error_message: result.errorMessage,
        status: result.importJobStatus,
      });

      if (result.importJobStatus === "completed") {
        return "completed";
      }

      return await this.handleFailure(job, attempt, maxAttempts, result.errorMessage ?? "ingestion failed");
    } catch (error) {
      if (error instanceof GenerationActivationSupersededError) {
        await this.markImportJobSuperseded(job, error.message);
        return "completed";
      }
      const message = error instanceof Error ? error.message : String(error);
      return await this.handleFailure(job, attempt, maxAttempts, message);
    }
  }

  private async markImportJobSuperseded(job: ClaimedIngestJob, reason: string): Promise<void> {
    const message = `superseded: ${reason}`;
    await this.importJobRepository.update(job.importJobId, {
      error_message: message,
      status: "failed",
    });
    this.logger.warn(`Ingest job superseded document=${job.documentId} importJob=${job.importJobId}: ${reason}`);
  }

  private async handleFailure(
    job: ClaimedIngestJob,
    attempt: number,
    maxAttempts: number,
    errorMessage: string,
  ): Promise<IngestProcessOutcome> {
    if (attempt < maxAttempts) {
      const memory = this.asMemoryScheduler();
      if (memory) {
        await memory.schedule({
          ...job,
          attempt: attempt + 1,
          forceFull: job.forceFull,
        });
      }
      await this.documentRepository.update(job.documentId, {
        error_message: errorMessage,
        index_status: "pending",
        parse_status: "pending",
        status: "parsing",
      });
      await this.importJobRepository.update(job.importJobId, {
        error_message: errorMessage,
        status: "pending",
      });
      this.logger.warn(`Ingest retry scheduled document=${job.documentId} attempt=${attempt + 1}/${maxAttempts}: ${errorMessage}`);
      return "retry";
    }

    const deadMessage = `dead-letter after ${attempt} attempt(s): ${errorMessage}`;
    await this.documentRepository.update(job.documentId, {
      error_message: deadMessage,
      index_status: "failed",
      parse_status: "failed",
      status: "failed",
    });
    await this.importJobRepository.update(job.importJobId, {
      error_message: deadMessage,
      status: "failed",
    });
    this.deadLetters.push({
      attempts: attempt,
      documentId: job.documentId,
      errorMessage: deadMessage,
      importJobId: job.importJobId,
      payload: job,
    });
    this.logger.error(`Ingest dead-letter document=${job.documentId} importJob=${job.importJobId}: ${deadMessage}`);
    return "dead";
  }

  private chunkingFromPayload(job: KbIngestPayload): ChunkingOptions {
    return {
      chunkOverlap: job.chunkOverlap,
      chunkSize: job.chunkSize,
      separator: job.separator,
      tableChunkMode: job.tableChunkMode,
      textChunkMode: job.textChunkMode,
    };
  }

  private asMemoryScheduler(): InMemoryIngestScheduler | null {
    if (this.scheduler instanceof InMemoryIngestScheduler) {
      return this.scheduler;
    }
    return null;
  }

  private async withTenantSlot<T>(tenantKey: string, work: () => Promise<T>): Promise<T> {
    const limit = Math.max(1, this.config.ingestionWorkerTenantConcurrency);
    let inheritedSlot = false;
    if ((this.activeByTenant.get(tenantKey) ?? 0) >= limit) {
      await new Promise<void>((resolve) => {
        const waiters = this.tenantWaiters.get(tenantKey) ?? [];
        waiters.push(resolve);
        this.tenantWaiters.set(tenantKey, waiters);
      });
      inheritedSlot = true;
    }
    if (!inheritedSlot) {
      this.activeByTenant.set(tenantKey, (this.activeByTenant.get(tenantKey) ?? 0) + 1);
    }
    try {
      return await work();
    } finally {
      const waiter = this.tenantWaiters.get(tenantKey)?.shift();
      if (this.tenantWaiters.get(tenantKey)?.length === 0) this.tenantWaiters.delete(tenantKey);
      if (waiter) {
        waiter();
      } else {
        const next = (this.activeByTenant.get(tenantKey) ?? 1) - 1;
        if (next <= 0) this.activeByTenant.delete(tenantKey);
        else this.activeByTenant.set(tenantKey, next);
      }
    }
  }
}

function isNewerImportJob(activeJobId: unknown, currentJobId: string): boolean {
  if (typeof activeJobId !== "string" || !/^\d{1,19}$/u.test(activeJobId) || !/^\d{1,19}$/u.test(currentJobId)) {
    return false;
  }
  return BigInt(activeJobId) > BigInt(currentJobId);
}
