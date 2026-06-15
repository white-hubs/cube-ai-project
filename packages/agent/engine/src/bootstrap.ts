import type { Application } from '@dangao/bun-server';
import { ExceptionFilterRegistry } from '@dangao/bun-server';
import { EngineAssembler } from './assembler/engine-assembler';
import { agenticEngineExceptionFilter } from './infra/errors/agentic-engine-exception.filter';
import { DescriptorLoader } from './bc/descriptor/descriptor-loader';
import { DescriptorRegistryService } from './bc/descriptor/descriptor-registry.service';
import { McpBridgeService } from './bc/tools/mcp-bridge.service';
import { DescriptorMcpModule } from './bc/descriptor-mcp/descriptor-mcp.module';
import { buildManagementToolDescriptors } from './bc/tools/handlers/descriptor-ops';
import {
  traceIdMiddleware,
  createErrorResponseMiddleware,
} from './infra/errors';
import { oauth2IntrospectionMiddleware } from './bc/auth/oauth2-introspection.middleware';
import { MetricsRegistry } from './infra/observability/metrics-registry';
import { LoggerFactory } from './infra/observability/logger.factory';
import { createHttpMetricsMiddleware } from './infra/observability/http-metrics.middleware';
import { NacosSecretsLoader } from './infra/secrets/nacos-secrets.loader';
import { TenantContextService } from './infra/tenant-guard/tenant-context.service';
import { createTenantContextMiddleware } from './infra/tenant-guard/tenant-context.middleware';
import { createVersionNegotiationMiddleware } from './infra/api/version-negotiation.middleware';
import { RedisIdempotencyStore } from './infra/idempotency/redis-idempotency.store';
import { createIdempotencyMiddleware } from './infra/idempotency/idempotency.middleware';
import { RedisRateLimiter } from './infra/rate-limit/redis-rate-limiter';
import { createRateLimitMiddleware } from './infra/rate-limit/rate-limit.middleware';
import { registerLifecycleHooks } from './infra/lifecycle/lifecycle-registrations';

type DiContainer = { resolve: (token: unknown) => unknown };

