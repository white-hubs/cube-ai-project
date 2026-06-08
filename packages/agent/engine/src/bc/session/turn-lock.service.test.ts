import { describe, test, expect, mock } from 'bun:test';
import { TurnLockService } from './turn-lock.service';
import { REDIS_CLIENT_TOKEN } from './session.tokens';
import { AgenticEngineError } from '../../infra/errors/agentic-error';

/**
 * TurnLockService tests — Redis SET NX + Lua paths.
 * ref: P3-05 §5 · concurrency-and-replay.md §2
 */

function makeRedis(o: {
  setResult?: string | null;
  data?: Map<string, string>;
  handlers?: Record<string, () => void>;
}): import('ioredis').default {
  const store = o.data ?? new Map<string, string>();
  const redis = {
    status: 'ready',
    on: mock((event: string, handler: () => void) => {
      o.handlers ??= {};
      o.handlers[event] = handler;
      return redis;
    }),
    set: mock(
      async (key: string, val: string, px: string, ttl: number, nx: string) => {
        if (o.setResult !== undefined) return o.setResult;
        if (nx === 'NX' && store.has(key)) return null;
        store.set(key, val);
        return 'OK';
      },
    ),
    get: mock(async (key: string) => store.get(key) ?? null),
    eval: mock(async (script: string, numKeys: number, key: string, ...args: string[]) => {
      const turnId = args[0];
      const v = store.get(key);
      if (!v) return 0;
      try {
        const obj = JSON.parse(v) as { turnId: string };
        if (script.includes('DEL')) {
          if (obj.turnId === turnId) {
            store.delete(key);
            return 1;
          }
          return 0;
        }
        if (script.includes('PEXPIRE')) {
          if (obj.turnId === turnId) return 1;
          return 0;
        }
      } catch {
        return 0;
      }
      return 0;
    }),
  };
  return redis as unknown as import('ioredis').default;
}

describe('TurnLockService.tryAcquire', () => {
  test('returns true when SET NX succeeds', async () => {
    const tls = new TurnLockService(makeRedis({}));
    const ok = await tls.tryAcquire('281474976710656', '281474976710657', 30);
    expect(ok).toBe(true);
    await tls.release('281474976710656', '281474976710657');
  });

  test('returns false when key already held', async () => {
    const store = new Map<string, string>();
    const key = 'agentic:engine:session:turn:lock:281474976710656';
    store.set(
      key,
      JSON.stringify({
        turnId: '281474976710660',
        ownerNodeId: 'x',
        acquiredTimeMs: 1,
        deadlineMs: 2,
      }),
    );
    const tls = new TurnLockService(makeRedis({ data: store }));
    const ok = await tls.tryAcquire('281474976710656', '281474976710657', 30);
    expect(ok).toBe(false);
  });

  test('503 when Redis client missing', async () => {
    const tls = new TurnLockService(null);
    await expect(tls.tryAcquire('1', '2', 30)).rejects.toBeInstanceOf(AgenticEngineError);
  });

  test('allows a new acquire after transient Redis close event', async () => {
    const handlers: Record<string, () => void> = {};
    const redis = makeRedis({ handlers });
    const tls = new TurnLockService(redis);

    handlers.close?.();

    const ok = await tls.tryAcquire('281474976710656', '281474976710657', 30);
    expect(ok).toBe(true);
    await tls.release('281474976710656', '281474976710657');
  });

  test('503 after Redis end event', async () => {
    const handlers: Record<string, () => void> = {};
    const redis = makeRedis({ handlers });
    const tls = new TurnLockService(redis);

    handlers.end?.();

    await expect(
      tls.tryAcquire('281474976710656', '281474976710657', 30),
    ).rejects.toBeInstanceOf(AgenticEngineError);
  });
});

describe('TurnLockService.release', () => {
  test('Lua deletes only matching turnId', async () => {
    const store = new Map<string, string>();
    const key = 'agentic:engine:session:turn:lock:281474976710656';
    store.set(
      key,
      JSON.stringify({
        turnId: '281474976710657',
        ownerNodeId: 'pid-1',
        acquiredTimeMs: Date.now(),
        deadlineMs: Date.now() + 30_000,
      }),
    );
    const redis = makeRedis({ data: store });
    const tls = new TurnLockService(redis);
    await tls.release('281474976710656', '281474976710657');
    expect(store.has(key)).toBe(false);
  });

  test('release wrong turnId is no-op on DEL', async () => {
    const store = new Map<string, string>();
    const key = 'agentic:engine:session:turn:lock:281474976710656';
    store.set(
      key,
      JSON.stringify({
        turnId: '281474976710657',
        ownerNodeId: 'pid-1',
        acquiredTimeMs: Date.now(),
        deadlineMs: Date.now() + 30_000,
      }),
    );
    const redis = makeRedis({ data: store });
    const tls = new TurnLockService(redis);
    await tls.release('281474976710656', '9999999999999999999');
    expect(store.has(key)).toBe(true);
  });
});

describe('TurnLockService.renew', () => {
  test('returns true when Lua renew matches turnId', async () => {
    const store = new Map<string, string>();
    const key = 'agentic:engine:session:turn:lock:281474976710656';
    store.set(
      key,
      JSON.stringify({
        turnId: '281474976710657',
        ownerNodeId: 'pid-1',
        acquiredTimeMs: Date.now(),
        deadlineMs: Date.now() + 30_000,
      }),
    );
    const tls = new TurnLockService(makeRedis({ data: store }));
    const ok = await tls.renew('281474976710656', '281474976710657', 30);
    expect(ok).toBe(true);
  });
});

describe('TurnLockService renewal timer', () => {
  test('starts interval after successful acquire', async () => {
    const orig = globalThis.setInterval;
    let started = 0;
    globalThis.setInterval = function (
      fn: (...args: unknown[]) => void,
      ms?: number,
    ): ReturnType<typeof orig> {
      started++;
      return orig(fn as never, ms ?? 0);
    } as typeof setInterval;
    try {
      const tls = new TurnLockService(makeRedis({}));
      await tls.tryAcquire(
        '1000000000000000001',
        '1000000000000000002',
        30,
      );
      expect(started).toBe(1);
      await tls.release('1000000000000000001', '1000000000000000002');
    } finally {
      globalThis.setInterval = orig;
    }
  });
});

describe('REDIS_CLIENT_TOKEN wiring', () => {
  test('token symbol is stable', () => {
    expect(String(REDIS_CLIENT_TOKEN)).toContain('Symbol');
  });
});
