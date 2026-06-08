/**
 * Readiness probe DI tokens (T09).
 *
 * Each backing dependency (MySQL / Redis / Qdrant / Nacos / …) registers a
 * lightweight `ReadinessProbe` whose `check()` runs every time
 * `GET /health/ready` is hit. Failures degrade the aggregated `details.<name>`
 * to `DOWN` but never crash the process.
 *
 * ref: docs/technical-design/phase-4/T09-health-ready-details.md
 */
export const READINESS_REGISTRY_TOKEN = Symbol.for(
  'agentic.health.readinessRegistry',
);

/** Reserved for future multi-injection migration; not used by current runtime. */
export const READINESS_PROBE_TOKEN = Symbol.for(
  'agentic.health.readinessProbe',
);

export type ReadinessStatus = 'UP' | 'DOWN';

export interface ReadinessProbe {
  /**
   * Stable identifier surfaced in the JSON response, e.g. `'mysql'`.
   * Used as the `details` key — unique per probe.
   */
  readonly name: string;
  /**
   * Per-probe deadline in ms. When exceeded the aggregator records
   * `{ status: 'DOWN', detail: 'timeout' }` and continues with the rest.
   */
  readonly timeoutMs: number;
  /**
   * Best-effort liveness check; must NOT throw outside of exceptional cases —
   * the controller catches any throw and reports `DOWN` with the message.
   */
  check(): Promise<{ status: ReadinessStatus; detail?: string }>;
}
