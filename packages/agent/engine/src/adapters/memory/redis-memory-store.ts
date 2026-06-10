// 实装 @tachu/core MemorySystem Port — L1(进程内) + L2(Redis ioredis)
// ref: P3-13 §3.2 / docs/detailed-design/03-core-adapters/memory.md §5；键：agentic:engine:memory:{tenant}:{sessionId}
import type {
  AdapterCallContext,
  ContextWindow,
  MemoryEntry,
  MemorySystem,
} from '@tachu/core';
import { DEFAULT_ADAPTER_CALL_CONTEXT } from '@tachu/core';
import Redis from 'ioredis';
import { InMemoryStore } from './in-memory-store';

/** Redis key TTL / tenant（`load`/`append` 的 ctx.tenant 优先于本配置） */
export interface RedisMemoryStoreConfig {
  /** ioredis connection URL — from AGENTIC_ENGINE_REDIS_URL */
  redisUrl: string;
  /** Redis key prefix；默认 agentic:engine:memory: */
  keyPrefix?: string;
  /** L2 TTL，秒；默认 604800（7 天），P3-13 */
  ttlSeconds?: number;
  /**
   * 租户 ID，参与 key：{prefix}{tenant}:{sessionId}。
   * 当 `AdapterCallContext` 未带 `tenant` 时回退到此值（默认 1 或 AGENTIC_ENGINE_MEMORY_TENANT_ID）。
   */
  tenantId?: number;
  /**
   * @internal 单测注入（默认 `new Redis(redisUrl, …)`）
   */
  redisFactory?: () => Redis;
}

/**
 * L1 + L2 MemorySystem。
 *
 * - Read：L1 命中 → 返回；否则 LRANGE Redis → 回填 L1。
 * - Write：更新 L1 → LPUSH Redis + LTRIM + EXPIRE。
 * - clear：DEL Redis + L1 clear。
 *
 * R24：constructor 不建立 TCP；首次 Redis 命令时再连接。
 */
export class RedisMemoryStore implements MemorySystem {
  private readonly l1 = new InMemoryStore();
  private _redis: Redis | undefined;

  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;
  private readonly tenantId: number;

  constructor(private readonly config: RedisMemoryStoreConfig) {
    this.keyPrefix = config.keyPrefix ?? 'agentic:engine:memory:';
    this.ttlSeconds =
      config.ttlSeconds ??
      Number(process.env['AGENTIC_ENGINE_MEMORY_TTL_SECONDS'] ?? '604800');
    this.tenantId =
      config.tenantId ??
      Number(process.env['AGENTIC_ENGINE_MEMORY_TENANT_ID'] ?? '1');
  }

  private getRedis(): Redis {
    if (!this._redis) {
      this._redis = this.config.redisFactory
        ? this.config.redisFactory()
        : (() => {
            const client = new Redis(this.config.redisUrl, {
              lazyConnect: true,
              enableReadyCheck: false,
              maxRetriesPerRequest: 1,
            });
            client.on('error', () => {
              /* reconnect noise — command failures surface at await sites */
            });
            return client;
          })();
    }
    return this._redis;
  }

  private async ensureConnected(r: Redis): Promise<void> {
    if (r.status === 'wait' || r.status === 'connecting') {
      await r.connect();
    }
  }

  /** 与 `load`/`append` 一致的租户解析 */
  private effectiveCtx(ctx: AdapterCallContext): AdapterCallContext {
    return {
      ...ctx,
      tenant: ctx.tenant ?? this.tenantId,
    };
  }

  private redisKey(sessionId: string, ctx: AdapterCallContext): string {
    const t = ctx.tenant ?? this.tenantId;
    return `${this.keyPrefix}${t}:${sessionId}`;
  }

  async load(sessionId: string, ctx: AdapterCallContext): Promise<ContextWindow> {
    const eff = this.effectiveCtx(ctx);
    const l1 = await this.l1.load(sessionId, eff);
    if (l1.entries.length > 0) return l1;

    const redis = this.getRedis();
    await this.ensureConnected(redis);
    const raw = await redis.lrange(this.redisKey(sessionId, eff), 0, -1);
    if (raw.length === 0) {
      return { entries: [], tokenCount: 0, limit: 128_000 };
    }
    const chronological = [...raw].reverse().map((s) => JSON.parse(s) as MemoryEntry);
    let tokenCount = 0;
    for (const e of chronological) {
      tokenCount += estimateTokens(e);
    }
    const window: ContextWindow = {
      entries: chronological,
      tokenCount,
      limit: 128_000,
    };
    await this.l1.clear(sessionId);
    for (const e of chronological) {
      await this.l1.append(sessionId, e, eff);
    }
    return window;
  }

  async loadFull(sessionId: string): Promise<MemoryEntry[]> {
    const window = await this.load(sessionId, DEFAULT_ADAPTER_CALL_CONTEXT);
    return [...window.entries];
  }

  async append(sessionId: string, entry: MemoryEntry, ctx: AdapterCallContext): Promise<void> {
    const eff = this.effectiveCtx(ctx);
    await this.l1.append(sessionId, entry, eff);

    const redis = this.getRedis();
    await this.ensureConnected(redis);
    const key = this.redisKey(sessionId, eff);
    const payload = JSON.stringify(entry);
    const pipeline = redis.pipeline();
    pipeline.lpush(key, payload);
    pipeline.ltrim(key, 0, 999);
    pipeline.expire(key, this.ttlSeconds);
    await pipeline.exec();
  }

  async compress(sessionId: string): Promise<void> {
    return this.l1.compress(sessionId);
  }

  async recall(
    sessionId: string,
    query: string,
    topK?: number,
  ): Promise<MemoryEntry[]> {
    return this.l1.recall(sessionId, query, topK);
  }

  async archive(sessionId: string): Promise<void> {
    return this.l1.archive(sessionId);
  }

  async getSize(sessionId: string): Promise<{ entries: number; tokens: number }> {
    return this.l1.getSize(sessionId);
  }

  async trim(
    sessionId: string,
    options?: { keepHead?: number; keepTail?: number },
  ): Promise<void> {
    const eff = { ...DEFAULT_ADAPTER_CALL_CONTEXT, tenant: this.tenantId };
    await this.l1.trim(sessionId, options);
    const window = await this.l1.load(sessionId, eff);
    const redis = this.getRedis();
    await this.ensureConnected(redis);
    const key = this.redisKey(sessionId, eff);
    const pipe = redis.pipeline();
    pipe.del(key);
    for (let i = window.entries.length - 1; i >= 0; i--) {
      pipe.lpush(key, JSON.stringify(window.entries[i]!));
    }
    pipe.ltrim(key, 0, 999);
    pipe.expire(key, this.ttlSeconds);
    await pipe.exec();
  }

  async clear(sessionId: string): Promise<void> {
    await this.l1.clear(sessionId);
    const redis = this.getRedis();
    await this.ensureConnected(redis);
    const eff = { ...DEFAULT_ADAPTER_CALL_CONTEXT, tenant: this.tenantId };
    await redis.del(this.redisKey(sessionId, eff));
  }

  async dispose(): Promise<void> {
    if (this._redis) {
      await this._redis.quit();
      this._redis = undefined;
    }
  }

  /** Expose for testing (verify lazy init) */
  get _redisForTest(): unknown {
    return this._redis;
  }
}

function estimateTokens(entry: MemoryEntry): number {
  const content =
    typeof entry.content === 'string'
      ? entry.content
      : JSON.stringify(entry.content);
  return Math.ceil(content.length / 4);
}
