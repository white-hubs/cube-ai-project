import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SessionSseEmitter } from './sse-emitter';
import { InMemoryReplayBufferStore } from './replay-buffer';
import type { ReplayBufferScope } from './types';

const SCOPE: ReplayBufferScope = { tenant: 7, sessionId: '281474976710656' };
const TURN = '281474976710657';

describe('SessionSseEmitter', () => {
  let store: InMemoryReplayBufferStore;
  let emitter: SessionSseEmitter;
  const origSetInterval = globalThis.setInterval;
  const origClearInterval = globalThis.clearInterval;

  afterEach(() => {
    globalThis.setInterval = origSetInterval;
    globalThis.clearInterval = origClearInterval;
  });

  beforeEach(() => {
    store = new InMemoryReplayBufferStore();
    emitter = new SessionSseEmitter(store);
  });

  test('emit writes buffer and assigns monotonic eventId {turnId}:{seq6}', async () => {
    await emitter.emit(SCOPE, TURN, {
      sseEvent: 'turn.started',
      payload: { schema: 'turn-started-v1', turnId: TURN, turnNo: 1 },
    });
    const buf = await store.since(SCOPE, null);
    expect(buf).toHaveLength(1);
    expect(buf[0]!.eventId).toBe(`${TURN}:000001`);
    expect(buf[0]!.eventId).toMatch(/^\d{1,20}:\d{6}$/);
    expect(buf[0]!.schema).toBe('turn-started-v1');
  });

  test('emit broadcasts to subscriber', async () => {
    const seen: string[] = [];
    const off = emitter.subscribe(SCOPE, (e) => seen.push(e.eventId));
    await emitter.emit(SCOPE, TURN, {
      sseEvent: 'turn.started',
      payload: { schema: 'turn-started-v1', turnId: TURN },
    });
    expect(seen).toEqual([`${TURN}:000001`]);
    off();
  });

  test('heartbeat timer uses 25000 ms interval when first subscriber attaches', () => {
    const intervals: number[] = [];
    globalThis.setInterval = ((
      handler: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (typeof ms === 'number') intervals.push(ms);
      return origSetInterval(handler, ms ?? 0, ...args);
    }) as typeof setInterval;

    const off = emitter.subscribe(SCOPE, () => {});
    expect(intervals.some((x) => x === 25_000)).toBe(true);
    off();
  });

  test('seq increments per turn independently', async () => {
    const t2 = '281474976710658';
    await emitter.emit(SCOPE, TURN, {
      sseEvent: 'turn.started',
      payload: { schema: 'turn-started-v1', turnId: TURN },
    });
    await emitter.emit(SCOPE, t2, {
      sseEvent: 'turn.started',
      payload: { schema: 'turn-started-v1', turnId: t2 },
    });
    const all = await store.since(SCOPE, null);
    expect(all.map((x) => x.eventId)).toEqual([`${TURN}:000001`, `${t2}:000001`]);
  });
});
