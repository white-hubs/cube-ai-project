import { Module } from '@dangao/bun-server';
import { SseExtModule } from '@cube-ai/bun-server-ext-sse';

import { ObservabilityModule } from '../observability/observability.module';
import { GracefulShutdownService, READINESS_STATE_TOKEN } from './graceful-shutdown.service';
import { ShutdownRegistry } from './shutdown-registry';
import { SHUTDOWN_REGISTRY_TOKEN } from './lifecycle.tokens';
import {
  NoopTurnRegistry,
  TURN_REGISTRY_TOKEN,
} from './turn-registry.port';

/**
 * Lifecycle：依赖 `SseExtModule` 提供 `DrainService`；依赖 `ObservabilityModule` 提供 `LoggerFactory`。
 *
 * `ShutdownRegistry` is a process-singleton collector for graceful-shutdown
 * hooks (T05). Modules that own closable resources resolve the registry at
 * bootstrap time and call `register({...})` to opt in.
 */
@Module({
  imports: [SseExtModule, ObservabilityModule],
  providers: [
    ShutdownRegistry,
    {
      provide: SHUTDOWN_REGISTRY_TOKEN,
      useExisting: ShutdownRegistry,
    },
    GracefulShutdownService,
    { provide: TURN_REGISTRY_TOKEN, useClass: NoopTurnRegistry },
    {
      provide: READINESS_STATE_TOKEN,
      useValue: { ready: true } as { ready: boolean },
    },
  ],
  exports: [GracefulShutdownService, ShutdownRegistry, SHUTDOWN_REGISTRY_TOKEN],
})
export class LifecycleModule {}
