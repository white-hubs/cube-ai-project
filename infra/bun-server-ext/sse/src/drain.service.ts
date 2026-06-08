import { Injectable } from '@dangao/bun-server';
import type { DrainMode } from './types';

/**
 * Minimal interface for an active SSE connection that `DrainService` can
 * notify and forcibly close. The concrete implementation lives in the
 * SessionModule SSE route handler (Phase 2 wiring).
 *
 * ref design doc §3.1
 */
export interface SseConnection {
  /** Write a single SSE frame (event / data / id lines). */
  writeEvent(event: string, data: unknown, id?: string): void;
  /** Forcibly end the underlying HTTP response stream. */
  close(): void;
}

/**
 * `DrainService` — SSE drain coordinator for single-replica graceful shutdown.
 *
 * Responsibilities:
 *  1. Track active SSE streams via `registerStream`.
 *  2. On SIGTERM: `triggerDrain` — stop new streams, broadcast `drain.mode` / `drain-mode-v1`,
 *     then `waitForDrain(timeoutMs)`.
 *  3. `waitForDrain(timeoutMs)` – poll until all streams disconnect or
 *     forcibly close them after timeout.
 *
 * Additionally preserves the Phase 0a `DrainMode` state-machine interface so
 * that P1-06 `replay-buffer` code can depend on `onChange / getMode / transition`
 * without modification.
 *
 * ref: docs/detailed-design/10-deployment-and-ops/README.md §3.3 steps 4-5
 * ref: design doc §3.1, §4.1
 *
 * TACHU-GAP note: none — this is purely in-process.
 */
@Injectable()
export class DrainService {
  // ── active stream tracking ─────────────────────────────────────────────

  private readonly activeStreams = new Set<SseConnection>();
  private _draining = false;
  /** False after `triggerDrain()` step 1 — new SSE streams get 503. */
  private _acceptingNewStreams = true;

  /** Whether `/events` should still accept new streams (graceful rollout). */
  isAcceptingNewStreams(): boolean {
    return this._acceptingNewStreams;
  }

  /**
   * Register an SSE connection. Returns an idempotent unregister function
   * that the route handler MUST call when the stream ends.
   */
  registerStream(conn: SseConnection): () => void {
    this.activeStreams.add(conn);
    return () => {
      this.activeStreams.delete(conn);
    };
  }

  /**
   * Drain sequence for graceful shutdown (P3-06):
   * 1. stop accepting new SSE connections
   * 2. broadcast `drain.mode` with schema `drain-mode-v1` (session.md §15.13)
   * 3. wait until active streams end or timeout
   */
  async triggerDrain(timeoutMs: number): Promise<void> {
    this._acceptingNewStreams = false;
    this.broadcastDrainModePayload();
    this._draining = true;
    void this.transition('finalize');
    await this.waitForDrain(timeoutMs);
  }

  /**
   * @deprecated Prefer `triggerDrain`; kept for callers that only need the SSE payload.
   */
  broadcastDraining(): void {
    this._acceptingNewStreams = false;
    this.broadcastDrainModePayload();
    this._draining = true;
    void this.transition('finalize');
  }

  private broadcastDrainModePayload(): void {
    const payload = {
      schema: 'drain-mode-v1',
      reason: 'GRACEFUL_SHUTDOWN',
      reconnectHintMs: 1000,
    } as const;
    for (const conn of this.activeStreams) {
      try {
        conn.writeEvent('drain.mode', payload, 'drain');
      } catch {
        // Swallow — a stream may already be closing.
      }
    }
  }

  /**
   * Poll until all active streams have disconnected, or force-close them
   * once `timeoutMs` elapses.
   *
   * @param timeoutMs alignment: `agentic.engine.core.drainGraceSeconds * 1000`
   *                  default 60 000 ms — ref nacos-config.md §3.1
   */
  async waitForDrain(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.activeStreams.size > 0 && Date.now() < deadline) {
      await sleep(100);
    }
    // Force-close any streams that didn't disconnect voluntarily.
    for (const conn of this.activeStreams) {
      try {
        conn.close();
      } catch {
        // Stream already closed.
      }
    }
    this.activeStreams.clear();
  }

  isDraining(): boolean {
    return this._draining;
  }

  activeStreamCount(): number {
    return this.activeStreams.size;
  }

  // ── DrainMode state-machine (Phase 0a compatibility) ──────────────────

  private _mode: DrainMode = 'running';
  private readonly modeListeners = new Set<(m: DrainMode) => void>();

  getMode(): DrainMode {
    return this._mode;
  }

  /** Register a DrainMode listener; returns an idempotent unregister function. */
  onChange(handler: (mode: DrainMode) => void): () => void {
    this.modeListeners.add(handler);
    return () => this.modeListeners.delete(handler);
  }

  async transition(next: DrainMode): Promise<void> {
    if (this._mode === next) return;
    this._mode = next;
    for (const h of this.modeListeners) {
      try {
        h(next);
      } catch {
        // Drain must not throw.
      }
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
