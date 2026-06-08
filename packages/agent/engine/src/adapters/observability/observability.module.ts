import { Module, type Container } from '@dangao/bun-server';
import { TACHU_OBSERVABILITY_EMITTER_TOKEN } from '../tokens';
import {
  PinoObservabilityAdapter,
  LOGGER_FACTORY_FOR_ADAPTER_TOKEN,
  type ILoggerFactory,
} from './pino-observability';
import { AgenticTracer } from './otel-tracer';

@Module({
  providers: [
    AgenticTracer,
    {
      provide: TACHU_OBSERVABILITY_EMITTER_TOKEN,
      // bun-server：`useFactory` 只能是 `(container) => …`，无 Nest 风格 `inject[]`。
      useFactory: (c: Container) => {
        const lf = c.resolve(LOGGER_FACTORY_FOR_ADAPTER_TOKEN) as ILoggerFactory;
        const tracer = c.resolve(AgenticTracer) as AgenticTracer;
        return new PinoObservabilityAdapter(lf, tracer);
      },
    },
  ],
  exports: [TACHU_OBSERVABILITY_EMITTER_TOKEN, AgenticTracer],
})
export class TachuObservabilityModule {}
