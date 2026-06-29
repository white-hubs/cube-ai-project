import type Redis from "ioredis";

import { type ReplayBufferEntry, type ReplayBufferScope, type ReplayBufferStore } from "./types";

/** Redis LIST key: P3-06 §3.1 */
export function replayRedisKey(scope: ReplayBufferScope): string {
  return `agentic:engine:sse:replay:${scope.tenant}:${scope.sessionId}`;
}

const DEFAULT_REPLAY_CAPACITY = 10_000;

function resolveReplayCapacity(capacity?: number): number {
  if (capacity !== undefined) {
    return Math.max(1, Math.floor(capacity));
  }
  const raw = process.env.AGENTIC_SSE_REPLAY_CAPACITY;
  if (!raw) {
    return DEFAULT_REPLAY_CAPACITY;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.floor(parsed)) : DEFAULT_REPLAY_CAPACITY;
}

/**
 * In-process store for tests / dev without `AGENTIC_ENGINE_REDIS_URL`.
 * ref: P1-06 design doc (Phase 1 skeleton)
 */
export class InMemoryReplayBufferStore implements ReplayBufferStore {
  private readonly capacity: number;
  /** key = `${tenant}:${sessionId}` */
  private readonly buffers = new Map<string, ReplayBufferEntry[]>();

  constructor(capacity?: number) {
    this.capacity = resolveReplayCapacity(capacity);
  }

  private k(scope: ReplayBufferScope): string {
    return `${scope.tenant}:${scope.sessionId}`;
  }

  async append(scope: ReplayBufferScope, entry: ReplayBufferEntry): Promise<void> {
    const key = this.k(scope);
    const buf = this.buffers.get(key) ?? [];
    buf.push(entry);
    if (buf.length > this.capacity) {
      buf.splice(0, buf.length - this.capacity);
    }
    this.buffers.set(key, buf);
  }

  async since(scope: ReplayBufferScope, lastEventId: string | null, turnId?: string): Promise<ReplayBufferEntry[]> {
    const buf = this.buffers.get(this.k(scope)) ?? [];
    const sliced =
      lastEventId === null
        ? [...buf]
        : (() => {
            const idx = buf.findIndex((e) => e.eventId === lastEventId);
            return idx === -1 ? [...buf] : buf.slice(idx + 1);
          })();
    return turnId !== undefined && turnId !== "" ? filterByTurnId(sliced, turnId) : sliced;
  }

  async clear(scope: ReplayBufferScope): Promise<void> {
    this.buffers.delete(this.k(scope));
  }

  size(scope: ReplayBufferScope): number {
    return this.buffers.get(this.k(scope))?.length ?? 0;
  }
}

/**
 * Filter replay buffer entries to a single turn by inspecting the
 * `{turnId}:{seq6}` event-id prefix (regulation §5.2). Returns a new
 * array (caller never mutates).
 */
function filterByTurnId(entries: ReplayBufferEntry[], turnId: string): ReplayBufferEntry[] {
  const prefix = `${turnId}:`;
  return entries.filter((e) => e.eventId.startsWith(prefix));
}

/**
 * Redis LIST backing store — LPUSH + LTRIM + filtering by eventId.
 * ref: P3-06 §3.1, R24 lazy connect via ioredis options at construction site.
 */
export class RedisReplayBufferStore implements ReplayBufferStore {
  private static readonly SESSION_CLOSE_TTL_SEC = 86_400;
  private readonly trimEnd: number;

  constructor(
    private readonly redis: Redis,
    capacity?: number,
  ) {
    this.trimEnd = resolveReplayCapacity(capacity) - 1;
  }

  async append(scope: ReplayBufferScope, entry: ReplayBufferEntry): Promise<void> {
    const key = replayRedisKey(scope);
    const json = JSON.stringify(entry);
    const pipeline = this.redis.pipeline();
    pipeline.lpush(key, json);
    pipeline.ltrim(key, 0, this.trimEnd);
    await pipeline.exec();
  }

  async since(scope: ReplayBufferScope, lastEventId: string | null, turnId?: string): Promise<ReplayBufferEntry[]> {
    const key = replayRedisKey(scope);
    const raw = await this.redis.lrange(key, 0, -1);
    const chronological = [...raw].toReversed().map((s) => JSON.parse(s) as ReplayBufferEntry);

    const sliced =
      lastEventId === null
        ? chronological
        : (() => {
            const idx = chronological.findIndex((e) => e.eventId === lastEventId);
            return idx === -1 ? [...chronological] : chronological.slice(idx + 1);
          })();
    return turnId !== undefined && turnId !== "" ? filterByTurnId(sliced, turnId) : sliced;
  }

  async clear(scope: ReplayBufferScope): Promise<void> {
    await this.redis.del(replayRedisKey(scope));
  }

  async expireAfterSessionClose(scope: ReplayBufferScope): Promise<void> {
    await this.redis.expire(replayRedisKey(scope), RedisReplayBufferStore.SESSION_CLOSE_TTL_SEC);
  }
}
