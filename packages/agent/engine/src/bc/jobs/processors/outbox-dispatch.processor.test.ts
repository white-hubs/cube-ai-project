import { describe, it, expect, mock } from 'bun:test';
import type { OutboxDispatcherI } from '@cube-ai/bun-server-ext-outbox';
import type { OutboxEventRow } from '@cube-ai/contracts';
import type { JobDataService } from '../job-data.service';
import { runOutboxDispatchProcessor } from './outbox-dispatch.processor';

const OID = '7234567890123456789';

function minimalRow(): OutboxEventRow {
  const now = Date.now();
  return {
    tenant: 1,
    deleted: 0n,
    createBy: 't',
    creatorId: null,
    creatorType: 'SYSTEM',
    createTime: now,
    updateBy: 't',
    updaterId: null,
    updaterType: 'SYSTEM',
    updateTime: now,
    id: OID,
    channel: 'usage_bus',
    eventType: 'test.event',
    payloadJson: {},
    target: null,
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    scheduleTime: now,
    publishTime: null,
    nextAttemptTime: null,
  };
}

describe('runOutboxDispatchProcessor', () => {
  it('dispatches loaded row', async () => {
    const row = minimalRow();
    const jobData = {
      loadOutboxRowAsContract: mock(async () => row),
    } as unknown as JobDataService;
    const dispatcher = {
      dispatch: mock(async () => {}),
    } as unknown as OutboxDispatcherI;

    const r = await runOutboxDispatchProcessor(
      { outboxEventId: OID },
      { jobData, dispatcher },
    );
    expect(r.ok).toBe(true);
    expect(dispatcher.dispatch).toHaveBeenCalledWith(row);
  });

  it('invalid payload throws', async () => {
    await expect(
      runOutboxDispatchProcessor(
        { outboxEventId: 'bad' },
        {
          jobData: {} as JobDataService,
          dispatcher: { dispatch: async () => {} } as OutboxDispatcherI,
        },
      ),
    ).rejects.toThrow();
  });

  it('dispatch failure propagates for BullMQ retry', async () => {
    const jobData = {
      loadOutboxRowAsContract: mock(async () => minimalRow()),
    } as unknown as JobDataService;
    const dispatcher = {
      dispatch: mock(async () => {
        throw new Error('upstream_down');
      }),
    } as unknown as OutboxDispatcherI;

    await expect(
      runOutboxDispatchProcessor({ outboxEventId: OID }, { jobData, dispatcher }),
    ).rejects.toThrow(/upstream_down/);
  });
});
