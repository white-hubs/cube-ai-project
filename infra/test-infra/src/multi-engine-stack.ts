/**
 * Multi-replica engine stack — N engine subprocesses sharing one
 * MySQL/Redis (+optional Qdrant) backplane.
 *
 * Use cases (P4 Wave 4-A T14):
 *   - Verify BullMQ workers do not double-consume the same `jobId`
 *     across replicas (at-most-once when workers are enabled).
 *   - Verify Outbox Relay leader is unique across replicas (Redis
 *     SETNX semantics on the shared `agentic:engine:outbox:leader` key).
 *   - Verify SIGTERM on the current leader yields a new leader within
 *     the lease TTL (≤ 5 s for tests with shortened TTL).
 *
 * NOTE on `INSTANCE_ID`:
 *   `OutboxExtModule.defaultNodeId()` reads `process.env['INSTANCE_ID']`
 *   first, then falls back to `HOSTNAME` and `os.hostname()`. We set
 *   both `INSTANCE_ID` (canonical) and `AGENTIC_ENGINE_INSTANCE_ID`
 *   (forward-compat: T14 plan reserves the namespaced env name) so
 *   either is wired regardless of which symbol the engine ends up
 *   reading after subsequent waves.
 */

import { type EngineIntegrationProcess, startEngineIntegrationProcess } from "./engine-subprocess";
import { getFreePort } from "./free-port";
import { testInfraLog } from "./log";
import { type MysqlRedisQdrantStack, type MysqlRedisStack, startMysqlRedis, startMysqlRedisQdrant } from "./stack";

export interface MultiEngineStack {
  /** Started engine subprocesses; each carries a unique `instanceId`. */
  readonly engines: readonly (EngineIntegrationProcess & { readonly instanceId: string })[];
  readonly mysqlUrl: string;
  readonly redisUrl: string;
  readonly qdrantUrl?: string;
  /** Stops all engines (best-effort) and the shared infra stack. */
  stop(): Promise<void>;
}

export interface StartMultiEngineStackOptions {
  /** Number of engine subprocesses (>= 1). */
  replicas: number;
  /** Whether to enable BullMQ workers in each replica (defaults `true`). */
  enableJobWorkers?: boolean;
  /** Whether to also start a Qdrant container (defaults `false`). */
  withQdrant?: boolean;
  /** Repository root (used to locate `packages/agent/engine`). */
  repoRoot: string;
  /**
   * Start `OutboxRelayService` after HTTP listen (Redis leader election +
   * poll loop). **Off by default**; multi-replica / relay integration sets
   * `AGENTIC_ENGINE_ENABLE_OUTBOX_RELAY=1`.
   *
   * With `NODE_ENV=test`, set `AGENTIC_OUTBOX_LEADER_IN_TEST=1` whenever more
   * than one engine shares Redis so only one relay leader polls (see
   * `envSkipLeaderElection` in relay.service.ts).
   */
  enableOutboxRelay?: boolean;
  /** Per-engine `/health/live` wait timeout (ms). */
  readyTimeoutMs?: number;
  /**
   * If `true`, each engine has `AGENTIC_OUTBOX_LEADER_IN_TEST=1` set
   * (force real Redis leader election even though `NODE_ENV=test`).
   * Default: `true` for multi-replica safety.
   */
  forceRealLeaderElection?: boolean;
  /** Optional extra env merged into every replica (after defaults). */
  extraEnv?: Record<string, string>;
  /**
   * Apply {@link applyMinimalMysqlSchema} after infra is up and before engines spawn.
   * Default `true` — outbox relay polls `outbox_events` on boot.
   */
  applyMinimalSchema?: boolean;
}

/**
 * Start `opts.replicas` engine subprocesses that share one MySQL/Redis
 * (+optional Qdrant) backplane. Each replica gets:
 *   - a unique listening port (free-port allocator)
 *   - a unique `INSTANCE_ID` (and mirrored `AGENTIC_ENGINE_INSTANCE_ID`)
 *   - `AGENTIC_OUTBOX_LEADER_IN_TEST=1` (so leader election is exercised
 *     even though `NODE_ENV=test`), unless `forceRealLeaderElection=false`
 *
 * Failure during partial start triggers cleanup (stop already-spawned
 * engines + shared stack) before re-throwing.
 */
export async function startMultiEngineStack(opts: StartMultiEngineStackOptions): Promise<MultiEngineStack> {
  if (opts.replicas < 1) {
    throw new Error(`startMultiEngineStack: replicas must be >= 1, got ${opts.replicas}`);
  }

  const sharedStack: MysqlRedisQdrantStack | MysqlRedisStack = opts.withQdrant ? await startMysqlRedisQdrant() : await startMysqlRedis();

  if (opts.applyMinimalSchema !== false) {
    const { applyMinimalMysqlSchema } = await import("./apply-schema");
    await applyMinimalMysqlSchema(sharedStack.mysqlUrl);
  }

  const enableWorkers = opts.enableJobWorkers ?? true;
  const forceRealLeader = opts.forceRealLeaderElection ?? true;
  const enableOutboxRelay = opts.enableOutboxRelay === true;

  const engines: (EngineIntegrationProcess & { instanceId: string })[] = [];

  try {
    for (let i = 0; i < opts.replicas; i++) {
      const port = await getFreePort();
      const instanceId = `engine-test-${i}-${Date.now()}`;
      testInfraLog(`Starting engine replica ${i + 1}/${opts.replicas} (instanceId=${instanceId}, port=${port})…`);
      const eng = await startEngineIntegrationProcess({
        extraEnv: {
          AGENTIC_ENGINE_ENABLE_JOB_WORKERS: enableWorkers ? "1" : "0",
          AGENTIC_ENGINE_INSTANCE_ID: instanceId,
          INSTANCE_ID: instanceId,
          ...(enableOutboxRelay ? { AGENTIC_ENGINE_ENABLE_OUTBOX_RELAY: "1" } : {}),
          ...(forceRealLeader ? { AGENTIC_OUTBOX_LEADER_IN_TEST: "1" } : {}),
          ...opts.extraEnv,
        },
        port,
        readyTimeoutMs: opts.readyTimeoutMs,
        repoRoot: opts.repoRoot,
        stack: sharedStack,
      });
      engines.push(Object.assign(eng, { instanceId }));
    }
  } catch (error) {
    await Promise.allSettled(engines.map((engine) => engine.stop()));
    await sharedStack.stop().catch(() => {});
    throw error;
  }

  const qdrantUrl = "qdrantUrl" in sharedStack ? (sharedStack as MysqlRedisQdrantStack).qdrantUrl : undefined;

  return {
    engines,
    mysqlUrl: sharedStack.mysqlUrl,
    qdrantUrl,
    redisUrl: sharedStack.redisUrl,
    stop: async () => {
      await Promise.allSettled(engines.map((e) => e.stop().catch(() => {})));
      await sharedStack.stop().catch(() => {});
    },
  };
}
