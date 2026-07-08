import { hostname } from "node:os";

/**
 * Redis 节点租约 —— Fix A 1b。
 *
 * 每进程启动时在 `agentic:engine:sfid:node-lease:{0..maxNode}` 上 `SET NX EX`
 * 抢一个空槽（值 = 实例指纹），拿到的槽号即 Snowflake 的 `nodeId`。拓扑无关：
 * VM / 裸机 / k8s 多副本都靠 Redis 这个唯一权威分配互不相同的 nodeId，消除
 * 「多副本都用 node 0 → sessionId 跨副本碰撞」。
 *
 * - 满槽（0..maxNode 全占）→ 抛错 = fail-closed，绝不复用他人槽位。
 * - `renew()` / `release()` 用 Lua CAS（比对指纹）保证只动自己的槽，与
 *   `TurnLockService` 的 CAS 释放/续租同构。
 */

/** ioredis 的最小子集（便于单测注入 fake）。 */
export interface SfidNodeLeaseRedis {
  set(key: string, value: string, exToken: "EX", ttlSeconds: number, nxToken: "NX"): Promise<"OK" | null>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface SfidNodeLeaseHandle {
  /** 抢到的槽号 = Snowflake nodeId（0..maxNode）。 */
  readonly nodeId: number;
  /** 本实例指纹（写入槽位的值）。 */
  readonly fingerprint: string;
  /** 续租：仍持有返回 true；已被他人接管返回 false（lease lost）。 */
  renew(): Promise<boolean>;
  /** 释放：仅当仍持有时 DEL 自己的槽（best-effort，幂等）。 */
  release(): Promise<void>;
}

export interface SfidNodeLeaseOptions {
  redis: SfidNodeLeaseRedis;
  /** 键前缀；默认 `agentic:engine:sfid:node-lease:`。 */
  keyPrefix?: string;
  /** 租约 TTL（秒）；默认 60，心跳应以远小于此的周期续租。 */
  ttlSeconds?: number;
  /** 最大槽号（含）；默认 1023（10-bit node）。 */
  maxNode?: number;
  /** 实例指纹；默认 `${hostname}:${pid}:${rand}`。 */
  fingerprint?: string;
}

const DEFAULT_KEY_PREFIX = "agentic:engine:sfid:node-lease:";
const DEFAULT_TTL_SECONDS = 60;
const DEFAULT_MAX_NODE = 1023;

/** CAS：仅当值仍等于本实例指纹时续租（PEXPIRE 用秒→毫秒）。 */
const LUA_RENEW = `
local v = redis.call('GET', KEYS[1])
if v == ARGV[1] then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
  return 1
else
  return 0
end
`;

/** CAS：仅当值仍等于本实例指纹时 DEL 自己的槽。 */
const LUA_RELEASE = `
local v = redis.call('GET', KEYS[1])
if v == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

function defaultFingerprint(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  let host = "unknown";
  try {
    host = hostname() || "unknown";
  } catch {
    /* hostname() unavailable — keep fallback */
  }
  return `${host}:${process.pid}:${rand}`;
}

export class SfidNodeLease {
  private readonly redis: SfidNodeLeaseRedis;
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;
  private readonly maxNode: number;
  private readonly fingerprint: string;

  constructor(options: SfidNodeLeaseOptions) {
    this.redis = options.redis;
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    this.maxNode = options.maxNode ?? DEFAULT_MAX_NODE;
    this.fingerprint = options.fingerprint ?? defaultFingerprint();
  }

  private key(node: number): string {
    return `${this.keyPrefix}${node}`;
  }

  /**
   * 从 0 起顺序 `SET NX EX` 抢第一个空槽。全占 → 抛错（fail-closed）。
   */
  async acquire(): Promise<SfidNodeLeaseHandle> {
    for (let node = 0; node <= this.maxNode; node++) {
      const key = this.key(node);
      const res = await this.redis.set(key, this.fingerprint, "EX", this.ttlSeconds, "NX");
      if (res === "OK") {
        return this.makeHandle(node);
      }
    }
    throw new Error(
      `[SfidNodeLease] all ${this.maxNode + 1} node slots (0..${this.maxNode}) are occupied — ` +
        "refusing to start (fail-closed). Free a slot or scale down replicas.",
    );
  }

  private makeHandle(node: number): SfidNodeLeaseHandle {
    const key = this.key(node);
    const fingerprint = this.fingerprint;
    const redis = this.redis;
    const ttl = this.ttlSeconds;
    return {
      nodeId: node,
      fingerprint,
      async renew(): Promise<boolean> {
        const res = await redis.eval(LUA_RENEW, 1, key, fingerprint, String(ttl));
        return Number(res) === 1;
      },
      async release(): Promise<void> {
        try {
          await redis.eval(LUA_RELEASE, 1, key, fingerprint);
        } catch {
          /* best-effort — slot may already be TTL-expired or Redis gone */
        }
      },
    };
  }
}
