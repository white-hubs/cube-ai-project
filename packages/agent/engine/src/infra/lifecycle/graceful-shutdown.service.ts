import { Inject, Injectable } from '@dangao/bun-server';
import type { Logger } from 'pino';
import { DrainService } from '@cube-ai/bun-server-ext-sse';

import { LoggerFactory } from '../observability/logger.factory';
import type { TurnRegistry } from './turn-registry.port';
import { TURN_REGISTRY_TOKEN } from './turn-registry.port';
import { ShutdownRegistry } from './shutdown-registry';
import type { ShutdownHook } from './lifecycle.tokens';

/** Token：可选 readiness 翻转（占位，HealthController 接入后替换） */
export const READINESS_STATE_TOKEN = Symbol.for(
  'agentic.lifecycle.readinessState',
);

export type ShutdownReason = 'sigterm' | 'sigint' | 'fatal';

/** Per-hook timeout in ms; failure is logged but never aborts the chain. */
const SHUTDOWN_HOOK_TIMEOUT_MS = 15_000;

/**
 * `GracefulShutdownService` — drain SSE → 等待 turn → 关闭依赖（可扩展钩子）。
 *
 * Shutdown order:
 *   1. markNotReady     — /health/ready → 503 (K8s stops routing traffic)
 *   2. preDrainSleep    — 等待 LB 切流（默认 5s）
 *   3. broadcastDraining — drain.mode-v1 通知所有 SSE 客户端
 *   4. waitForActiveTurnsCleared — 等活跃 turn 完成（默认 30s）
 *   5. waitForDrain     — DrainService 强制关闭剩余 SSE 流（默认 60s）
 *   6. registered hooks — `ShutdownRegistry`，按 priority 倒序串行：
 *        priority 200 → BullMQ workers
 *        priority 150 → Outbox Relay leader release
 *        priority 100 → MySQL / Redis / Qdrant pools
 *   7. process.exit(0)
 *
 * ref:
 *   - docs/detailed-design/10-deployment-and-ops/README.md §3.3
 *   - docs/technical-design/phase-4/T05-graceful-shutdown.md
 */
@Injectable()
export class GracefulShutdownService {
  private shutdownInitiated = false;
  private readonly log: Logger;

  constructor(
    private readonly drainService: DrainService,
    private readonly loggerFactory: LoggerFactory,
    @Inject(TURN_REGISTRY_TOKEN) private readonly turnRegistry: TurnRegistry,
    private readonly registry: ShutdownRegistry,
    @Inject(READINESS_STATE_TOKEN) private readonly readinessState?: {
      ready: boolean;
    },
  ) {
    this.log = this.loggerFactory.getLogger('agentic.engine.lifecycle.shutdown');
  }

  /** 进程级注册 SIGTERM/SIGINT（main 调用一次即可） */
  registerProcessSignalHandlers(): void {
    const onSig = (reason: ShutdownReason) => () => {
      void this.shutdown(reason);
    };
    process.on('SIGTERM', onSig('sigterm'));
    process.on('SIGINT', onSig('sigint'));
  }

  async shutdown(reason: ShutdownReason): Promise<void> {
    if (this.shutdownInitiated) return;
    this.shutdownInitiated = true;

    const drainGraceMs =
      Number(process.env.AGENTIC_ENGINE_DRAIN_GRACE_SECONDS ?? 60) * 1000;
    const turnWaitMs = Number(
      process.env.AGENTIC_ENGINE_SHUTDOWN_TURN_WAIT_MS ?? 30_000,
    );

    this.log.info({ reason }, 'graceful shutdown started');

    if (this.readinessState) {
      this.readinessState.ready = false;
    }

    const preDrainSleepMs = Number(
      process.env.AGENTIC_ENGINE_PRE_DRAIN_SLEEP_MS ?? 5_000,
    );
    await sleep(preDrainSleepMs);

    this.drainService.broadcastDraining();
    await this.waitForActiveTurnsCleared(turnWaitMs);
    await this.drainService.waitForDrain(drainGraceMs);

    await this._closeRegisteredHooks();

    this.log.info({ reason }, 'graceful shutdown complete');
    process.exit(0);
  }

  private async waitForActiveTurnsCleared(maxMs: number): Promise<void> {
    const deadline = Date.now() + maxMs;
    while (this.turnRegistry.getActiveCount() > 0 && Date.now() < deadline) {
      await sleep(200);
    }
  }

  /**
   * Run every {@link ShutdownHook} in `priority`-descending order, isolating
   * failures so a single bad hook never aborts the rest of the chain.
   */
  private async _closeRegisteredHooks(): Promise<void> {
    const sorted: ShutdownHook[] = [...this.registry.list()].sort(
      (a, b) => b.priority - a.priority,
    );
    for (const hook of sorted) {
      this.log.info({ hook: hook.name, priority: hook.priority }, 'shutdown hook running');
      try {
        await Promise.race([
          hook.close(),
          new Promise<void>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `shutdown hook ${hook.name} timeout ${SHUTDOWN_HOOK_TIMEOUT_MS}ms`,
                  ),
                ),
              SHUTDOWN_HOOK_TIMEOUT_MS,
            ),
          ),
        ]);
      } catch (e) {
        this.log.error(
          { hook: hook.name, err: e instanceof Error ? e.message : String(e) },
          'shutdown hook failed',
        );
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
