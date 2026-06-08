import { describe, test, expect, mock } from 'bun:test';
import type { OutboxWriter, TransactionContext } from '@cube-ai/bun-server-ext-outbox';
import { NotImplementedError } from '@cube-ai/bun-server-ext-outbox';
import { UsageEventProducerImpl } from './usage-event.producer';
import { UsageJobDurationPayloadSchema } from '@cube-ai/contracts';
import { SfidService } from '../../infra/sfid/sfid.service';

/**
 * Unit tests for UsageEventProducerImpl.
 * Ref: docs/technical-design/phase-1/P1-03-data-outbox.md §7
 *      docs/detailed-design/09-usage-events/outbox-contract.md §5
 */

const MOCK_TX = {} as TransactionContext;

const VALID_INPUT = {
  sessionId:       '1234567890123456789' as const,
  turnId:          '1234567890123456790' as const,
  jobId:           '1820345678900000077' as const,
  toolRef:         'builtin:platform.flow.invoke',
  toolName:        'platform.flow.invoke',
  tenant:          1001,
  userId:          'u_abc123',
  totalDurationMs: 186700,
  waitDurationMs:  1200,
  execDurationMs:  185500,
  attempts:        1,
  finalStatus:     'COMPLETED' as const,
  errorCode:       null,
  occurredTime:    Date.now(),
};

function makeProducer(writer: OutboxWriter): UsageEventProducerImpl {
  return new UsageEventProducerImpl(writer, new SfidService());
}

describe('UsageEventProducerImpl.emitTurnFinished', () => {
  test('calls OutboxWriter.append exactly once', async () => {
    const appendMock = mock(async () => {
      throw new NotImplementedError('P1-03.OutboxWriterImpl.append: ref design doc §4.1');
    });
    const mockWriter: OutboxWriter = { append: appendMock };

    const producer = makeProducer(mockWriter);
    await expect(producer.emitTurnFinished(MOCK_TX, VALID_INPUT)).rejects.toThrow(NotImplementedError);

    expect(appendMock).toHaveBeenCalledTimes(1);
  });

  test('payload passed to OutboxWriter conforms to UsageJobDurationPayload schema', async () => {
    let capturedPayload: unknown;

    const captureWriter: OutboxWriter = {
      async append(_tx, row) {
        capturedPayload = (row.payloadJson as { payload: unknown }).payload;
      },
    };

    const producer = makeProducer(captureWriter);
    await producer.emitTurnFinished(MOCK_TX, VALID_INPUT);

    const result = UsageJobDurationPayloadSchema.safeParse(capturedPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema).toBe('usage.job_duration.v1');
      expect(result.data.finalStatus).toBe('COMPLETED');
      expect(result.data.attempts).toBe(1);
    }
  });

  test('channel is usage_event (P3-11 outbox routing)', async () => {
    let capturedChannel: string | undefined;

    const captureWriter: OutboxWriter = {
      async append(_tx, row) {
        capturedChannel = row.channel;
      },
    };

    const producer = makeProducer(captureWriter);
    await producer.emitTurnFinished(MOCK_TX, VALID_INPUT);

    expect(capturedChannel).toBe('usage_event');
  });

  test('target is agentic-usage-events', async () => {
    let target: string | null | undefined;

    const captureWriter: OutboxWriter = {
      async append(_tx, row) {
        target = row.target;
      },
    };

    const producer = makeProducer(captureWriter);
    await producer.emitTurnFinished(MOCK_TX, VALID_INPUT);

    expect(target).toBe('agentic-usage-events');
  });

  test('eventType on row matches usage.job_duration', async () => {
    let capturedEventType: string | undefined;

    const captureWriter: OutboxWriter = {
      async append(_tx, row) {
        capturedEventType = row.eventType;
      },
    };

    const producer = makeProducer(captureWriter);
    await producer.emitTurnFinished(MOCK_TX, VALID_INPUT);

    expect(capturedEventType).toBe('usage.job_duration');
  });

  test('throws ZodError when input has invalid finalStatus', async () => {
    const mockWriter: OutboxWriter = {
      async append() {},
    };

    const producer = makeProducer(mockWriter);
    await expect(
      producer.emitTurnFinished(MOCK_TX, {
        ...VALID_INPUT,
        finalStatus: 'INVALID_STATUS' as 'COMPLETED',
      }),
    ).rejects.toThrow();
  });
});

describe('UsageEventProducerImpl.emit', () => {
  test('append receives tenant from payload or ctx', async () => {
    let tenant: number | undefined;

    const captureWriter: OutboxWriter = {
      async append(_tx, row) {
        tenant = row.tenant;
      },
    };

    const producer = makeProducer(captureWriter);
    const occurredTime = Date.now();
    await producer.emit(
      MOCK_TX,
      {
        id:           '1234567890123456789',
        eventType:    'usage.job_duration',
        occurredTime,
        payload:      UsageJobDurationPayloadSchema.parse({
          schema:          'usage.job_duration.v1',
          tenant:          2002,
          userId:          null,
          sessionId:       VALID_INPUT.sessionId,
          turnId:          VALID_INPUT.turnId,
          jobId:           VALID_INPUT.jobId,
          toolRef:         VALID_INPUT.toolRef,
          toolName:        VALID_INPUT.toolName,
          totalDurationMs: 100,
          waitDurationMs:  1,
          execDurationMs:  99,
          attempts:        1,
          finalStatus:     'COMPLETED',
          errorCode:       null,
          occurredTime,
        }),
      },
      { tenant: 1001 },
    );

    expect(tenant).toBe(2002);
  });

  test('SFID id on envelope is 19 decimal digits when auto-generated', async () => {
    let idStr: string | undefined;

    const captureWriter: OutboxWriter = {
      async append(_tx, row) {
        const ej = row.payloadJson as { id?: string };
        idStr = ej.id;
      },
    };

    const producer = makeProducer(captureWriter);
    const occurredTime = Date.now();
    await producer.emit(
      MOCK_TX,
      {
        eventType:    'usage.job_duration',
        occurredTime,
        payload:      UsageJobDurationPayloadSchema.parse({
          schema:          'usage.job_duration.v1',
          tenant:          1001,
          userId:          null,
          sessionId:       VALID_INPUT.sessionId,
          turnId:          VALID_INPUT.turnId,
          jobId:           VALID_INPUT.jobId,
          toolRef:         VALID_INPUT.toolRef,
          toolName:        VALID_INPUT.toolName,
          totalDurationMs: 50,
          waitDurationMs:  1,
          execDurationMs:  49,
          attempts:        1,
          finalStatus:     'FAILED',
          errorCode:       'INTERNAL',
          occurredTime,
        }),
      },
      { tenant: 1001 },
    );

    expect(idStr).toMatch(/^\d{19}$/);
  });
});
