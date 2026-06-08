import { describe, expect, test, mock } from 'bun:test';
import type { ProjectionWorker, ProjectionWorkerFlushResult } from '@tachu/extensions/memory';
import type { LeaderElection } from '@cube-ai/bun-server-ext-outbox';
import { MemoryProjectionRelayService } from './memory-projection-relay.service';

function createMockWorker(): ProjectionWorker & {
  started: boolean;
  flushCalls: number;
} {
  const state = { started: false, flushCalls: 0 };
  return {
    get started() {
      return state.started;
    },
    get flushCalls() {
      return state.flushCalls;
    },
    start() {
      state.started = true;
    },
    async stop() {
      state.started = false;
    },
    async flush(): Promise<ProjectionWorkerFlushResult> {
      state.flushCalls += 1;
      return { sessions: 1, projected: 2, failed: 0 };
    },
  } as unknown as ProjectionWorker & { started: boolean; flushCalls: number };
}

describe('MemoryProjectionRelayService', () => {
  test('flush() drains pending via worker', async () => {
    const relay = new MemoryProjectionRelayService();
    const worker = createMockWorker();
    relay.attachWorker(worker);
    await relay.start(undefined, { skipLeaderElection: true });

    const result = await relay.flush();
    expect(result.projected).toBe(2);
    expect(worker.flushCalls).toBe(1);
  });

  test('lose leadership stops worker poll', async () => {
    const relay = new MemoryProjectionRelayService();
    const worker = createMockWorker();
    relay.attachWorker(worker);

    let onBecomeLeader: (() => Promise<void>) | undefined;
    let onLoseLeadership: (() => Promise<void>) | undefined;
    const fakeLeader = {
      start: mock(async (opts: {
        onBecomeLeader?: () => Promise<void>;
        onLoseLeadership?: () => Promise<void>;
      }) => {
        onBecomeLeader = opts.onBecomeLeader;
        onLoseLeadership = opts.onLoseLeadership;
        await opts.onBecomeLeader?.();
      }),
      stop: mock(async () => {}),
    } as unknown as LeaderElection;

    await relay.start(fakeLeader);
    expect(worker.started).toBe(true);

    await onLoseLeadership?.();
    expect(worker.started).toBe(false);
  });

  test('stop() clears leader and worker', async () => {
    const relay = new MemoryProjectionRelayService();
    const worker = createMockWorker();
    relay.attachWorker(worker);
    await relay.start(undefined, { skipLeaderElection: true });
    expect(worker.started).toBe(true);

    await relay.stop();
    expect(worker.started).toBe(false);
    expect(relay.getLeaderState()).toBe(false);
  });
});
