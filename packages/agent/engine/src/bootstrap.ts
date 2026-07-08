import type { Application } from "@dangao/bun-server";
import { ExceptionFilterRegistry } from "@dangao/bun-server";

import { EngineAssembler } from "./assembler/engine-assembler";
import { oauth2IntrospectionMiddleware } from "./bc/auth/oauth2-introspection.middleware";
import { DescriptorMcpModule } from "./bc/descriptor-mcp/descriptor-mcp.module";
import { DescriptorLoader } from "./bc/descriptor/descriptor-loader";
import { DescriptorRegistryService } from "./bc/descriptor/descriptor-registry.service";
import { buildManagementToolDescriptors } from "./bc/tools/handlers/descriptor-ops";
import { McpToolRegistrationWorker } from "./bc/tools/mcp-tool-registration.worker";
import { createVersionNegotiationMiddleware } from "./infra/api/version-negotiation.middleware";
import { traceIdMiddleware, createErrorResponseMiddleware } from "./infra/errors";
import { agenticEngineExceptionFilter } from "./infra/errors/agentic-engine-exception.filter";
import { createNoisePathMiddleware } from "./infra/http/noise-path.middleware";
import { createIdempotencyMiddleware } from "./infra/idempotency/idempotency.middleware";
import { RedisIdempotencyStore } from "./infra/idempotency/redis-idempotency.store";
import { registerLifecycleHooks } from "./infra/lifecycle/lifecycle-registrations";
import { createHttpMetricsMiddleware } from "./infra/observability/http-metrics.middleware";
import { LoggerFactory } from "./infra/observability/logger.factory";
import { MetricsRegistry } from "./infra/observability/metrics-registry";
import { createRateLimitMiddleware } from "./infra/rate-limit/rate-limit.middleware";
import { RedisRateLimiter } from "./infra/rate-limit/redis-rate-limiter";
import { NacosSecretsLoader } from "./infra/secrets/nacos-secrets.loader";
import { provisionSfidNodeFromContainer } from "./infra/sfid/sfid-node-provisioning";
import { createTenantContextMiddleware } from "./infra/tenant-guard/tenant-context.middleware";
import { TenantContextService } from "./infra/tenant-guard/tenant-context.service";

type DiContainer = { resolve: (token: unknown) => unknown };

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
      console.warn(`[bootstrap] skip management descriptor ${descriptor.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
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
    console.warn(`[bootstrap] MCP descriptor registration failed reason=${reason}: ${e instanceof Error ? e.message : String(e)}`);
  });
}

function startMcpToolRegistrationWorker(container: DiContainer): void {
  const worker = resolveMcpRegistrationWorker(container);
  if (!worker) return;
  try {
    worker.start();
    console.info("[bootstrap] MCP descriptor registration worker started");
  } catch (e) {
    console.warn(`[bootstrap] MCP descriptor registration worker start failed: ${e instanceof Error ? e.message : String(e)}`);
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

export async function bootstrap(options: BootstrapOptions = {}): Promise<Application> {
  const port = options.port ?? Number(Bun.env.AGENTIC_ENGINE_PORT ?? process.env.AGENTIC_ENGINE_PORT ?? 3000);
  const hostname = options.hostname ?? Bun.env.AGENTIC_ENGINE_HOSTNAME ?? process.env.AGENTIC_ENGINE_HOSTNAME ?? "0.0.0.0";

  const assembler = new EngineAssembler({ port, hostname });
  const app = assembler.assemble();
  // ADR-0027 §8: engine 出站 MCP server 门面（管理 ops 工具集对外面）。
  app.registerModule(DescriptorMcpModule);
  const container = app.getContainer();

  ExceptionFilterRegistry.getInstance().register(agenticEngineExceptionFilter);

  // P3-01: Nacos secrets fail-fast before any HTTP serving.
  const secretsLoader = container.resolve(NacosSecretsLoader) as NacosSecretsLoader;
  await secretsLoader.load();

  // Fix A (串消息根因): 在任何会 mint SFID 的启动步骤之前确定进程唯一 nodeId。
  // 显式 AGENTIC_ENGINE_NODE_ID → 用之；否则抢 Redis 节点租约；两者皆无 → fail-closed
  // 拒绝启动（绝不静默默认 0，避免多副本 sessionId 碰撞）。
  const sfidLog = (container.resolve(LoggerFactory) as LoggerFactory).getLogger("agentic.engine.sfid");
  await provisionSfidNodeFromContainer(container, sfidLog);

  // P3-11: Descriptor loader (Nacos + local dir) — register tools before requests.
  const descriptorLoader = container.resolve(DescriptorLoader) as DescriptorLoader;
  await descriptorLoader.start();
  registerManagementToolDescriptors(container);
  descriptorLoader.reloadEvents.addEventListener("descriptor.reload", () => {
    registerManagementToolDescriptors(container);
    triggerMcpToolRegistration(container, "descriptor.reload");
  });

  const metricsRegistry = container.resolve(MetricsRegistry) as MetricsRegistry;
  const loggerFactory = container.resolve(LoggerFactory) as LoggerFactory;
  const errLog = loggerFactory.getLogger("agentic.engine.server.http.errors");

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
  app.use(createNoisePathMiddleware());
  app.use(createVersionNegotiationMiddleware());
  app.use(createHttpMetricsMiddleware(metricsRegistry));
  app.use(oauth2IntrospectionMiddleware);
  const idemStore = container.resolve(RedisIdempotencyStore) as RedisIdempotencyStore;
  app.use(createIdempotencyMiddleware({ store: idemStore }));
  const tenantCtx = container.resolve(TenantContextService) as TenantContextService;
  app.use(createTenantContextMiddleware(tenantCtx));
  const rateLimiter = container.resolve(RedisRateLimiter) as RedisRateLimiter;
  const rateLimitCapacity = parsePositiveRateLimitEnv(
    Bun.env.AGENTIC_ENGINE_RATE_LIMIT_CAPACITY ?? process.env.AGENTIC_ENGINE_RATE_LIMIT_CAPACITY,
    100,
  );
  const rateLimitRefill = parsePositiveRateLimitEnv(
    Bun.env.AGENTIC_ENGINE_RATE_LIMIT_REFILL_PER_SECOND ?? process.env.AGENTIC_ENGINE_RATE_LIMIT_REFILL_PER_SECOND,
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
  startMcpToolRegistrationWorker(container);
  return app;
}
