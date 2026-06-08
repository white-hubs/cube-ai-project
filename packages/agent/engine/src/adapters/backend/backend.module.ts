import { Module } from '@dangao/bun-server';
import { TACHU_EXECUTION_BACKEND_TOKEN } from '../tokens';
import {
  BullMQExecutionBackendAdapter,
  BULLMQ_DEFAULT_QUEUE,
} from './bullmq-backend';

@Module({
  providers: [
    {
      provide: TACHU_EXECUTION_BACKEND_TOKEN,
      useFactory: () => {
        const redisUrl =
          process.env['AGENTIC_ENGINE_REDIS_URL'] ?? 'redis://localhost:6379';
        const queueName =
          process.env['AGENTIC_ENGINE_BULLMQ_QUEUE'] ?? BULLMQ_DEFAULT_QUEUE;
        return new BullMQExecutionBackendAdapter({ redisUrl, queueName });
      },
    },
  ],
  exports: [TACHU_EXECUTION_BACKEND_TOKEN],
})
export class TachuExecutionBackendModule {}
