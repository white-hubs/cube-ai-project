import { Module } from "@dangao/bun-server";
import type { Pool } from "mysql2/promise";

import { AGENTIC_OBSERVABILITY_TOKEN, AGENTIC_PROVIDER_TOKEN, AGENTIC_MEMORY_SYSTEM_TOKEN } from "@cube-ai/agent-engine/adapters";
import { OutboxWriterImpl, OUTBOX_WRITER_TOKEN } from "@cube-ai/bun-server-ext-outbox";
import { SseExtModule } from "@cube-ai/bun-server-ext-sse";
import { AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN, type LlmProviderPort } from "@cube-ai/contracts/platform";

import { MemoryProjectionRelayService } from "../../infra/memory-projection/memory-projection-relay.service";
import { sharedSfidService } from "../../infra/sfid/shared-sfid";
import { DescriptorListingRepositoryImpl } from "../descriptor/descriptor-listing.repository";
import { DescriptorLoader } from "../descriptor/descriptor-loader";
import { DescriptorRegistryService } from "../descriptor/descriptor-registry.service";
import { DescriptorModule } from "../descriptor/descriptor.module";
import { RuleRegistryService } from "../descriptor/rule-registry.service";
import { RunnableAgentResolver } from "../descriptor/runnable-agent-resolver";
import { SkillRegistryService } from "../descriptor/skill-registry.service";
import { TenantDescriptorResolver } from "../descriptor/tenant-descriptor-resolver";
import { TenantDescriptorRepositoryImpl } from "../descriptor/tenant-descriptor.repository";
import { UserShelfRepositoryImpl } from "../descriptor/user-shelf.repository";
import { LocalFileController } from "../files/local-file.controller";
import { LocalFileGc } from "../files/local-file.gc";
import { LocalFileRepository } from "../files/local-file.repository";
import { LocalFileService } from "../files/local-file.service";
import { JobsModule } from "../jobs/jobs.module";
import { EngineFactory } from "../tachu/engine-factory";
import { TachuRuntimeModule } from "../tachu/tachu-runtime.module";
import { TURN_CONTEXT_HOLDER_TOKEN, MEMORY_PROJECTION_RELAY_TOKEN } from "../tachu/tachu.tokens";
import { ToolService } from "../tools/tool.service";
import { ToolsModule } from "../tools/tools.module";
import { createEngineMysqlPool } from "./mysql-pool";
import { SessionRepositoryImpl } from "./repository/session.repository";
import { createSessionRedis } from "./session-redis";
import { SessionController } from "./session.controller";
import { SessionService } from "./session.service";
import {
  TURN_LOCK_SERVICE_TOKEN,
  SNAPSHOT_SERVICE_TOKEN,
  SESSION_REPO_TOKEN,
  REDIS_CLIENT_TOKEN,
  MYSQL_POOL_TOKEN,
  TURN_REPO_TOKEN,
} from "./session.tokens";
import { SnapshotDecision } from "./snapshot-decision";
import { SnapshotService } from "./snapshot.service";
import { TurnLockService } from "./turn-lock.service";
import { TurnRepository } from "./turn.repository";
import { TurnService } from "./turn.service";

type DiContainer = { resolve: (token: unknown) => unknown };

/**
 * SessionModule — DI registration for Session BC.
 *
 * ref: P1-06 design doc §6 · ADR-0018 — SessionModule stays after Adapter modules in assembler
 */
