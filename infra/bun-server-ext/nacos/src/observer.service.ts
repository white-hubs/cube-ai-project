import { Injectable } from "@dangao/bun-server";

import { type NacosChangeHandler, type NacosConfigObserver, type NacosConfigSnapshot, type NacosObserverOptions } from "./types";

/**
 * In-memory skeleton Observer.
 *
 * Phase 0a: records in-process snapshots + notifies subscribers so the
 * engine can exercise its hot-reload handlers without a live Nacos server.
 *
 * Phase 4 replacement:
 * - Delegate to `@dangao/bun-server`'s `NacosConfigCenter` (already
 *   available in `bun-server` via `ConfigCenterModule`). We keep this
 *   ext-package as a THIN wrapper because the engine needs the
 *   `NacosConfigSnapshot<T>` shape with `version` + `updateTime` audit
 *   fields, plus `PubSub`-backed cache invalidation for Grant rows
 *   (regulation §9.3 / `agentic:engine:pubsub:grant.invalidate`).
 *
 * All credentials come through the bun-server `ConfigService`; this
 * service does NOT read env vars directly (regulation §12 secrets policy).
 */
@Injectable()
export class NacosConfigObserverService implements NacosConfigObserver {
  private readonly snapshots = new Map<string, NacosConfigSnapshot>();
  private readonly handlers = new Map<string, Set<NacosChangeHandler>>();
  private running = false;

  constructor(private readonly options: NacosObserverOptions = {}) {}

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.handlers.clear();
  }

  async subscribe<T>(dataId: string, handler: NacosChangeHandler<T>): Promise<() => Promise<void>> {
    const set = this.handlers.get(dataId) ?? new Set<NacosChangeHandler>();
    set.add(handler as NacosChangeHandler);
    this.handlers.set(dataId, set);
    return async () => {
      set.delete(handler as NacosChangeHandler);
    };
  }

  async getSnapshot<T>(dataId: string): Promise<NacosConfigSnapshot<T> | null> {
    const snap = this.snapshots.get(dataId);
    return (snap as NacosConfigSnapshot<T> | undefined) ?? null;
  }

  /**
   * Test-only: seed a synthetic snapshot and fan out to subscribers.
   * Production writes come through the NacosConfigCenter long-poll loop.
   */
  async __publishForTest<T>(snapshot: NacosConfigSnapshot<T>): Promise<void> {
    this.snapshots.set(snapshot.dataId, snapshot as NacosConfigSnapshot);
    const set = this.handlers.get(snapshot.dataId);
    if (!set) {
      return;
    }
    for (const h of set) {
      await h(snapshot);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getOptions(): Readonly<NacosObserverOptions> {
    return this.options;
  }
}
