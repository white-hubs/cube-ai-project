/**
 * Nacos configuration descriptor. The Observer surfaces a typed bundle of
 * hot-reloadable knobs; consumers subscribe via `onChange`.
 *
 * Field names use `camelCase` (regulation §12.3); the Nacos dataId itself
 * follows the Kaihe convention `cube-agentic-engine/<env>/<namespace>`.
 */
export interface NacosConfigSnapshot<T = unknown> {
  dataId: string;
  group: string;
  namespace: string;
  version: number;
  updateTime: number;
  content: T;
}

export type NacosChangeHandler<T = unknown> = (
  snapshot: NacosConfigSnapshot<T>,
) => void | Promise<void>;

export interface NacosObserverOptions {
  serverAddr?: string;
  namespace?: string;
  group?: string;
  timeoutMs?: number;
  /** Polling fallback interval when long-polling is not available. */
  pollIntervalMs?: number;
}

/**
 * Contract for the concrete Observer runtime. The engine wires this to
 * `@dangao/bun-server`'s `NacosConfigCenter` (via `ConfigCenterModule`)
 * when available, otherwise to a local JSON file for tests.
 */
export interface NacosConfigObserver {
  subscribe<T = unknown>(
    dataId: string,
    handler: NacosChangeHandler<T>,
  ): Promise<() => Promise<void>>;
  getSnapshot<T = unknown>(
    dataId: string,
  ): Promise<NacosConfigSnapshot<T> | null>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
