import { Injectable, Module, type Container, type OnModuleInit } from '@dangao/bun-server'
import { loadAppConfig, APP_CONFIG_TOKEN } from '@cube-ai/server-base'
import type { LlmProviderPort } from '@cube-ai/contracts'
import { AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN } from '@cube-ai/contracts/platform'
import { NoopLlmProvider } from '@cube-ai/llm-core'
import { ComponentsController } from './components/components.controller'
import { ComponentCatalogService } from './components/component-catalog.service'
import { ComponentSchemaService } from './components/component-schema.service'
import { CustomComponentTemplatesController } from './custom-component-templates/custom-component-templates.controller'
import { CustomComponentTemplatesService } from './custom-component-templates/custom-component-templates.service'
import { FlowsController } from './flows/flows.controller'
import { FlowMonitorController } from './flows/flow-monitor.controller'
import { FlowsService } from './flows/flows.service'
import { FlowCrudService } from './flows/flow-crud.service'
import { FlowLangflowSyncService } from './flows/flow-langflow-sync.service'
import { FlowExecutionService } from './flows/flow-execution.service'
import { FlowPlaygroundService } from './flows/flow-playground.service'
import { FlowFilesController } from './flows/flow-files.controller'
import { FlowFilesService } from './flows/flow-files.service'
import { McpToolsController } from './mcp/mcp-tools.controller'
import { RunController } from './run/run.controller'
import { WebhookController } from './webhook/webhook.controller'
import { ExecutionMetricsController } from './observability/execution-metrics.controller'
import { FlowRepository as SqliteFlowRepository } from './db/sqlite'
import { FLOW_REPOSITORY_TOKEN, type FlowRepository } from './db/repository-contracts'
import { initSharedRepositories, peekSharedRepositories } from './db/shared-repositories'

const appConfig = await loadAppConfig()

@Injectable()
class FlowRepositoriesBootstrap implements OnModuleInit {
  public async onModuleInit(): Promise<void> {
    await initSharedRepositories(appConfig)
  }
}

function requireSharedRepositories() {
  const repos = peekSharedRepositories()
  if (!repos) {
    throw new Error('Flow repositories are not initialized yet')
  }
  return repos
}

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

const flowRepoProxy = createRepositoryProxy<FlowRepository>(() => requireSharedRepositories().flowRepo)

function resolveLlmProvider(c: Container): LlmProviderPort {
  try {
    return c.resolve(AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN) as LlmProviderPort
  } catch {
    return new NoopLlmProvider()
  }
}

/** 流程域：Langflow、组件目录、flows CRUD、playground、执行。 */
@Module({
  controllers: [
    FlowsController,
    FlowMonitorController,
    RunController,
    WebhookController,
    ExecutionMetricsController,
    ComponentsController,
    McpToolsController,
    FlowFilesController,
    CustomComponentTemplatesController,
  ],
  providers: [
    { provide: APP_CONFIG_TOKEN, useValue: appConfig },
    {
      provide: FLOW_REPOSITORY_TOKEN,
      useValue: flowRepoProxy,
    },
    {
      provide: SqliteFlowRepository,
      useValue: flowRepoProxy as unknown as SqliteFlowRepository,
    },
    FlowRepositoriesBootstrap,
    FlowCrudService,
    FlowLangflowSyncService,
    {
      provide: FlowExecutionService,
      useFactory: (c: Container) =>
        new FlowExecutionService(
          c.resolve(FlowCrudService),
          c.resolve(FlowLangflowSyncService),
          resolveLlmProvider(c),
        ),
    },
    {
      provide: FlowPlaygroundService,
      useFactory: (c: Container) =>
        new FlowPlaygroundService(
          c.resolve(FlowCrudService),
          c.resolve(FlowLangflowSyncService),
          resolveLlmProvider(c),
        ),
    },
    FlowFilesService,
    FlowsService,
    ComponentCatalogService,
    ComponentSchemaService,
    CustomComponentTemplatesService,
  ],
  exports: [
    APP_CONFIG_TOKEN,
    FlowsService,
    FlowFilesService,
    FlowCrudService,
    FlowLangflowSyncService,
    FlowExecutionService,
    CustomComponentTemplatesService,
    FLOW_REPOSITORY_TOKEN,
    SqliteFlowRepository,
  ],
})
export class FlowModule {}
