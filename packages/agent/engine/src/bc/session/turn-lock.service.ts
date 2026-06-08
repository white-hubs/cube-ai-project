import { Injectable, Inject } from '@dangao/bun-server';
import type Redis from 'ioredis';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { REDIS_CLIENT_TOKEN } from './session.tokens';

const DEFAULT_LOCK_TTL_MS = 30_000;
const RENEW_INTERVAL_MS = 10_000;

/**
 * Redis Turn Lock value stored at the lock key.
 * ref: docs/detailed-design/05-session/concurrency-and-replay.md §2.2
 */
export interface TurnLockValue {
  turnId: string;
  ownerNodeId: string;
  acquiredTimeMs: number;
  deadlineMs: number;
}

/**
 * Redis-backed single-turn mutex per session — SET NX + Lua CAS release/renew.
 * ref: concurrency-and-replay.md §2.3–§2.4 · P1-06 §4.1
 */
@Injectable()
export class TurnLockService {
  private readonly nodeId = `pid-${process.pid}`;
  /** One active renewal per session (≤1 RUNNING turn). */
  private readonly renewalIntervals = new Map<string, ReturnType<typeof setInterval>>();
  /** Guard disconnect / shutdown. */
  private redisClosed = false;

  private static readonly LUA_RELEASE = `
local v = redis.call('GET', KEYS[1])
if v == false then return 0 end
local ok, obj = pcall(cjson.decode, v)
if not ok or type(obj) ~= 'table' then return 0 end
if obj.turnId == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

  private static readonly LUA_RENEW = `
local v = redis.call('GET', KEYS[1])
if v == false then return 0 end
local ok, obj = pcall(cjson.decode, v)
if not ok or type(obj) ~= 'table' then return 0 end
if obj.turnId ~= ARGV[1] then return 0 end
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
`;

  constructor(
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis | null,
  ) {
    if (this.redis) {
      this.redis.on('close', () => {
        this.stopAllRenewals();
      });
      this.redis.on('ready', () => {
        this.redisClosed = false;
      });
      this.redis.on('end', () => {
        this.redisClosed = true;
        this.stopAllRenewals();
      });
    }
  }

  private ensureRedis(): Redis {
    if (!this.redis || this.redisClosed || this.redis.status === 'end') {
      throw new AgenticEngineError(
        503,
        'UNAVAILABLE_LOCK_SERVICE',
        'Redis unavailable for Turn Lock — check AGENTIC_ENGINE_REDIS_URL / REDIS_URL and Redis connectivity',
        {},
      );
    }
    return this.redis;
  }

  private static lockKey(sessionId: string): string {
    return `agentic:engine:session:turn:lock:${sessionId}`;
  }

  async tryAcquire(sessionId: string, turnId: string, ttlSec: number): Promise<boolean> {
    const redis = this.ensureRedis();
    const ttlMs = Math.min(Math.max(ttlSec * 1000, 1000), 600_000);
    const key = TurnLockService.lockKey(sessionId);
    const acquiredTimeMs = Date.now();
    const value: TurnLockValue = {
      turnId,
      ownerNodeId: this.nodeId,
      acquiredTimeMs,
      deadlineMs: acquiredTimeMs + ttlMs,
    };
    const payload = JSON.stringify(value);
    try {
      const res = await redis.set(key, payload, 'PX', ttlMs, 'NX');
      if (res !== 'OK') {
        return false;
      }
      this.startRenewal(sessionId, turnId, ttlMs);
      return true;
    } catch (e: unknown) {
      throw new AgenticEngineError(
        503,
        'UNAVAILABLE_LOCK_SERVICE',
        `Redis Turn Lock acquire failed: ${String(e)}`,
        { sessionId },
      );
    }
  }

  /** Manual extend when business phase runs longer than default TTL window. */
  async renew(sessionId: string, turnId: string, ttlSec: number): Promise<boolean> {
    const redis = this.ensureRedis();
    const ttlMs = Math.min(Math.max(ttlSec * 1000, 1000), 600_000);
    try {
      const res = await redis.eval(
        TurnLockService.LUA_RENEW,
        1,
        TurnLockService.lockKey(sessionId),
        turnId,
        String(ttlMs),
      );
      return Number(res) === 1;
    } catch (e: unknown) {
      throw new AgenticEngineError(
        503,
        'UNAVAILABLE_LOCK_SERVICE',
        `Redis Turn Lock renew failed: ${String(e)}`,
        { sessionId },
      );
    }
  }

  async release(sessionId: string, turnId: string): Promise<void> {
    const redis = this.redis;
    if (!redis) return;

    this.stopRenewal(sessionId);

    try {
      await redis.eval(
        TurnLockService.LUA_RELEASE,
        1,
        TurnLockService.lockKey(sessionId),
        turnId,
      );
    } catch {
      /* best-effort release — lock may already be TTL-expired */
    }
  }

  async getCurrentHolderJson(sessionId: string): Promise<string | null> {
    const redis = this.ensureRedis();
    return redis.get(TurnLockService.lockKey(sessionId));
  }

  private startRenewal(sessionId: string, turnId: string, ttlMs: number): void {
    this.stopRenewal(sessionId);
    const interval = setInterval(() => {
      void this.renew(sessionId, turnId, ttlMs / 1000).then((ok) => {
        if (!ok) {
          this.stopRenewal(sessionId);
        }
      });
    }, RENEW_INTERVAL_MS);
    this.renewalIntervals.set(sessionId, interval);
  }

  private stopRenewal(sessionId: string): void {
    const iv = this.renewalIntervals.get(sessionId);
    if (iv) {
      clearInterval(iv);
      this.renewalIntervals.delete(sessionId);
    }
  }

  private stopAllRenewals(): void {
    for (const iv of this.renewalIntervals.values()) {
      clearInterval(iv);
    }
    this.renewalIntervals.clear();
  }
}
