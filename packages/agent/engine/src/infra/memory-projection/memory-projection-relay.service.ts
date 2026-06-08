import { Injectable } from '@dangao/bun-server';
import type { ProjectionWorker, ProjectionWorkerFlushResult } from '@tachu/extensions/memory';
import type { LeaderElection } from '@cube-ai/bun-server-ext-outbox';

export interface MemoryProjectionRelayOptions {
  /** When true, skip leader election (single-process tests). */
  skipLeaderElection?: boolean;
  isRelayLeader?: () => boolean | Promise<boolean>;
}

/**
 * Leader-gated poll loop for tachu {@link ProjectionWorker} (memory vector projection).
 * Mirrors {@link OutboxRelayService} ownership: start on boot, flush + stop on shutdown.
 */
@Injectable()
export class MemoryProjectionRelayService {
  private worker: ProjectionWorker | undefined;
  private leaderElection: LeaderElection | undefined;
  private options: MemoryProjectionRelayOptions = {};
  private isLeader = false;
  private shuttingDown = false;

  attachWorker(worker: ProjectionWorker): void {
    this.worker = worker;
  }

  async start(
    leaderElection?: LeaderElection,
    options: MemoryProjectionRelayOptions = {},
  ): Promise<void> {
    if (!this.worker) return;
    this.leaderElection = leaderElection;
    this.options = options;
    this.shuttingDown = false;

    if (this.options.isRelayLeader) {
      this.isLeader = await Promise.resolve(this.options.isRelayLeader());
      if (this.isLeader) this.worker.start();
      return;
    }

    if (this.options.skipLeaderElection === true) {
      this.isLeader = true;
      this.worker.start();
      return;
    }

    if (!leaderElection) {
      this.isLeader = true;
      this.worker.start();
      return;
    }

    await leaderElection.start({
      onBecomeLeader: async () => {
        this.isLeader = true;
        this.worker?.start();
      },
      onLoseLeadership: async () => {
        this.isLeader = false;
        await this.worker?.stop();
      },
    });
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    this.isLeader = false;
    await this.worker?.stop();
    try {
      await this.leaderElection?.stop();
    } catch {
      /* Redis optional in degraded boot */
    }
  }

  async flush(sessionId?: string): Promise<ProjectionWorkerFlushResult> {
    if (!this.worker || this.shuttingDown) {
      return { sessions: 0, projected: 0, failed: 0 };
    }
    return this.worker.flush(sessionId);
  }

  getLeaderState(): boolean {
    return this.isLeader;
  }
}
