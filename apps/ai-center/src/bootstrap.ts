import type { Application } from '@dangao/bun-server';
import { ExceptionFilterRegistry } from '@dangao/bun-server';
import { createExecutionAuthMiddleware, loadAppConfig } from '@cube-ai/ai-center/platform/server-base';
import {
  createDeveloperRateLimitMiddleware,
  createProjectContextMiddleware,
} from '@cube-ai/flow-core';
import {
  createGhcloudExecutionAuthReaders,
  createGhcloudIdentityMiddleware,
} from '@cube-ai/platform-adapter-ghcloud';
import { agenticEngineExceptionFilter } from '../../../packages/agent/engine/src/infra/errors/agentic-engine-exception.filter';
import { DescriptorLoader } from '../../../packages/agent/engine/src/bc/descriptor/descriptor-loader';
import { DescriptorRegistryService } from '../../../packages/agent/engine/src/bc/descriptor/descriptor-registry.service';
import { McpBridgeService } from '../../../packages/agent/engine/src/bc/tools/mcp-bridge.service';
import {
  traceIdMiddleware,
  createErrorResponseMiddleware,
} from '../../../packages/agent/engine/src/infra/errors';
import { oauth2IntrospectionMiddleware } from '../../../packages/agent/engine/src/bc/auth/oauth2-introspection.middleware';
import { MetricsRegistry } from '../../../packages/agent/engine/src/infra/observability/metrics-registry';
import { LoggerFactory } from '../../../packages/agent/engine/src/infra/observability/logger.factory';
import { createHttpMetricsMiddleware } from '../../../packages/agent/engine/src/infra/observability/http-metrics.middleware';
import { NacosSecretsLoader } from '../../../packages/agent/engine/src/infra/secrets/nacos-secrets.loader';
import { TenantContextService } from '../../../packages/agent/engine/src/infra/tenant-guard/tenant-context.service';
import { createTenantContextMiddleware } from '../../../packages/agent/engine/src/infra/tenant-guard/tenant-context.middleware';
import { createVersionNegotiationMiddleware } from '../../../packages/agent/engine/src/infra/api/version-negotiation.middleware';
import { RedisIdempotencyStore } from '../../../packages/agent/engine/src/infra/idempotency/redis-idempotency.store';
import { createIdempotencyMiddleware } from '../../../packages/agent/engine/src/infra/idempotency/idempotency.middleware';
import { RedisRateLimiter } from '../../../packages/agent/engine/src/infra/rate-limit/redis-rate-limiter';
import { createRateLimitMiddleware } from '../../../packages/agent/engine/src/infra/rate-limit/rate-limit.middleware';
import { registerLifecycleHooks } from '../../../packages/agent/engine/src/infra/lifecycle/lifecycle-registrations';
import { AiCenterAssembler } from './assembler/ai-center-assembler';
import { createDomainPathRewriteMiddleware } from './routes/domain-path-rewrite.middleware';

type DiContainer = { resolve: (token: unknown) => unknown };

function parsePositiveRateLimitEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function registerMcpDiscoveredTools(container: DiContainer): Promise<void> {
  let registry: DescriptorRegistryService;
  let bridge: McpBridgeService;
  try {
    registry = container.resolve(DescriptorRegistryService) as DescriptorRegistryService;
    bridge = container.resolve(McpBridgeService) as McpBridgeService;
  } catch {
    return;
  }
  const tools = await bridge.listTools();
  for (const tool of tools) {
    if (registry.resolve(tool.name)) continue;
    try {
      registry.register(tool);
    } catch (e) {
      console.warn(
        `[ai-center] skip MCP descriptor ${tool.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

export interface BootstrapOptions {
  port?: number;
  hostname?: string;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<Application> {
  const port =
    options.port ??
    Number(Bun.env.AI_CENTER_PORT ?? Bun.env.AGENTIC_ENGINE_PORT ?? process.env.AGENTIC_ENGINE_PORT ?? 3000);
  const hostname =
    options.hostname ??
    Bun.env.AI_CENTER_HOSTNAME ??
    Bun.env.AGENTIC_ENGINE_HOSTNAME ??
    process.env.AGENTIC_ENGINE_HOSTNAME ??
    '0.0.0.0';

  const assembler = new AiCenterAssembler({ port, hostname });
  const app = assembler.assemble();
  const container = app.getContainer();

  await import('@cube-ai/flow-core/mock');
  const { registerMockInterceptor } = await import('@cube-ai/server-mock');
  registerMockInterceptor(container);

  ExceptionFilterRegistry.getInstance().register(agenticEngineExceptionFilter);

  const secretsLoader = container.resolve(NacosSecretsLoader) as NacosSecretsLoader;
  await secretsLoader.load();

  const descriptorLoader = container.resolve(DescriptorLoader) as DescriptorLoader;
  await descriptorLoader.start();
  await registerMcpDiscoveredTools(container);

  const metricsRegistry = container.resolve(MetricsRegistry) as MetricsRegistry;
  const loggerFactory = container.resolve(LoggerFactory) as LoggerFactory;
  const errLog = loggerFactory.getLogger('agentic.engine.server.http.errors');
  const flowConfig = await loadAppConfig();

  app.use(traceIdMiddleware);
  app.use(createDomainPathRewriteMiddleware());
  app.use(createVersionNegotiationMiddleware());
  app.use(createHttpMetricsMiddleware(metricsRegistry));
  app.use(oauth2IntrospectionMiddleware);
  const idemStore = container.resolve(RedisIdempotencyStore) as RedisIdempotencyStore;
  app.use(createIdempotencyMiddleware({ store: idemStore }));
  const tenantCtx = container.resolve(TenantContextService) as TenantContextService;
  app.use(createTenantContextMiddleware(tenantCtx));
  const rateLimiter = container.resolve(RedisRateLimiter) as RedisRateLimiter;
  app.use(
    createRateLimitMiddleware({
      limiter: rateLimiter,
      config: {
        capacity: parsePositiveRateLimitEnv(
          Bun.env.AGENTIC_ENGINE_RATE_LIMIT_CAPACITY ?? process.env.AGENTIC_ENGINE_RATE_LIMIT_CAPACITY,
          100,
        ),
        refillRate: parsePositiveRateLimitEnv(
          Bun.env.AGENTIC_ENGINE_RATE_LIMIT_REFILL_PER_SECOND ??
            process.env.AGENTIC_ENGINE_RATE_LIMIT_REFILL_PER_SECOND,
          10,
        ),
      },
    }),
  );
  app.use(createErrorResponseMiddleware(metricsRegistry, errLog));

  const useGhcloudIdentity =
    (Bun.env.USE_GHCLOUD_IDENTITY ?? process.env.USE_GHCLOUD_IDENTITY) !== '0';
  const jwtKeyUrl = Bun.env.JWT_KEY_URL?.trim() || process.env.JWT_KEY_URL?.trim() || '';

  if (useGhcloudIdentity) {
    if (!jwtKeyUrl) {
      throw new Error(
        'JWT_KEY_URL is required when ghcloud identity is enabled (set USE_GHCLOUD_IDENTITY=0 to disable)',
      );
    }
    for (const mw of createGhcloudIdentityMiddleware({ jwtKeyUrl })) {
      app.use(mw);
    }
  }

  const ghcloudReaders = useGhcloudIdentity
    ? createGhcloudExecutionAuthReaders({})
    : null;

  const accessTokenReader = ghcloudReaders?.accessTokenReader ?? {
    verifyAccessToken: async () => ({
      userId: 'dev',
      username: 'dev',
      role: 'super_admin',
      isSuperAdmin: true,
    }),
  };

  app.use(
    createExecutionAuthMiddleware({
      accessTokenReader,
    }),
  );
  app.use(createDeveloperRateLimitMiddleware({ maxPerMin: flowConfig.devApiRateLimitPerMin }));
  app.use(createProjectContextMiddleware());

  registerLifecycleHooks(app);
  await app.listen(port, hostname);
  return app;
}

export { GracefulShutdownService } from '../../../packages/agent/engine/src/infra/lifecycle/graceful-shutdown.service';
