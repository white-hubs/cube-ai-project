/**
 * Leader Election — Redis SETNX-based single-leader for Outbox Relay.
 *
 * Key / TTL / renewal aligned with P3-08 + `P1-07-jobs.md` §4.2.
 *
 * Ref: `docs/technical-design/phase-1/P1-07-jobs.md` §3.4
 */

import type Redis from "ioredis";
import { randomBytes } from "node:crypto";
import { hostname as osHostname } from "node:os";

// ─── Lua (compare-and-PEXPIRE / compare-and-DEL) ─────────────────────────────

const LUA_RENEW = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[2])) else return 0 end`;

const LUA_RELEASE = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;

// ─── Redis port (inject ioredis backend or in-memory fake in tests) ──────────

/**
 * Minimal Redis surface for leader lease (R23: real SET NX / Lua — tests use fake impl).
 */
export interface LeaderElectionRedis {
  setNxPx(key: string, value: string, ttlMs: number): Promise<boolean>;
  renewIfHeld(key: string, token: string, ttlMs: number): Promise<boolean>;
  releaseIfHeld(key: string, token: string): Promise<void>;
}

export function createLeaderElectionRedis(redis: Redis): LeaderElectionRedis {
  return {
    async releaseIfHeld(key, token) {
      await redis.eval(LUA_RELEASE, 1, key, token);
    },
    async renewIfHeld(key, token, ttlMs) {
      const n = (await redis.eval(LUA_RENEW, 1, key, token, String(ttlMs))) as number;
      return n === 1;
    },
    async setNxPx(key, value, ttlMs) {
      const r = await redis.set(key, value, "PX", ttlMs, "NX");
      return r === "OK";
    },
  };
}

// ─── 19-digit nonce (SFID-shaped string for lock uniqueness) ────────────────

function randomNonceSfid(): string {
  const hex = randomBytes(10).toString("hex");
  const n = BigInt(`0x${hex}`).toString();
  return n.padStart(19, "0").slice(0, 19);
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface LeaderElectionOptions {
  /**
   * Node identity (hostname / pod name). Combined with nonce as Redis value.
   */
  nodeId?: string;
  /**
   * Legacy name for `nodeId` (Phase 1).
   */
  instanceId?: string;
  /** Deterministic nonce for tests; otherwise a random 19-digit string is used. */
  nonce?: string;
  leaderKey?: string;
  ttlMs?: number;
  renewIntervalMs?: number;
  /** Follower re-probe interval (default 5000 ms). */
  followerProbeIntervalMs?: number;
  /** Required for production; inject fake in unit tests. */
  redis?: LeaderElectionRedis;
}

export interface LeaderStartOptions {
  onBecomeLeader?: () => void | Promise<void>;
  onLoseLeadership?: () => void | Promise<void>;
}

export const DEFAULT_LEADER_KEY = "agentic:engine:outbox:leader";
export const DEFAULT_LEADER_TTL_MS = 30_000;
export const DEFAULT_RENEW_INTERVAL_MS = 10_000;
export const DEFAULT_FOLLOWER_PROBE_MS = 5_000;

export const LEADER_ELECTION_TOKEN = Symbol.for("agentic.outbox.leaderElection");

// ─── LeaderElection ───────────────────────────────────────────────────────────

export class LeaderElection {
  private isLeaderState = false;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private followerTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  private onBecomeLeaderCb?: () => void | Promise<void>;
  private onLoseLeadershipCb?: () => void | Promise<void>;

  readonly nodeId: string;
  readonly lockToken: string;
  readonly leaderKey: string;
  readonly ttlMs: number;
  readonly renewIntervalMs: number;
  readonly followerProbeIntervalMs: number;
  private readonly redis?: LeaderElectionRedis;

  /** @deprecated Use `nodeId` / `lockToken` */
  get instanceId(): string {
    return this.nodeId;
  }

  constructor(opts: LeaderElectionOptions) {
    const nodeId = opts.nodeId ?? opts.instanceId ?? osHostname();
    const nonce = opts.nonce ?? randomNonceSfid();
    this.nodeId = nodeId;
    this.lockToken = `${nodeId}:${nonce}`;
    this.leaderKey = opts.leaderKey ?? DEFAULT_LEADER_KEY;
    this.ttlMs = opts.ttlMs ?? DEFAULT_LEADER_TTL_MS;
    this.renewIntervalMs = opts.renewIntervalMs ?? DEFAULT_RENEW_INTERVAL_MS;
    this.followerProbeIntervalMs = opts.followerProbeIntervalMs ?? DEFAULT_FOLLOWER_PROBE_MS;
    this.redis = opts.redis;
  }

  get isLeader(): boolean {
    return this.isLeaderState;
  }

  /**
   * Begin leader / follower scheduling: acquire or probe every {@link followerProbeIntervalMs}.
   */
  async start(opts?: LeaderStartOptions): Promise<void> {
    if (!this.redis) {
      throw new Error("LeaderElection.start: Redis port not configured — set options.redis or use DI factory (ref P1-07 §3.4)");
    }
    if (this.running) {
      return;
    }
    this.running = true;
    this.onBecomeLeaderCb = opts?.onBecomeLeader;
    this.onLoseLeadershipCb = opts?.onLoseLeadership;

    const acquired = await this.tryAcquireInternal();
    if (acquired) {
      this.isLeaderState = true;
      await this.invokeCb(this.onBecomeLeaderCb);
      this.startRenewTimer(() => void this.handleRenewPipeline());
    } else {
      this.isLeaderState = false;
      this.scheduleFollowerProbe();
    }
  }

  /**
   * Stop probes / renewal and release the lock if we still hold it.
   */
  async stop(): Promise<void> {
    this.running = false;
    this.clearFollowerTimer();
    this.stopRenewTimer();
    if (!this.redis) {
      this.isLeaderState = false;
      return;
    }
    try {
      if (this.isLeaderState) {
        await this.redis.releaseIfHeld(this.leaderKey, this.lockToken);
      }
    } catch {
      // best-effort release
    }
    this.isLeaderState = false;
  }

  /**
   * Single-shot acquire (sets `isLeaderState` when successful). For tests / manual orchestration.
   */
  async tryAcquire(): Promise<boolean> {
    if (!this.redis) {
      throw new Error("LeaderElection.tryAcquire: Redis port not configured");
    }
    const ok = await this.tryAcquireInternal();
    if (ok) {
      this.isLeaderState = true;
    }
    return ok;
  }

  /**
   * Renew TTL if we still hold the token (Lua GET → PEXPIRE).
   */
  async renewLease(): Promise<boolean> {
    if (!this.redis) {
      throw new Error("LeaderElection.renewLease: Redis port not configured");
    }
    const ok = await this.redis.renewIfHeld(this.leaderKey, this.lockToken, this.ttlMs);
    if (!ok) {
      this.isLeaderState = false;
    }
    return ok;
  }

  /**
   * Release lock if value matches (Lua GET → DEL).
   */
  async release(): Promise<void> {
    this.stopRenewTimer();
    this.isLeaderState = false;
    if (!this.redis) {
      return;
    }
    await this.redis.releaseIfHeld(this.leaderKey, this.lockToken);
  }

  /**
   * Heartbeat timer after a successful `tryAcquire` / `start` leadership.
   */
  startRenewTimer(onFailure?: () => void): void {
    if (this.renewTimer) {
      return;
    }
    this.renewTimer = setInterval(() => {
      void (async () => {
        try {
          const ok = await this.renewLease();
          if (!ok) {
            this.stopRenewTimer();
            onFailure?.();
          }
        } catch {
          this.isLeaderState = false;
          this.stopRenewTimer();
          onFailure?.();
        }
      })();
    }, this.renewIntervalMs);
  }

  stopRenewTimer(): void {
    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
  }

  private async tryAcquireInternal(): Promise<boolean> {
    return this.redis!.setNxPx(this.leaderKey, this.lockToken, this.ttlMs);
  }

  private clearFollowerTimer(): void {
    if (this.followerTimer) {
      clearTimeout(this.followerTimer);
      this.followerTimer = null;
    }
  }

  private scheduleFollowerProbe(): void {
    if (!this.running) {
      return;
    }
    this.clearFollowerTimer();
    this.followerTimer = setTimeout(() => void this.followerProbeTick(), this.followerProbeIntervalMs);
  }

  private async followerProbeTick(): Promise<void> {
    if (!this.running) {
      return;
    }
    const acquired = await this.tryAcquireInternal();
    if (acquired) {
      this.isLeaderState = true;
      await this.invokeCb(this.onBecomeLeaderCb);
      this.startRenewTimer(() => void this.handleRenewPipeline());
    } else {
      this.isLeaderState = false;
      this.scheduleFollowerProbe();
    }
  }

  private async handleRenewPipeline(): Promise<void> {
    this.isLeaderState = false;
    this.stopRenewTimer();
    await this.invokeCb(this.onLoseLeadershipCb);
    if (this.running) {
      this.scheduleFollowerProbe();
    }
  }

  private async invokeCb(fn?: () => void | Promise<void>): Promise<void> {
    if (!fn) {
      return;
    }
    await fn();
  }
}
