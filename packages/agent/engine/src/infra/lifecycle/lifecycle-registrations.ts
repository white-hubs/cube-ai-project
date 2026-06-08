/**
 * Bootstrap-time registration of {@link ShutdownHook}s and
 * {@link ReadinessProbe}s for engine-managed resources (T05 + T09).
 *
 * Why bootstrap and not per-module providers?
 *   - `@dangao/bun-server` v3 DI does not support multi-injection nor
 *     useFactory side-effects with `inject` chains spanning BC boundaries.
 *   - Several resources (auth-redis singleton, lazy MySQL pool, BullMQ
 *     workers) are owned by helper functions rather than `Injectable`s.
 *   - Registering centrally keeps each module file untouched (per task
 *     constraint § "module 文件结构复杂时统一在 bootstrap/assembler 注册").
 */
import type { Application } from '@dangao/bun-server';
import type { Pool } from 'mysql2/promise';
import type Redis from 'ioredis';

import {
  ShutdownRegistry,
} from './shutdown-registry';
import {
  ReadinessRegistry,
} from '../health/readiness-registry';
import { MYSQL_POOL_TOKEN } from '../mysql/mysql.tokens';
import { AUTH_TOKENS } from '../../bc/auth/auth.tokens';
import { REDIS_CLIENT_TOKEN } from '../../bc/session/session.tokens';
import {
  OUTBOX_REDIS_TOKEN,
  OutboxRelayService,
} from '@cube-ai/bun-server-ext-outbox';
import {
  MEMORY_PROJECTION_RELAY_TOKEN,
} from '../../bc/tachu/tachu.tokens';
import { MemoryProjectionRelayService } from '../memory-projection/memory-projection-relay.service';
import { TACHU_VECTOR_INDEX_TOKEN } from '@cube-ai/agent-engine/adapters';
import { CubeQdrantMemoryIndex } from '@cube-ai/agent-engine/adapters/vector';
import { NacosSecretsLoader } from '../secrets/nacos-secrets.loader';
import { LocalFileGc } from '../../bc/files/local-file.gc';

const PROBE_DEFAULT_TIMEOUT_MS = 1_500;

/**
 * Wire engine-managed resources into the global {@link ShutdownRegistry} and
 * {@link ReadinessRegistry} singletons.
 *
 * Idempotent: each registry's `clear()` is intentionally NOT called — callers
 * are expected to invoke this once during bootstrap.
 */
