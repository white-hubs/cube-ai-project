import { Injectable } from '@dangao/bun-server';
import type { ReadinessProbe } from './health.tokens';

/**
 * `ReadinessRegistry` — process-singleton collector for {@link ReadinessProbe}s.
 *
 * Mirrors `ShutdownRegistry`: `@dangao/bun-server` v3 DI does not support
 * multi-injection, so probes opt in by resolving this registry at bootstrap
 * time and calling {@link register} with the probe descriptor.
 *
 * The `HealthController` runs every probe in parallel under each probe's own
 * `timeoutMs` and aggregates the result into `details.<name>`.
 *
 * ref: docs/technical-design/phase-4/T09-health-ready-details.md §3
 */
@Injectable()
export class ReadinessRegistry {
  private readonly probes: ReadinessProbe[] = [];

  /** Append a probe (last-wins for duplicate `name` only inside the response). */
  register(probe: ReadinessProbe): void {
    this.probes.push(probe);
  }

  /** Snapshot of registered probes. */
  list(): ReadonlyArray<ReadinessProbe> {
    return this.probes;
  }

  /** Test-only reset so unit cases can isolate registrations. */
  clear(): void {
    this.probes.length = 0;
  }
}
