import { Module } from '@dangao/bun-server';
import { HealthController } from './health.controller';
import { ReadinessRegistry } from './readiness-registry';
import { READINESS_REGISTRY_TOKEN } from './health.tokens';

/**
 * HealthModule — `/health/live` + `/health/ready` (T09).
 *
 * `ReadinessRegistry` is a process-singleton collector for {@link ReadinessProbe}s.
 * Modules with backing dependencies (MySQL / Redis / Qdrant / Nacos / …) resolve
 * the registry at bootstrap time and call `register({...})` to opt in.
 */
@Module({
  controllers: [HealthController],
  providers: [
    ReadinessRegistry,
    {
      provide: READINESS_REGISTRY_TOKEN,
      useExisting: ReadinessRegistry,
    },
  ],
  exports: [ReadinessRegistry, READINESS_REGISTRY_TOKEN],
})
export class HealthModule {}