export function registerLifecycleHooks(app: Application): void {
  const c = app.getContainer();
  const shutdown = c.resolve(ShutdownRegistry) as ShutdownRegistry;
  const readiness = c.resolve(ReadinessRegistry) as ReadinessRegistry;

  // ─── Memory projection relay (priority 145): flush + stop worker ───────────
  try {
    const memoryRelay = c.resolve(MEMORY_PROJECTION_RELAY_TOKEN) as MemoryProjectionRelayService;
    shutdown.register({
      name: 'memory-projection-relay',
      priority: 145,
      close: async () => {
        await memoryRelay.flush();
        await memoryRelay.stop();
      },
    });
  } catch {
    // MemoryProjectionRelayService not registered — skip.
  }

  // ─── Outbox Relay (priority 150): release leader + stop poll loop ────────
  try {
    const relay = c.resolve(OutboxRelayService) as OutboxRelayService;
    shutdown.register({
      name: 'outbox-relay',
      priority: 150,
      close: async () => {
        await relay.stop();
      },
    });
  } catch {
    // OutboxRelayService not registered (degraded boot) — skip.
  }

  // ─── MySQL pool (priority 100): drain pool / sockets ─────────────────────
  // 注意：infra/mysql/mysql.module.ts 与 bc/session/session.module.ts 都
  // 注册了 MYSQL_POOL_TOKEN（同一 Symbol），后注册者覆盖前者；本钩子关闭的
  // 是 SessionModule 工厂返回的池实例。
  try {
    const pool = c.resolve(MYSQL_POOL_TOKEN) as Pool | null;
    if (pool && typeof pool.end === 'function') {
      shutdown.register({
        name: 'mysql-pool',
        priority: 100,
        close: async () => {
          await pool.end();
        },
      });
      readiness.register({
        name: 'mysql',
        timeoutMs: PROBE_DEFAULT_TIMEOUT_MS,
        check: async () => {
          await pool.query('SELECT 1');
          return { status: 'UP' };
        },
      });
    }
  } catch {
    // Pool not provided (env without AGENTIC_ENGINE_MYSQL_URL) — no probe / hook.
  }

  // ─── Auth Redis (priority 100): graceful QUIT ────────────────────────────
  registerRedisHookAndProbe(c, shutdown, readiness, AUTH_TOKENS.REDIS_CLIENT, 'redis-auth', 'redis');

  // ─── Session Redis (priority 100): same shape, different token ───────────
  registerRedisHookAndProbe(c, shutdown, readiness, REDIS_CLIENT_TOKEN, 'redis-session', 'redis-session');

  // ─── Outbox Redis (priority 100): owned by OutboxExtModule ──────────────
  registerRedisHookAndProbe(c, shutdown, readiness, OUTBOX_REDIS_TOKEN, 'redis-outbox', 'redis-outbox');

  // ─── Qdrant (no shutdown — REST client is stateless): probe only ─────────
  try {
    const vector = c.resolve(TACHU_VECTOR_INDEX_TOKEN);
    if (vector instanceof CubeQdrantMemoryIndex) {
      readiness.register({
        name: 'qdrant',
        timeoutMs: 2_000,
        check: async () => {
          await vector.healthCheck();
          return { status: 'UP' };
        },
      });
    }
  } catch {
    // Adapter not registered — skip.
  }

  // ─── Nacos secrets (no shutdown — HTTP client is stateless): probe only ──
  try {
    const loader = c.resolve(NacosSecretsLoader) as NacosSecretsLoader;
    readiness.register({
      name: 'nacos',
      timeoutMs: 2_000,
      check: async () => {
        const source = process.env['AGENTIC_ENGINE_SECRETS_SOURCE'];
        if (source === 'env') {
          return { status: 'UP', detail: 'env-source' };
        }
        // After bootstrap, NacosSecretsLoader.load() succeeded — the cache is
        // populated. Reporting UP here reflects "secrets are usable"; a deeper
        // health probe would require a fresh Nacos round-trip per scrape, which
        // is too expensive for liveness gating.
        const aliases = loader.listAliases();
        return aliases.length > 0
          ? { status: 'UP' }
          : { status: 'UP', detail: 'no-aliases-loaded' };
      },
    });
  } catch {
    // Loader not registered — skip.
  }

  // ─── Local file GC: start periodic cleanup + stop on shutdown ──────────────
  try {
    const localFileGc = c.resolve(LocalFileGc) as LocalFileGc;
    localFileGc.start();
    shutdown.register({
      name: 'local-file-gc',
      priority: 120,
      close: async () => {
        await localFileGc.stop();
      },
    });
  } catch {
    // Local file extension not registered — skip.
  }
}

interface ContainerLike {
  resolve<T>(token: string | symbol | (new (...args: unknown[]) => T)): T;
  isRegistered?: (token: string | symbol | (new (...args: unknown[]) => unknown)) => boolean;
}

function registerRedisHookAndProbe(
  c: ContainerLike,
  shutdown: ShutdownRegistry,
  readiness: ReadinessRegistry,
  token: symbol,
  hookName: string,
  probeName: string,
): void {
  let client: Redis | null = null;
  try {
    client = c.resolve(token) as Redis | null;
  } catch {
    return;
  }
  if (!client || typeof client.quit !== 'function') return;

  shutdown.register({
    name: hookName,
    priority: 100,
    close: async () => {
      try {
        await client!.quit();
      } catch {
        // Already disconnected / never connected (lazyConnect) — ignore.
      }
    },
  });
  readiness.register({
    name: probeName,
    timeoutMs: 1_000,
    check: async () => {
      const reply = await client!.ping();
      return reply === 'PONG' ? { status: 'UP' } : { status: 'DOWN', detail: `ping=${reply}` };
    },
  });
}

/**
 * Register a BullMQ worker shutdown hook. Called from {@link startJobWorkers}
 * which owns the live `Worker` instances.
 */
export function registerWorkerShutdownHook(
  app: Application,
  workers: Array<{ close(): Promise<void> }>,
): void {
  const c = app.getContainer();
  const shutdown = c.resolve(ShutdownRegistry) as ShutdownRegistry;
  shutdown.register({
    name: 'bullmq-workers',
    priority: 200,
    close: async () => {
      await Promise.all(
        workers.map(async (w) => {
          try {
            await w.close();
          } catch {
            // Already closed — fall through.
          }
        }),
      );
    },
  });
}
