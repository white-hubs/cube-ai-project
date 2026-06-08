import { Module } from '@dangao/bun-server';
import { HealthModule } from './health/health.module';
import { SfidModule } from './sfid';
import { SfidService } from './sfid/sfid.service';
import { TenantGuardModule } from './tenant-guard';
import { TenantContextService } from './tenant-guard/tenant-context.service';
import { ErrorsModule } from './errors/errors.module';
import { ErrorMiddlewareModule } from './errors/error-middleware.module';

/**
 * `InfraModule` aggregates the engine-private infrastructure.
 * BC modules depend on infra — not the other way round.
 *
 * Registration order (ref: docs/technical-design/phase-1/P1-01-foundations.md §6.3,
 * ADR-0018 DI assembly Step 1 Foundations + Step 3 Infra):
 *   ErrorsModule → SfidModule → TenantGuardModule → HealthModule → ErrorMiddlewareModule
 *
 * - ErrorsModule (P1-01): AgenticError 12 subclasses + ErrorCategory closed enum.
 * - SfidModule (P1-01): Snowflake ID generator service.
 * - TenantGuardModule (P1-01): AsyncLocalStorage-backed TenantContextService.
 * - HealthModule (P1-11): /health/live + /health/ready aggregator (placeholder
 *   in skeleton; P1-11 wires it with LifecycleCoordinator).
 * - ErrorMiddlewareModule (P1-02): envelope middleware that maps
 *   `AgenticError` (from ErrorsModule) → 5-field response, plus the Zod
 *   validation pipeline. Must register **after** ErrorsModule.
 *
 * ObservabilityModule（engine）已提供 LoggerFactory / MetricsRegistry。
 */
@Module({
  imports: [
    ErrorsModule,
    SfidModule,
    TenantGuardModule,
    HealthModule,
    ErrorMiddlewareModule,
  ],
  exports: [SfidService, TenantContextService],
})
export class InfraModule {}
