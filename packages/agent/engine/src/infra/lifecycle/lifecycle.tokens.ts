/**
 * Lifecycle DI tokens — graceful shutdown hook contract (T05).
 *
 * Larger `priority` closes earlier, e.g.:
 *   - 200  Workers (BullMQ)              — drain inflight jobs first
 *   - 150  Outbox Relay leader release   — give up the Redis lock + stop poll loop
 *   - 100  Datasource pools (MySQL/Redis/Qdrant) — last to close
 *
 * Usage:
 *   container.resolve(SHUTDOWN_REGISTRY_TOKEN)
 *     .register({ name, priority, close })
 *
 * ref: docs/technical-design/phase-4/T05-graceful-shutdown.md
 */
export const SHUTDOWN_REGISTRY_TOKEN = Symbol.for(
  'agentic.lifecycle.shutdownRegistry',
);

/** Reserved for future multi-injection migration; not used by current runtime. */
export const SHUTDOWN_HOOK_TOKEN = Symbol.for(
  'agentic.lifecycle.shutdownHook',
);

export interface ShutdownHook {
  /** Stable identifier for logging / ordering tie-breaks (e.g. 'mysql-pool'). */
  readonly name: string;
  /** Larger value closes earlier. */
  readonly priority: number;
  /** Best-effort idempotent teardown; failures are logged but not propagated. */
  close(): Promise<void>;
}
