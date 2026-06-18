import type { Application } from '@dangao/bun-server';
import { runAllDomainMigrations } from './migrations';
import { ExceptionFilterRegistry } from '@dangao/bun-server';
import { createExecutionAuthMiddleware, loadAppConfig } from '@cube-ai/ai-center/platform/server-base';
import {
  createDeveloperRateLimitMiddleware,
  createTenantContextMiddleware as createFlowTenantContextMiddleware,
} from '@cube-ai/flow-core';
import {
  createGhcloudExecutionAuthReaders,
  createGhcloudIdentityMiddleware,
  createCube2OutboundAuthMiddleware,
} from '@cube-ai/platform-adapter-ghcloud';
import { agenticEngineExceptionFilter } from '../../../packages/agent/engine/src/infra/errors/agentic-engine-exception.filter';
import { connectExceptionFilter } from './platform/connect-exception.filter';
import { DescriptorLoader } from '../../../packages/agent/engine/src/bc/descriptor/descriptor-loader';
import { McpToolRegistrationWorker } from '../../../packages/agent/engine/src/bc/tools/mcp-tool-registration.worker';
import {
  traceIdMiddleware,
  createErrorResponseMiddleware,
  createEngineHttpExceptionFilter,
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
import { ShutdownRegistry } from '../../../packages/agent/engine/src/infra/lifecycle/shutdown-registry';
import { FlowService } from '@cube-ai/flow-studio';
import { startFlowGrpcServer, type StartedFlowGrpcServer } from './grpc/flow-grpc-server';
import { createStudioFlowGrpcBackend } from './grpc/studio-flow-grpc-backend';
import { AiCenterAssembler } from './assembler/ai-center-assembler';

type DiContainer = { resolve: (token: unknown) => unknown };

function parsePositiveRateLimitEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolveMcpRegistrationWorker(container: DiContainer): McpToolRegistrationWorker | null {
  try {
    return container.resolve(McpToolRegistrationWorker) as McpToolRegistrationWorker;
  } catch {
    return null;
  }
}

function triggerMcpToolRegistration(container: DiContainer, reason: string): void {
  const worker = resolveMcpRegistrationWorker(container);
  if (!worker) return;
  worker.runOnce().catch((e) => {
    console.warn(
      `[ai-center] MCP descriptor registration failed reason=${reason}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  });
}

function startMcpToolRegistrationWorker(container: DiContainer): void {
  const worker = resolveMcpRegistrationWorker(container);
  if (!worker) return;
  try {
    worker.start();
    console.info('[ai-center] MCP descriptor registration worker started');
  } catch (e) {
    console.warn(
      `[ai-center] MCP descriptor registration worker start failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
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
  const { registerMockInterceptor } = await import('@cube-ai/ai-center/platform/server-mock');
  registerMockInterceptor(container);

  ExceptionFilterRegistry.getInstance().register(agenticEngineExceptionFilter);
  ExceptionFilterRegistry.getInstance().register(connectExceptionFilter);

  const secretsLoader = container.resolve(NacosSecretsLoader) as NacosSecretsLoader;
  await secretsLoader.load();

  const descriptorLoader = container.resolve(DescriptorLoader) as DescriptorLoader;
  await descriptorLoader.start();
  descriptorLoader.reloadEvents.addEventListener('descriptor.reload', () => {
    triggerMcpToolRegistration(container, 'descriptor.reload');
  });

  const metricsRegistry = container.resolve(MetricsRegistry) as MetricsRegistry;
  const loggerFactory = container.resolve(LoggerFactory) as LoggerFactory;
  const errLog = loggerFactory.getLogger('agentic.engine.server.http.errors');
  ExceptionFilterRegistry.getInstance().register(createEngineHttpExceptionFilter(errLog));
  const flowConfig = await loadAppConfig();

  app.use(traceIdMiddleware);
  app.use(createCube2OutboundAuthMiddleware());
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
      apiKeyReader: ghcloudReaders?.apiKeyReader,
      builtinSystemApiKey: flowConfig.builtinSystemApiKey,
    }),
  );
  const { createKbTenantContextMiddleware } = await import('@cube-ai/kb-core');
  app.use(createKbTenantContextMiddleware());
  app.use(createDeveloperRateLimitMiddleware({ maxPerMin: flowConfig.devApiRateLimitPerMin }));
  app.use(createFlowTenantContextMiddleware());

  registerLifecycleHooks(app);

  const mysqlUrl = Bun.env.AGENTIC_ENGINE_MYSQL_URL ?? process.env.AGENTIC_ENGINE_MYSQL_URL ?? '';
  if (mysqlUrl) await runAllDomainMigrations(mysqlUrl);

  await app.listen(port, hostname);

  // ── Flow gRPC server ────────────────────────────────────────────────────
  const studioFlowService = container.resolve(FlowService) as FlowService;
  const grpcBackend = createStudioFlowGrpcBackend(studioFlowService);

  const grpcPort = Number(
    Bun.env.AI_CENTER_GRPC_PORT ?? process.env.AI_CENTER_GRPC_PORT ?? flowConfig.grpcPort ?? 3110,
  );
  const grpcServer: StartedFlowGrpcServer = await startFlowGrpcServer({
    port: grpcPort,
    hostname,
    flowService: grpcBackend,
    internalInvokeSecretKey: flowConfig.internalInvokeSecretKey,
    logger: loggerFactory.getLogger('flow.grpc.server'),
  });
  process.stdout.write(
    JSON.stringify({ msg: 'ai-center.grpc.listening', port: grpcServer.port, hostname }) + '\n',
  );

  const shutdownRegistry = container.resolve(ShutdownRegistry) as ShutdownRegistry;
  shutdownRegistry.register({
    name: 'flow-grpc-server',
    priority: 90,
    close: async () => {
      await grpcServer.close();
    },
  });

  startMcpToolRegistrationWorker(container);
  return app;
}

export { GracefulShutdownService } from '../../../packages/agent/engine/src/infra/lifecycle/graceful-shutdown.service';
