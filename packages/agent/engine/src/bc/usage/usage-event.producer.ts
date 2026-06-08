import { Inject, Injectable } from '@dangao/bun-server';
import type { Sfid, Tenant } from '@cube-ai/contracts';
import {
  UsageJobDurationPayloadSchema,
  UsageEventSchema,
} from '@cube-ai/contracts';
import {
  type OutboxWriter,
  type TransactionContext,
  OUTBOX_WRITER_TOKEN,
} from '@cube-ai/bun-server-ext-outbox';
import { SfidService } from '../../infra/sfid/sfid.service';

/**
 * UsageEventProducer interface.
 *
 * Aligned with:
 *   docs/detailed-design/09-usage-events/README.md §2.3
 *   docs/detailed-design/09-usage-events/outbox-contract.md §5.2
 *   docs/technical-design/phase-1/P1-03-data-outbox.md §3.6
 *
 * Phase 3 P3-11：`emit` 统一走 `channel=usage_event` / `target=agentic-usage-events`。
 */
export interface UsageEventProducer {
  /**
   * 通用用量事件发射：校验 `UsageEventSchema` 后经 Outbox 强一致写入。
   */
  emit(
    tx: TransactionContext,
    usageEvent: unknown,
    ctx: UsageEmitContext,
  ): Promise<void>;

  /**
   * LONG_RUNNING 作业终态：`usage.job_duration`（Outbox 路径）。
   */
  emitTurnFinished(
    tx: TransactionContext,
    input: {
      sessionId:       Sfid;
      turnId:          Sfid;
      jobId:           Sfid;
      toolRef:         string;
      toolName:        string;
      tenant:          Tenant;
      userId?:         string | null;
      totalDurationMs: number;
      waitDurationMs:  number;
      execDurationMs:  number;
      attempts:        number;
      finalStatus:     'COMPLETED' | 'FAILED' | 'CANCELLED';
      errorCode?:      string | null;
      occurredTime:    number;
    },
  ): Promise<void>;
}

export interface UsageEmitContext {
  tenant: Tenant;
  traceId?: string;
}

/** DI token — Symbol.for('agentic.usage.producer') */
export const USAGE_EVENT_PRODUCER_TOKEN = Symbol.for('agentic.usage.producer');

@Injectable()
export class UsageEventProducerImpl implements UsageEventProducer {
  constructor(
    @Inject(OUTBOX_WRITER_TOKEN)
    private readonly writer: OutboxWriter,
    @Inject(SfidService) private readonly sfid: SfidService,
  ) {}

  async emit(
    tx: TransactionContext,
    usageEvent: unknown,
    ctx: UsageEmitContext,
  ): Promise<void> {
    const base =
      typeof usageEvent === 'object' && usageEvent !== null
        ? (usageEvent as Record<string, unknown>)
        : {};

    const id =
      typeof base['id'] === 'string' && /^\d{1,20}$/.test(base['id'])
        ? base['id']
        : this.sfid.next();

    const event = UsageEventSchema.parse({
      ...base,
      id,
    });

    const payload = event.payload as Record<string, unknown> | null | undefined;
    const tenantFromPayload =
      payload && typeof payload['tenant'] === 'number'
        ? (payload['tenant'] as Tenant)
        : undefined;
    const tenant = tenantFromPayload ?? ctx.tenant;

    await this.writer.append(tx, {
      tenant,
      channel:     'usage_event',
      eventType:   event.eventType,
      payloadJson: event,
      target:      'agentic-usage-events',
      scheduleTime: event.occurredTime,
    });
  }

  async emitTurnFinished(
    tx: TransactionContext,
    input: Parameters<UsageEventProducer['emitTurnFinished']>[1],
  ): Promise<void> {
    const occurredTime = input.occurredTime ?? Date.now();

    const payload = UsageJobDurationPayloadSchema.parse({
      schema:          'usage.job_duration.v1',
      tenant:          input.tenant,
      userId:          input.userId ?? null,
      sessionId:       input.sessionId,
      turnId:          input.turnId,
      jobId:           input.jobId,
      toolRef:         input.toolRef,
      toolName:        input.toolName,
      totalDurationMs: input.totalDurationMs,
      waitDurationMs:  input.waitDurationMs,
      execDurationMs:  input.execDurationMs,
      attempts:        input.attempts,
      finalStatus:     input.finalStatus,
      errorCode:       input.errorCode ?? null,
      occurredTime,
    });

    await this.emit(
      tx,
      {
        id:           this.sfid.next(),
        eventType:    'usage.job_duration',
        payload,
        occurredTime,
      },
      { tenant: input.tenant },
    );
  }
}
