import { Controller, GET } from '@dangao/bun-server';
import { ReadinessRegistry } from './readiness-registry';
import type {
  ReadinessProbe,
  ReadinessStatus,
} from './health.tokens';

/**
 * Liveness + readiness probes.
 *
 * Contract (candidate-c prompt + shared-context deliverables):
 *   GET /health/live   →  { "status": "UP", "timestamp": <ms> }
 *   GET /health/ready  →  {
 *     "status": "UP" | "DOWN",
 *     "timestamp": <ms>,
 *     "details": { [name]: { status, detail? } }
 *   }
 *
 * Shape aligns with `docs/detailed-design/10-deployment-and-ops/dockerfile.md`
 * §2 HEALTHCHECK contract — `HTTP 200` + JSON body with top-level `status`.
 *
 * `/ready` always responds `200`; K8s consumers tolerate `DOWN` status via
 * `successThreshold` / `failureThreshold` to avoid flapping route updates
 * (T09 design §4).
 *
 * These routes intentionally do not go through the built-in `HealthModule`
 * because the spec demands the nested `/health/live` path (built-in exposes
 * only flat `/health` + `/ready`).
 */
@Controller('/health')
export class HealthController {
  constructor(private readonly registry: ReadinessRegistry) {}

  @GET('/live')
  live(): { status: 'UP'; timestamp: number } {
    return { status: 'UP', timestamp: Date.now() };
  }

  @GET('/ready')
  async ready(): Promise<{
    status: ReadinessStatus;
    timestamp: number;
    details: Record<string, { status: ReadinessStatus; detail?: string }>;
  }> {
    const probes = this.registry.list();
    if (probes.length === 0) {
      return { status: 'UP', timestamp: Date.now(), details: {} };
    }

    const results = await Promise.all(
      probes.map((probe) => runProbe(probe)),
    );

    const details: Record<
      string,
      { status: ReadinessStatus; detail?: string }
    > = {};
    for (const r of results) {
      details[r.name] =
        r.detail !== undefined
          ? { status: r.status, detail: r.detail }
          : { status: r.status };
    }
    const overall: ReadinessStatus = results.every((r) => r.status === 'UP')
      ? 'UP'
      : 'DOWN';

    return { status: overall, timestamp: Date.now(), details };
  }
}

interface ProbeResult {
  name: string;
  status: ReadinessStatus;
  detail?: string;
}

async function runProbe(probe: ReadinessProbe): Promise<ProbeResult> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race<{
      status: ReadinessStatus;
      detail?: string;
    }>([
      probe.check(),
      new Promise<{ status: 'DOWN'; detail: string }>((res) => {
        timeoutHandle = setTimeout(
          () => res({ status: 'DOWN', detail: 'timeout' }),
          probe.timeoutMs,
        );
      }),
    ]);
    return { name: probe.name, status: result.status, detail: result.detail };
  } catch (e) {
    return {
      name: probe.name,
      status: 'DOWN',
      detail: e instanceof Error ? e.message : String(e),
    };
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}
