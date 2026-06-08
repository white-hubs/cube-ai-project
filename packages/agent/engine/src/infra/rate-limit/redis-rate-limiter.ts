/**
 * Redis-backed token-bucket rate limiter (T13-G8).
 *
 * The bucket state is stored as a Redis hash:
 *   `${KEY_PREFIX}${key}` → { tokens, ts }
 *
 * Each `check` call atomically (Lua, single-shot EVAL):
 *   1. Loads current `tokens` + last-update `ts`
 *   2. Refills `(now - ts) * refillRate` tokens, capped at `capacity`
 *   3. Subtracts 1 token if available, otherwise denies
 *   4. Writes the new state with TTL = `ceil(capacity/refillRate) + 60` so
 *      idle keys self-clean
 *   5. Returns `[allowed, remaining_floor, reset_ceil_seconds]`
 *
 * Graceful degradation: when `AGENTIC_ENGINE_REDIS_URL` is unset the injected
 * client is `null` (Wave 2 T09 contract); we then return an "open" decision
 * (`allowed: true, remaining: capacity, resetSeconds: 0`) so the engine
 * still serves traffic without coordinated rate limiting. The middleware
 * still emits the headers.
 *
 * ref: docs/detailed-design/00-foundations/naming-and-db-conventions.md §6.4
 *      ARCH.md §5 G-8
 */
import { Injectable, Inject } from '@dangao/bun-server';
import type Redis from 'ioredis';
import { REDIS_CLIENT_TOKEN } from '../../bc/session/session.tokens';
import type {
  RateLimitConfig,
  RateLimitDecision,
  RateLimiter,
} from './rate-limit.types';

const KEY_PREFIX = 'agentic:engine:rate:';

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
if tokens == nil then tokens = capacity end
local last_ts = tonumber(data[2])
if last_ts == nil then last_ts = now_ms end
local elapsed = math.max(0, now_ms - last_ts) / 1000
tokens = math.min(capacity, tokens + elapsed * refill_rate)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now_ms)
redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 60)

local reset_seconds
if refill_rate > 0 then
  reset_seconds = math.ceil((capacity - tokens) / refill_rate)
else
  reset_seconds = 0
end
return {allowed, math.floor(tokens), reset_seconds}
`;

@Injectable()
export class RedisRateLimiter implements RateLimiter {
  constructor(
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis | null,
  ) {}

  async check(
    key: string,
    cfg: RateLimitConfig,
  ): Promise<RateLimitDecision> {
    if (!this.redis) {
      // Open state — preserves uptime when Redis is missing. Documented
      // as a follow-up under T09 (cross-replica coordination loss).
      return {
        allowed: true,
        remaining: cfg.capacity,
        resetSeconds: 0,
      };
    }

    if (cfg.capacity <= 0 || cfg.refillRate <= 0) {
      // Misconfiguration → never allow. Avoids "infinite reset" edge case.
      return { allowed: false, remaining: 0, resetSeconds: 0 };
    }

    const fullKey = KEY_PREFIX + key;
    let result: unknown;
    try {
      result = await this.redis.eval(
        TOKEN_BUCKET_LUA,
        1,
        fullKey,
        String(cfg.capacity),
        String(cfg.refillRate),
        String(Date.now()),
        '1',
      );
    } catch {
      // Redis transient failure → fail-open to keep serving. A
      // production-grade follow-up would emit a metric and switch to a
      // local fallback (in-process cache) for the duration of the outage.
      return {
        allowed: true,
        remaining: cfg.capacity,
        resetSeconds: 0,
      };
    }

    if (!Array.isArray(result) || result.length < 3) {
      return { allowed: true, remaining: cfg.capacity, resetSeconds: 0 };
    }
    const [allowed, remaining, reset] = result as [number, number, number];
    return {
      allowed: Number(allowed) === 1,
      remaining: Number(remaining),
      resetSeconds: Number(reset),
    };
  }
}
