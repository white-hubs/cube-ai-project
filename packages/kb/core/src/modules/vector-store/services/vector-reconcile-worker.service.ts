import { Inject, Injectable, LOGGER_TOKEN, type Logger, type OnModuleDestroy, type OnModuleInit } from "@dangao/bun-server";
import type { Worker } from "bullmq";

import { KB_VECTOR_RECONCILE_QUEUE_NAME, KbVectorReconcilePayloadSchema } from "@cube-ai/contracts";
import { tenantContextAls } from "@cube-ai/tenant-context";

import { buildKbBullMqConnectionFromEnv } from "../../common/bullmq-connection";
import { VectorReconcileService } from "./vector-reconcile.service";

/** Durable BullMQ consumer for MySQL-authoritative vector reconciliation. */
@Injectable()
export class VectorReconcileWorkerService implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;

  public constructor(
    private readonly reconcileService: VectorReconcileService,
    @Inject(LOGGER_TOKEN) private readonly logger: Logger,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.logger.info(`Starting persistent vector reconcile worker queue=${KB_VECTOR_RECONCILE_QUEUE_NAME}`);
    const { Worker } = await import("bullmq");
    this.worker = new Worker(KB_VECTOR_RECONCILE_QUEUE_NAME, async (job) => this.processPayload(job.data), {
      connection: buildKbBullMqConnectionFromEnv(),
      concurrency: 2,
      prefix: "agentic:engine:bull",
    });
    this.worker.on("failed", (_job, error) => {
      this.logger.error(`KB vector reconcile BullMQ job failed: ${error.message}`);
    });
    this.logger.info(`Persistent vector reconcile worker started queue=${KB_VECTOR_RECONCILE_QUEUE_NAME}`);
  }

  public async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }

  public async processPayload(raw: unknown) {
    const payload = KbVectorReconcilePayloadSchema.parse(raw);
    const tenantId = payload.tenantId?.trim() ?? "";
    if (tenantId === "") {
      throw new Error(`kb vector reconcile job is missing tenantId: ${payload.jobId ?? "unknown"}`);
    }
    return tenantContextAls.run({ tenantId }, () => this.reconcileService.reconcileDocument(payload.documentId));
  }
}