/** Compose `VAR=` injects ""; treat as unset so tachu capability routes stay valid. */
function resolveNonEmptyEnv(raw: string | undefined, fallback: string): string {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/** Empty compose env must not collapse token-bucket to capacity/refill 0 (always 429). */
function parsePositiveRateLimitEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * ADR-0027 §7：把管理 ops 工具集（系统级 ToolDescriptor）注册进 registry，使任何进程内
 * agent 经 `availableTools` 即可获得管理能力。在 loader 首轮加载（其快照替换会清掉非内置项）
 * 之后注册，并在每次 reload 后补登记。
 */
function registerManagementToolDescriptors(container: DiContainer): void {
  let registry: DescriptorRegistryService;
  try {
    registry = container.resolve(DescriptorRegistryService) as DescriptorRegistryService;
  } catch {
    return;
  }
  for (const descriptor of buildManagementToolDescriptors()) {
    if (registry.resolve(descriptor.name)) continue;
    try {
      registry.register(descriptor);
    } catch (e) {
      console.warn(
        `[bootstrap] skip management descriptor ${descriptor.name}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
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
        `[bootstrap] skip MCP descriptor ${tool.name}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}

function mcpDiscoveryBootTimeoutMs(): number {
  const raw = process.env['AGENTIC_ENGINE_MCP_DISCOVERY_BOOT_TIMEOUT_MS'];
  if (raw === undefined || raw.trim() === '') return 30_000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

/** Boot-time MCP scan must not block HTTP listen when upstream MCP is unreachable. */
async function registerMcpDiscoveredToolsAtBoot(container: DiContainer): Promise<void> {
  const timeoutMs = mcpDiscoveryBootTimeoutMs();
  console.info(`[bootstrap] MCP descriptor discovery begin timeoutMs=${timeoutMs}`);
  try {
    await Promise.race([
      registerMcpDiscoveredTools(container),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`MCP discovery timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    console.info('[bootstrap] MCP descriptor discovery complete');
  } catch (e) {
    console.warn(
      `[bootstrap] MCP descriptor discovery skipped: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

/**
 * Engine bootstrap contract。
 *
 * Phase 3：`SecretsModule.load()` fail-fast → MetricsRegistry（prom-client）→ HTTP 中间件链。
 */
export interface BootstrapOptions {
  port?: number;
  hostname?: string;
}

export async function bootstrap(
  options: BootstrapOptions = {},
): Promise<Application> {
  const port =
    options.port ??
    Number(
      Bun.env.AGENTIC_ENGINE_PORT ?? process.env.AGENTIC_ENGINE_PORT ?? 3000,
    );
  const hostname =
    options.hostname ??
    Bun.env.AGENTIC_ENGINE_HOSTNAME ??
    process.env.AGENTIC_ENGINE_HOSTNAME ??
    '0.0.0.0';

  const assembler = new EngineAssembler({ port, hostname });
  const app = assembler.assemble();
  // ADR-0027 §8: engine 出站 MCP server 门面（管理 ops 工具集对外面）。
  app.registerModule(DescriptorMcpModule);
  const container = app.getContainer();

  ExceptionFilterRegistry.getInstance().register(agenticEngineExceptionFilter);

  // P3-01: Nacos secrets fail-fast before any HTTP serving.
  const secretsLoader = container.resolve(
    NacosSecretsLoader,
  ) as NacosSecretsLoader;
  await secretsLoader.load();

  // P3-11: Descriptor loader (Nacos + local dir) — register tools before requests.
  const descriptorLoader = container.resolve(
    DescriptorLoader,
  ) as DescriptorLoader;
  await descriptorLoader.start();
  registerManagementToolDescriptors(container);
  await registerMcpDiscoveredToolsAtBoot(container);
  descriptorLoader.reloadEvents.addEventListener('descriptor.reload', () => {
    registerManagementToolDescriptors(container);
    registerMcpDiscoveredTools(container).catch((e) =>
      console.warn(
        `[bootstrap] MCP descriptor discovery failed after reload: ${
          e instanceof Error ? e.message : String(e)
        }`,
      ),
    );
  });

  const metricsRegistry = container.resolve(MetricsRegistry) as MetricsRegistry;
  const loggerFactory = container.resolve(LoggerFactory) as LoggerFactory;
  const errLog = loggerFactory.getLogger('agentic.engine.server.http.errors');

  // Middleware chain (ADR-0019 fixed order + Phase-4 derivatives):
  //   1.   traceId             — outermost; must run before everything else (P1-02)
  //   1.5  versionNegotiation  — SDK ↔ engine version handshake (T11);
  //                              after traceId so the 412 envelope has a trace,
  //                              before http-metrics so incompatible clients
  //                              are rejected before hitting the observability
  //                              counters. /health/* and /metrics bypass.
  //   2.   http-metrics        — observability counters/histograms (P1-10)
  //   3.   oauth2-introspection — auth context (P1-05)
  //   3.3  idempotency         — Idempotency-Key replay/lock (T13-G10);
  //                              after oauth2 so subject.userId is available
  //                              as a key dimension, before tenantContext so
  //                              replays happen even when tenant ALS is not
  //                              yet established. POST/PUT/PATCH only;
  //                              /health/* + /metrics bypass.
  //   3.5  tenant-context      — propagate subject.tenant via AsyncLocalStorage
  //                              (T10); context-propagation derivative, not a
  //                              protocol-layer step; placed inside the auth
  //                              boundary so subject is already populated.
  //   3.7  rateLimit           — token-bucket per (tenant, path) (T13-G8);
  //                              after tenantContext so the bucket dimension
  //                              is reliable, before errorResponse so a 429
  //                              is enveloped by the canonical mapper.
  //                              /health/* + /metrics bypass; unauthenticated
  //                              requests fall through.
  //   4.   errorResponse       — innermost; envelope for thrown errors (P1-02)
  //
  // versionNegotiation (T11), tenantContext (T10), idempotency (T13-G10),
  // rateLimit (T13-G8) are all derivative layers around the canonical 4-step
  // chain — we do not edit ADR-0019 here; formal inclusion of these steps is
  // tracked as a follow-up ADR.
  //
  // ref: docs/adr/ADR-0019-middleware-chain-order.md
  //      docs/technical-design/phase-4/T10-tenant-context-migration.md
  //      docs/technical-design/phase-4/T11-version-compat-matrix.md
  //      docs/technical-design/phase-4/T13-idempotency-rate-limit.md (TBD)
  app.use(traceIdMiddleware);
  app.use(createVersionNegotiationMiddleware());
  app.use(createHttpMetricsMiddleware(metricsRegistry));
  app.use(oauth2IntrospectionMiddleware);
  const idemStore = container.resolve(RedisIdempotencyStore) as RedisIdempotencyStore;
  app.use(createIdempotencyMiddleware({ store: idemStore }));
  const tenantCtx = container.resolve(TenantContextService) as TenantContextService;
  app.use(createTenantContextMiddleware(tenantCtx));
  const rateLimiter = container.resolve(RedisRateLimiter) as RedisRateLimiter;
  const rateLimitCapacity = parsePositiveRateLimitEnv(
    Bun.env.AGENTIC_ENGINE_RATE_LIMIT_CAPACITY ??
      process.env.AGENTIC_ENGINE_RATE_LIMIT_CAPACITY,
    100,
  );
  const rateLimitRefill = parsePositiveRateLimitEnv(
    Bun.env.AGENTIC_ENGINE_RATE_LIMIT_REFILL_PER_SECOND ??
      process.env.AGENTIC_ENGINE_RATE_LIMIT_REFILL_PER_SECOND,
    10,
  );
  app.use(
    createRateLimitMiddleware({
      limiter: rateLimiter,
      config: {
        capacity: rateLimitCapacity,
        refillRate: rateLimitRefill,
      },
    }),
  );
  app.use(createErrorResponseMiddleware(metricsRegistry, errLog));

  // T05 + T09: wire engine-managed shutdown hooks + readiness probes after
  // all DI providers are available, before the HTTP listener starts (so
  // `/health/ready` reflects probes from the very first request).
  registerLifecycleHooks(app);

  await app.listen(port, hostname);
  return app;
}
