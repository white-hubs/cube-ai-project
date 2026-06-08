import type {
  AdapterCallContext,
  ContextWindow,
  MemoryEntry,
  MemorySystem,
} from '@tachu/core';
import { ProjectionOutbox, ProjectionWorker } from '@tachu/extensions/memory';
import type { ProjectionWorkerProjectResult } from '@tachu/extensions/memory';
import type { MysqlProjectionOutbox } from './mysql-projection-outbox';
import { RedisMemoryStore } from './redis-memory-store';

export type ProjectionProjectFn = (
  sessionId: string,
  refs: readonly string[],
  signal: AbortSignal,
) => Promise<ProjectionWorkerProjectResult[] | void>;

export interface RedisProjectedMemorySystemOptions {
  store: RedisMemoryStore;
  outbox?: MysqlProjectionOutbox | undefined;
  projectionProject?: ProjectionProjectFn | undefined;
}

/**
 * Redis L1+L2 hot window with MySQL projection outbox (production cube path).
 */
export class RedisProjectedMemorySystem implements MemorySystem {
  private readonly store: RedisMemoryStore;
  private readonly outbox: MysqlProjectionOutbox | undefined;
  private projectionProject: ProjectionProjectFn | undefined;
  private readonly recovered = new Set<string>();

  constructor(options: RedisProjectedMemorySystemOptions) {
    this.store = options.store;
    this.outbox = options.outbox;
    this.projectionProject = options.projectionProject;
  }

  bindProjectionProject(fn: ProjectionProjectFn): void {
    this.projectionProject = fn;
  }

  load(sessionId: string, ctx: AdapterCallContext): Promise<ContextWindow> {
    return this.store.load(sessionId, ctx);
  }

  loadFull(sessionId: string): Promise<MemoryEntry[]> {
    return this.store.loadFull(sessionId);
  }

  append(sessionId: string, entry: MemoryEntry, ctx: AdapterCallContext): Promise<void> {
    return this.store.append(sessionId, entry, ctx);
  }

  compress(sessionId: string): Promise<void> {
    return this.store.compress(sessionId);
  }

  async recall(sessionId: string, query: string, topK?: number): Promise<MemoryEntry[]> {
    return this.store.recall(sessionId, query, topK);
  }

  async archive(sessionId: string): Promise<void> {
    if (this.outbox === undefined || this.projectionProject === undefined) {
      throw new Error(
        'RedisProjectedMemorySystem.archive requires projection outbox and projectionProject',
      );
    }
    if (!this.recovered.has(sessionId)) {
      await this.outbox.recover(sessionId);
      this.recovered.add(sessionId);
    }
    const entries = await this.store.loadFull(sessionId);
    for (const entry of entries) {
      if (entry.id) {
        await this.outbox.enqueue(sessionId, entry.id);
      }
    }
  }

  getSize(sessionId: string): Promise<{ entries: number; tokens: number }> {
    return this.store.getSize(sessionId);
  }

  trim(
    sessionId: string,
    options?: { keepHead?: number; keepTail?: number },
  ): Promise<void> {
    return this.store.trim(sessionId, options);
  }

  clear(sessionId: string): Promise<void> {
    return this.store.clear(sessionId);
  }

  createProjectionWorker(options?: { intervalMs?: number | undefined }): ProjectionWorker {
    if (this.outbox === undefined || this.projectionProject === undefined) {
      throw new Error(
        'RedisProjectedMemorySystem.createProjectionWorker requires outbox and projectionProject',
      );
    }
    return new ProjectionWorker({
      outbox: this.outbox as unknown as ProjectionOutbox,
      project: this.projectionProject,
      ...(options?.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {}),
    });
  }
}
