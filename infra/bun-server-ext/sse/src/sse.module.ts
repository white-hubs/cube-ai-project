import { Global, Module } from '@dangao/bun-server';
import Redis from 'ioredis';
import { DrainService } from './drain.service';
import { InMemoryReplayBufferStore, RedisReplayBufferStore } from './replay-buffer';
import { SessionSseEmitter } from './sse-emitter';
import { SSE_REPLAY_BUFFER_STORE_TOKEN } from './sse.tokens';

export { SSE_REPLAY_BUFFER_STORE_TOKEN } from './sse.tokens';

function createRedisOptional(): Redis | null {
  const url =
    process.env.AGENTIC_ENGINE_REDIS_URL ??
    process.env.REDIS_URL ??
    process.env.BUN_REDIS_URL ??
    '';
  if (!url) return null;
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });
}

/**
 * `SseExtModule` — SSE replay buffer + drain + session emitter.
 *
 * Replay store: Redis LIST when `AGENTIC_ENGINE_REDIS_URL` (or `REDIS_URL`) is set,
 * otherwise in-memory (local dev only; P3-06 Redis is required for multi-instance).
 */
@Global()
@Module({
  providers: [
    DrainService,
    SessionSseEmitter,
    {
      provide: SSE_REPLAY_BUFFER_STORE_TOKEN,
      useFactory: () => {
        const client = createRedisOptional();
        if (client) {
          return new RedisReplayBufferStore(client);
        }
        return new InMemoryReplayBufferStore();
      },
    },
  ],
  exports: [DrainService, SessionSseEmitter, SSE_REPLAY_BUFFER_STORE_TOKEN],
})
export class SseExtModule {}
