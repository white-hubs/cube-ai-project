import {
  Application,
  type ApplicationOptions,
  type ModuleClass,
} from '@dangao/bun-server';

import {
  TachuProviderModule,
  TachuObservabilityModule,
  TachuExecutionBackendModule,
  NoopFlowPlatformModule,
  KbDatabaseModule,
  KbPlatformModule,
  LlmCatalogModule,
  LlmProviderModule,
} from '@cube-ai/agent-engine/adapters';
import { TachuRuntimeModule } from '../bc/tachu/tachu-runtime.module';
import { SseExtModule } from '@cube-ai/bun-server-ext-sse';
import { OutboxExtModule } from '@cube-ai/bun-server-ext-outbox';
import { NacosExtModule } from '@cube-ai/bun-server-ext-nacos';

import { InfraModule } from '../infra/infra.module';
import { MysqlModule } from '../infra/mysql/mysql.module';
import { SfidModule } from '../infra/sfid/sfid.module';
import { TenantGuardModule } from '../infra/tenant-guard/tenant-guard.module';
import { ErrorsModule } from '../infra/errors/errors.module';
import { SecretsModule } from '../infra/secrets/secrets.module';
import { AuditModule } from '../infra/audit/audit.module';
// [P1-10] ObservabilityModule: MetricsRegistry + LoggerFactory — ADR-0018 step 4
import { ObservabilityModule } from '../infra/observability/observability.module';
// [P1-12] LifecycleModule: GracefulShutdownService — ADR-0018 step 5
import { LifecycleModule } from '../infra/lifecycle/lifecycle.module';
// [T13-G10] IdempotencyModule + [T13-G8] RateLimitModule — middleware-layer
// derivatives that depend on `REDIS_CLIENT_TOKEN` (provided by SessionModule).
import { IdempotencyModule } from '../infra/idempotency/idempotency.module';
import { RateLimitModule } from '../infra/rate-limit/rate-limit.module';
import {
  AuthModule,
  AuthzModule,
  DescriptorModule,
  EngineSafetyModule,
  JobsModule,
  PlatformModule,
  SessionModule,
  ToolsModule,
  UsageModule,
} from '../bc';

/**
 * Candidate C's explicit `EngineAssembler`. M5 decision value:
 *   bun-server DI + explicit EngineAssembler + per-Adapter Module.
 *
 * Registration order:
 *   Step 1: P1-01 Foundations (SfidModule, TenantGuardModule, ErrorsModule)
 *   Step 2: Nacos → Infra → SSE → Outbox  (infrastructure)
 *   Step 3: Platform + 6 Adapter modules   (Ports visible to BC services)
 *   Step 4: BC modules                     (business logic)
 *
 * ref: docs/technical-design/phase-1/P1-01-foundations.md §6.1
 *      docs/technical-design/prompts/phase-1/shared-context.md §9.2
 */
export class EngineAssembler {
  private readonly app: Application;

  constructor(options: ApplicationOptions = {}) {
    /**
     * Disable bun-server's built-in SIGTERM/SIGINT handler — the engine
     * delegates the full shutdown sequence to `GracefulShutdownService`
     * (P3-06 + T05):
     *   markNotReady → preDrainSleep → drain.mode-v1 broadcast →
     *   waitForActiveTurns → waitForDrain → registered hooks → exit(0)
     *
     * If both handlers run, bun-server's `gracefulShutdown()` calls
     * `server.stop()` immediately when `activeRequests === 0` (SSE streams
     * stop incrementing activeRequests once their Response is returned),
     * TCP-RST killing live SSE connections BEFORE `DrainService.broadcastDraining()`
     * has a chance to flush `drain.mode` / `drain-mode-v1`. The race is
     * surfaced by `sse-replay.testcontainers.test.ts` (P3-06 §6 SIGTERM
     * drain scenario). Callers MAY still set `enableSignalHandlers: true`
     * explicitly — needed for harnesses that do not wire `GracefulShutdownService`.
     */
    this.app = new Application({
      enableSignalHandlers: false,
      ...options,
    });
  }

  /**
   * P1-01 Foundations — first registration step.
   * ref: docs/technical-design/phase-1/P1-01-foundations.md §6.1
   */
  private registerFoundations(): void {
    this.app.registerModule(SfidModule);
    this.app.registerModule(TenantGuardModule);
    this.app.registerModule(ErrorsModule);
  }

  assemble(): Application {
    // Step 1: Foundations (P1-01)
    this.registerFoundations();

    // ADR-0018 fixed assembly order:
    //   2. Config infra      → NacosExtModule, SecretsModule
    //   3. Core infra        → InfraModule
    //   4. Observability     → ObservabilityModule (P1-10)
    //   5. Lifecycle         → (Phase 2)
    //   6. Audit             → AuditModule (P1-12; after Infra + Observability)
    //   7. bun-server ext    → SseExt, OutboxExt
    //   8. Platform          → PlatformModule
    //   9. 6 × Adapter       → Tachu* (provider/vector/memory/safety/observability/backend)
    //  10. 7 × BC            → Descriptor, Auth, AuthZ, Usage, Jobs, Tools, Session
    const modules: ModuleClass[] = [
      NacosExtModule,
      SecretsModule,        // P1-12 early; config-dependent modules need SecretResolver
      InfraModule,
      MysqlModule,
      ObservabilityModule,  // P1-10 metrics/logger before audit + BC
      SseExtModule,         // DrainService — before LifecycleModule
      LifecycleModule,      // graceful-shutdown — ADR-0018 step 5
      OutboxExtModule,      // OUTBOX_WRITER_TOKEN — before Audit + Usage
      AuditModule,          // after Outbox writer
      PlatformModule,
      TachuObservabilityModule,
      LlmCatalogModule,
      LlmProviderModule,
      TachuProviderModule,
      TachuRuntimeModule,
      // T12: engine-side safety module replaces TachuSafetyModule —
      // adds Audit fan-out + Nacos-driven shell-blacklist hot reload.
      EngineSafetyModule,
      TachuExecutionBackendModule,
      NoopFlowPlatformModule,
      KbDatabaseModule,      // engine standalone：补 ai-center 才有的全局 DATABASE_SERVICE_TOKEN
      KbPlatformModule,
      DescriptorModule,
      AuthModule,
      AuthzModule,
      UsageModule,
      JobsModule,
      ToolsModule,
      SessionModule,
      // T13-G10 / T13-G8: register AFTER SessionModule so REDIS_CLIENT_TOKEN
      // is already provided when these modules construct their stores.
      IdempotencyModule,
      RateLimitModule,
    ];
    for (const m of modules) this.app.registerModule(m);
    return this.app;
  }

  getApplication(): Application {
    return this.app;
  }
}
