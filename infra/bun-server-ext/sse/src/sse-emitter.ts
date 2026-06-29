import { Inject, Injectable } from "@dangao/bun-server";

import { SSE_REPLAY_BUFFER_STORE_TOKEN } from "./sse.tokens";
import { type ReplayBufferEntry, type ReplayBufferScope, type ReplayBufferStore } from "./types";

export interface SseEmitPayload {
  /** SSE `event:` line (M1 §15), e.g. `turn.started` */
  sseEvent: string;
  /** Discriminated payload including `schema: '<kebab>-v1'` */
  payload: Record<string, unknown>;
}

/**
 * Broadcasts session-scoped SSE events, assigns monotonic `eventId` per turn,
 * persists to Redis replay buffer, and fans out to live subscribers.
 * ref: P3-06 §3.1, concurrency-and-replay.md §3.1
 */
@Injectable()
export class SessionSseEmitter {
  private readonly seqByTurn = new Map<string, number>();
  private readonly live = new Map<string, Set<(e: ReplayBufferEntry) => void>>();
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private liveRefCount = 0;

  constructor(
    @Inject(SSE_REPLAY_BUFFER_STORE_TOKEN)
    private readonly store: ReplayBufferStore,
  ) {}

  private scopeKey(scope: ReplayBufferScope): string {
    return `${scope.tenant}:${scope.sessionId}`;
  }

  /** Subscribe to live events (+ synthetic heartbeat envelopes). */
  subscribe(scope: ReplayBufferScope, onEvent: (e: ReplayBufferEntry) => void): () => void {
    const key = this.scopeKey(scope);
    let bucket = this.live.get(key);
    if (!bucket) {
      bucket = new Set();
      this.live.set(key, bucket);
    }
    bucket.add(onEvent);
    this.liveRefCount++;
    if (this.hbTimer === null) {
      this.hbTimer = setInterval(() => this.pingAll(), 25_000);
    }
    return () => {
      bucket!.delete(onEvent);
      if (bucket!.size === 0) {
        this.live.delete(key);
      }
      this.liveRefCount--;
      if (this.liveRefCount <= 0) {
        this.liveRefCount = 0;
        if (this.hbTimer) {
          clearInterval(this.hbTimer);
          this.hbTimer = null;
        }
      }
    };
  }

  private pingAll(): void {
    const ping: ReplayBufferEntry = {
      event: "ping",
      eventId: "0:000000",
      payload: { schema: "ping-v1" },
      schema: "ping-v1",
      time: Date.now(),
    };
    for (const subs of this.live.values()) {
      for (const fn of subs) {
        try {
          fn(ping);
        } catch {
          /* ignore broken stream */
        }
      }
    }
  }

  /**
   * Emit one SSE frame worth of data: broadcast + replay buffer append.
   * `seq` resets per `turnId` (new turn → seq starts at 1).
   */
  async emit(scope: ReplayBufferScope, turnId: string, msg: SseEmitPayload): Promise<void> {
    const prev = this.seqByTurn.get(turnId) ?? 0;
    const seq = prev + 1;
    this.seqByTurn.set(turnId, seq);
    const eventId = `${turnId}:${String(seq).padStart(6, "0")}`;

    const entry: ReplayBufferEntry = {
      event: msg.sseEvent,
      eventId,
      payload: msg.payload,
      schema: String((msg.payload as { schema?: unknown }).schema ?? ""),
      time: Date.now(),
    };

    await this.store.append(scope, entry);

    const key = this.scopeKey(scope);
    const subs = this.live.get(key);
    if (subs) {
      for (const fn of subs) {
        try {
          fn(entry);
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** For handlers that need direct replay reads (same store as emit). */
  get replayStore(): ReplayBufferStore {
    return this.store;
  }
}
