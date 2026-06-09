import { Injectable, Module, type Container, type OnModuleInit } from '@dangao/bun-server'
import { loadAppConfig } from '@cube-ai/server-base'
import {
  CustomComponentTemplatesService,
  FlowCrudService,
  FlowFilesService,
  FlowLangflowSyncService,
  FlowsService,
} from '@cube-ai/flow-core'
import {
  TenantLlmModelRepository,
  TenantLlmProviderRepository,
  type CatalogMysqlPool,
} from '@cube-ai/llm-core'
import { CATALOG_MYSQL_POOL_TOKEN } from '@cube-ai/llm-core/http/admin'
import { LLM_HTTP_TENANT_RESOLVER_TOKEN, type LlmHttpTenantResolver } from '@cube-ai/llm-core/http/tenant'
import { FlowComponentService } from '../compile/flow-component.service'
import {
  FlowStudioComponentRepository,
  FlowStudioFlowRepository,
  FlowStudioReleaseRepository,
  FlowStudioResourceRefRepository,
  initStudioRepositories,
  peekStudioRepositories,
  type StudioRepositories,
} from '../db'
import { FlowEngineBridge } from '../engine/flow-engine.bridge'
import { FlowService } from '../flow.service'
import { FlowStudioController } from './flow-studio.controller'

const appConfig = await loadAppConfig()

@Injectable()
class StudioRepositoriesBootstrap implements OnModuleInit {
  public async onModuleInit(): Promise<void> {
    await initStudioRepositories(appConfig)
  }
}

function requireStudioRepositories(): StudioRepositories {
  const repos = peekStudioRepositories()
  if (!repos) {
    throw new Error('Flow studio repositories are not initialized yet')
  }
  return repos
}

/** Lazily proxies method calls to the (async-initialized) singleton repository instance. */
function createRepositoryProxy<T extends object>(getter: () => T): T {
  return new Proxy(
    {},
    {
      get(_target, propKey) {
        return (...args: unknown[]) => {
          const repo = getter()
          const candidate = Reflect.get(repo as object, propKey)
          if (typeof candidate !== 'function') return candidate
          return Reflect.apply(candidate as (...fnArgs: unknown[]) => unknown, repo, args)
        }
      },
    },
  ) as T
}

const flowRepoProxy = createRepositoryProxy<FlowStudioFlowRepository>(() => requireStudioRepositories().flowRepo)
const resourceRefRepoProxy = createRepositoryProxy<FlowStudioResourceRefRepository>(
  () => requireStudioRepositories().resourceRefRepo,
)
const componentRepoProxy = createRepositoryProxy<FlowStudioComponentRepository>(
  () => requireStudioRepositories().componentRepo,
)
const releaseRepoProxy = createRepositoryProxy<FlowStudioReleaseRepository>(() => requireStudioRepositories().releaseRepo)

/**
 * flow-studio HTTP 域模块（编辑器投影层）。
 *
 * 换源装配（ADR-0014 D1）：
 * - flow_studio_* 仓储：MySQL（agentic_engine 同库），经异步单例 + 代理懒解析。
 * - 模型实体：复用 llm-core `TenantLlm*Repository`（同 `CATALOG_MYSQL_POOL_TOKEN` 池 + 同租户 resolver）。
 * - 引擎：`FlowEngineBridge` 进程内委派已注册的 flow-core 服务（FlowModule 导出）。
 *
 * 依赖前置（由组合根保证已注册）：`FlowModule`（flow-core 服务）、engine MySQL 池
 * （`CATALOG_MYSQL_POOL_TOKEN`）、`LLM_HTTP_TENANT_RESOLVER_TOKEN`（AiCenterDomainHttpModule 提供）。
 */
@Module({
  controllers: [FlowStudioController],
  providers: [
    StudioRepositoriesBootstrap,
    { provide: FlowStudioFlowRepository, useValue: flowRepoProxy },
    { provide: FlowStudioResourceRefRepository, useValue: resourceRefRepoProxy },
    { provide: FlowStudioComponentRepository, useValue: componentRepoProxy },
    { provide: FlowStudioReleaseRepository, useValue: releaseRepoProxy },
    {
      provide: FlowComponentService,
      useFactory: (c: Container) => new FlowComponentService(c.resolve(FlowStudioComponentRepository) as FlowStudioComponentRepository),
    },
    {
      provide: FlowEngineBridge,
      useFactory: (c: Container) =>
        new FlowEngineBridge(
          c.resolve(FlowsService) as FlowsService,
          c.resolve(FlowCrudService) as FlowCrudService,
          c.resolve(FlowLangflowSyncService) as FlowLangflowSyncService,
          c.resolve(FlowFilesService) as FlowFilesService,
          c.resolve(CustomComponentTemplatesService) as CustomComponentTemplatesService,
          appConfig.selfBaseUrl ?? '',
          appConfig.builtinSystemApiKey,
        ),
    },
    {
      provide: FlowService,
      useFactory: (c: Container) => {
        const pool = c.resolve(CATALOG_MYSQL_POOL_TOKEN) as CatalogMysqlPool
        const resolveTenant = c.resolve(LLM_HTTP_TENANT_RESOLVER_TOKEN) as LlmHttpTenantResolver
        const getTenant = (): number => resolveTenant()
        return new FlowService(
          c.resolve(FlowStudioFlowRepository) as FlowStudioFlowRepository,
          c.resolve(FlowStudioResourceRefRepository) as FlowStudioResourceRefRepository,
          c.resolve(FlowStudioReleaseRepository) as FlowStudioReleaseRepository,
          c.resolve(FlowComponentService) as FlowComponentService,
          new TenantLlmModelRepository(pool, getTenant),
          new TenantLlmProviderRepository(pool, getTenant),
          c.resolve(FlowEngineBridge) as FlowEngineBridge,
        )
      },
    },
  ],
  exports: [FlowService],
})
export class FlowStudioHttpModule {}
