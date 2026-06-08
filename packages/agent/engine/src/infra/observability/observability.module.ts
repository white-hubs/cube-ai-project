import { Module } from '@dangao/bun-server';
import { LOGGER_FACTORY_FOR_ADAPTER_TOKEN } from '@cube-ai/agent-engine/adapters';
import { MetricsRegistry, DI_METRICS_REGISTRY } from './metrics-registry';
import { LoggerFactory, DI_LOGGER_FACTORY } from './logger.factory';
import { MetricsController } from './metrics.controller';

@Module({
  controllers: [MetricsController],
  providers: [
    MetricsRegistry,
    {
      provide: DI_METRICS_REGISTRY,
      useExisting: MetricsRegistry,
    },
    {
      provide: DI_LOGGER_FACTORY,
      useClass: LoggerFactory,
    },
    {
      provide: LOGGER_FACTORY_FOR_ADAPTER_TOKEN,
      useExisting: DI_LOGGER_FACTORY,
    },
  ],
  exports: [
    MetricsRegistry,
    DI_METRICS_REGISTRY,
    DI_LOGGER_FACTORY,
    LOGGER_FACTORY_FOR_ADAPTER_TOKEN,
  ],
})
export class ObservabilityModule {}
