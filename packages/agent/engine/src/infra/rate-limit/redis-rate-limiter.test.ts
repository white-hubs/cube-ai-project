/**
 * Unit tests for `RedisRateLimiter` (T13-G8).
 *
 * Bypasses an actual Redis: a minimal stub of the `Redis` shape exposes
 * only the `eval` method used by the limiter. This validates the
 * arg-marshalling and parsing of the Lua return tuple — the Lua script
 * itself is exercised by the testcontainers tests (or follow-up).
 */
import { describe, expect, it, mock } from 'bun:test';
import type Redis from 'ioredis';
import { RedisRateLimiter } from './redis-rate-limiter';

interface FakeRedis {
  eval: (...args: unknown[]) => Promise<unknown>;
}

function withFakeRedis(eval_: FakeRedis['eval']): RedisRateLimiter {
  const fake = { eval: eval_ } as unknown as Redis;
  return new RedisRateLimiter(fake);
}

describe('RedisRateLimiter', () => {
  it('returns open decision when redis is null (graceful degrade)', async () => {
    const limiter = new RedisRateLimiter(null);
    const decision = await limiter.check('t-1|/p', {
      capacity: 100,
      refillRate: 10,
    });
    expect(decision).toEqual({
      allowed: true,
      remaining: 100,
      resetSeconds: 0,
    });
  });

  it('returns deny decision when capacity / refillRate are non-positive', async () => {
    const limiter = withFakeRedis(() => Promise.resolve([1, 0, 0]));
    const d1 = await limiter.check('k', { capacity: 0, refillRate: 10 });
    expect(d1.allowed).toBe(false);
    const d2 = await limiter.check('k', { capacity: 10, refillRate: 0 });
    expect(d2.allowed).toBe(false);
  });

  it('marshals args + parses [allowed=1, remaining, reset] into RateLimitDecision', async () => {
    const evalMock = mock<FakeRedis['eval']>(() =>
      Promise.resolve([1, 99, 1] as unknown),
    );
    const limiter = withFakeRedis(evalMock);

    const decision = await limiter.check('7|/p', {
      capacity: 100,
      refillRate: 10,
    });

    expect(decision).toEqual({
      allowed: true,
      remaining: 99,
      resetSeconds: 1,
    });
    expect(evalMock).toHaveBeenCalledTimes(1);
    const args = evalMock.mock.calls[0]!;
    // args: [script, numKeys, key, capacity, refillRate, nowMs, cost]
    expect(args[1]).toBe(1);
    expect(args[2]).toBe('agentic:engine:rate:7|/p');
    expect(args[3]).toBe('100');
    expect(args[4]).toBe('10');
    expect(args[6]).toBe('1');
  });

  it('parses [allowed=0, remaining=0, reset>0] into deny decision', async () => {
    const limiter = withFakeRedis(() =>
      Promise.resolve([0, 0, 9] as unknown),
    );
    const decision = await limiter.check('7|/p', {
      capacity: 100,
      refillRate: 10,
    });
    expect(decision).toEqual({
      allowed: false,
      remaining: 0,
      resetSeconds: 9,
    });
  });

  it('fails open on Redis transient error', async () => {
    const limiter = withFakeRedis(() => Promise.reject(new Error('ECONNRESET')));
    const decision = await limiter.check('7|/p', {
      capacity: 100,
      refillRate: 10,
    });
    expect(decision).toEqual({
      allowed: true,
      remaining: 100,
      resetSeconds: 0,
    });
  });

  it('fails open when Lua returns malformed tuple', async () => {
    const limiter = withFakeRedis(() => Promise.resolve('not-an-array'));
    const decision = await limiter.check('7|/p', {
      capacity: 100,
      refillRate: 10,
    });
    expect(decision.allowed).toBe(true);
  });
});