@Module({
  imports: [SseExtModule, JobsModule, DescriptorModule, ToolsModule, TachuRuntimeModule],
  providers: [
    SnapshotDecision,
    {
      provide: MYSQL_POOL_TOKEN,
      useFactory: () => createEngineMysqlPool(),
    },
    {
      provide: REDIS_CLIENT_TOKEN,
      useFactory: () => createSessionRedis(),
    },
    {
      provide: SESSION_REPO_TOKEN,
      useFactory: () => new SessionRepositoryImpl(createEngineMysqlPool()),
    },
    LocalFileRepository,
    LocalFileService,
    LocalFileGc,
    TurnRepository,
    {
      provide: TURN_REPO_TOKEN,
      useExisting: TurnRepository,
    },
    {
      provide: OUTBOX_WRITER_TOKEN,
      useFactory: (c: DiContainer) =>
        new OutboxWriterImpl({
          nextSfid: () => sharedSfidService.next(),
          pool: c.resolve(MYSQL_POOL_TOKEN) as Pool | null,
        }),
    },
    TurnLockService,
    {
      provide: TURN_LOCK_SERVICE_TOKEN,
      useExisting: TurnLockService,
    },
    {
      provide: EngineFactory,
      useFactory: (c: DiContainer) => {
        // EngineFactory 仍以 tachu.Engine 为编排核心；tool-use 子流程通过
        // TaskExecutor 回调业务 ToolService，复用工具 BC 的鉴权/安全/审计/MCP。
        const provider = c.resolve(AGENTIC_PROVIDER_TOKEN) as ConstructorParameters<typeof EngineFactory>[0];
        const observability = c.resolve(AGENTIC_OBSERVABILITY_TOKEN) as ConstructorParameters<typeof EngineFactory>[1];
        let descriptorRegistry: DescriptorRegistryService | undefined;
        try {
          descriptorRegistry = c.resolve(DescriptorRegistryService) as DescriptorRegistryService;
        } catch {
          descriptorRegistry = undefined;
        }
        // 不再在装配期 eager 解析 ToolService：EngineFactory 是本容器的 singleton，
        // 若在某些依赖尚不可解析的早期时机被首次创建，旧的静默 try-catch 会把
        // 异常吞成 undefined 并永久缓存，导致所有工具调用降级成 `[executed:tool]`
        // 桩输出。改为传入惰性 provider，ToolService 仅在真正执行工具（请求期、
        // 容器已完整装配）时解析。
        const toolServiceProvider = (): ToolService | undefined => c.resolve(ToolService) as ToolService;
        let skillRegistry: SkillRegistryService | undefined;
        try {
          skillRegistry = c.resolve(SkillRegistryService) as SkillRegistryService;
        } catch {
          skillRegistry = undefined;
        }
        let localFiles: LocalFileService | undefined;
        try {
          localFiles = c.resolve(LocalFileService) as LocalFileService;
        } catch {
          localFiles = undefined;
        }
        const memorySystem = c.resolve(AGENTIC_MEMORY_SYSTEM_TOKEN) as ConstructorParameters<typeof EngineFactory>[2];
        const turnContext = c.resolve(TURN_CONTEXT_HOLDER_TOKEN) as ConstructorParameters<typeof EngineFactory>[3];
        let projectionRelay: MemoryProjectionRelayService | undefined;
        try {
          projectionRelay = c.resolve(MEMORY_PROJECTION_RELAY_TOKEN) as MemoryProjectionRelayService;
        } catch {
          projectionRelay = undefined;
        }
        let llmProvider: LlmProviderPort | undefined;
        try {
          llmProvider = c.resolve(AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN) as LlmProviderPort;
        } catch {
          llmProvider = undefined;
        }
        // TenantDescriptorResolver / UserShelfRepository 都不是 DI provider（仅在 SessionService
        // factory 内联构造）——旧代码这里 `c.resolve(TenantDescriptorResolver)` 必然抛错、把
        // tenantResolver 静默吞成 undefined，导致运行时 @-pin 的租户技能解析与「我的技能」发现在
        // 生产里其实是死的。改为与 SessionService 一致：从同一 MySQL pool 直接构造，并挂上
        // descriptor.reload 失效订阅（与 SessionService 的解析器缓存语义对齐）。
        let tenantResolver: TenantDescriptorResolver | undefined;
        let userShelf: UserShelfRepositoryImpl | undefined;
        try {
          const pool = c.resolve(MYSQL_POOL_TOKEN) as Pool | null;
          if (pool) {
            tenantResolver = new TenantDescriptorResolver(new TenantDescriptorRepositoryImpl(pool, sharedSfidService));
            userShelf = new UserShelfRepositoryImpl(pool, sharedSfidService);
            const invalidationRedis = createSessionRedis();
            if (invalidationRedis) tenantResolver.attachInvalidationSubscriber(invalidationRedis);
          }
        } catch {
          tenantResolver = undefined;
          userShelf = undefined;
        }
        return new EngineFactory(
          provider,
          observability,
          memorySystem,
          turnContext,
          descriptorRegistry,
          undefined,
          skillRegistry,
          localFiles,
          projectionRelay,
          llmProvider,
          toolServiceProvider,
          tenantResolver,
          userShelf,
        );
      },
    },
    SnapshotService,
    {
      provide: SNAPSHOT_SERVICE_TOKEN,
      useExisting: SnapshotService,
    },
    {
      provide: SessionService,
      useFactory: (c: DiContainer) => {
        const pool = createEngineMysqlPool();
        const repo = new SessionRepositoryImpl(pool);
        const outbox = new OutboxWriterImpl({
          nextSfid: () => sharedSfidService.next(),
        });
        let descriptorLoader: DescriptorLoader | undefined;
        try {
          descriptorLoader = c.resolve(DescriptorLoader) as DescriptorLoader;
        } catch {
          descriptorLoader = undefined;
        }
        let skillRegistry: SkillRegistryService | undefined;
        try {
          skillRegistry = c.resolve(SkillRegistryService) as SkillRegistryService;
        } catch {
          skillRegistry = undefined;
        }
        let ruleRegistry: RuleRegistryService | undefined;
        try {
          ruleRegistry = c.resolve(RuleRegistryService) as RuleRegistryService;
        } catch {
          ruleRegistry = undefined;
        }
        let descriptorRegistry: DescriptorRegistryService | undefined;
        try {
          descriptorRegistry = c.resolve(DescriptorRegistryService) as DescriptorRegistryService;
        } catch {
          descriptorRegistry = undefined;
        }
        // 租户级 descriptor 运行时解析器（前缀路由 + 已发布 head + 条目缓存，ADR-0016 §5）。
        const tenantResolver = new TenantDescriptorResolver(new TenantDescriptorRepositoryImpl(pool, sharedSfidService));
        // T7 outbox `descriptor.reload` → PubSubDispatcher 已把 emit/dispatch 接好
        // （publish/remove 见 descriptor-management.service.ts）；这里补订阅端，让精确
        // 失效替代纯 30s TTL 兜底（迁移残留 L9）。无 redis 时静默保留 TTL-only 行为。
        const invalidationRedis = createSessionRedis();
        if (invalidationRedis) {
          tenantResolver.attachInvalidationSubscriber(invalidationRedis);
        }
        const runnableAgentResolver = new RunnableAgentResolver(
          new TenantDescriptorRepositoryImpl(pool, sharedSfidService),
          new DescriptorListingRepositoryImpl(pool),
          new UserShelfRepositoryImpl(pool, sharedSfidService),
        );
        return new SessionService(
          sharedSfidService,
          repo,
          pool,
          outbox,
          descriptorLoader,
          skillRegistry,
          ruleRegistry,
          tenantResolver,
          descriptorRegistry,
          runnableAgentResolver,
        );
      },
    },
    TurnService,
    SessionController,
    LocalFileController,
  ],
  controllers: [SessionController, LocalFileController],
  // Phase 4 (T13-G8/G10): export Redis client + MySQL pool tokens so cross-cutting
  // middleware modules (IdempotencyModule, RateLimitModule) and bootstrap-time
  // lifecycle/readiness registrations can `@Inject` / `container.resolve` them.
  //
  // Symbol aliases used by exported classes must be exported too, otherwise
  // cross-module / parent-container resolve fails with "Provider not found".
  exports: [REDIS_CLIENT_TOKEN, MYSQL_POOL_TOKEN, TURN_REPO_TOKEN, TURN_LOCK_SERVICE_TOKEN, SNAPSHOT_SERVICE_TOKEN],
})
export class SessionModule {}
