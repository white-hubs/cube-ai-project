import {
  Application,
  type ApplicationOptions,
  type ModuleClass,
  Module,
} from '@dangao/bun-server';
import {
  TachuProviderModule,
  TachuObservabilityModule,
  TachuExecutionBackendModule,
} from '@cube-ai/agent-engine/adapters';
import {
  LlmCatalogModule,
  LlmProviderModule,
  KbPlatformModule,
} from '@cube-ai/agent-engine/adapters/platform';
import { TachuRuntimeModule } from '../../../../packages/agent/engine/src/bc/tachu/tachu-runtime.module';
import { SseExtModule } from '@cube-ai/bun-server-ext-sse';
import { OutboxExtModule } from '@cube-ai/bun-server-ext-outbox';
import { NacosExtModule } from '@cube-ai/bun-server-ext-nacos';
import { InfraModule } from '../../../../packages/agent/engine/src/infra/infra.module';
import { MysqlModule } from '../../../../packages/agent/engine/src/infra/mysql/mysql.module';
import { SfidModule } from '../../../../packages/agent/engine/src/infra/sfid/sfid.module';
import { TenantGuardModule } from '../../../../packages/agent/engine/src/infra/tenant-guard/tenant-guard.module';
import { ErrorsModule } from '../../../../packages/agent/engine/src/infra/errors/errors.module';
import { SecretsModule } from '../../../../packages/agent/engine/src/infra/secrets/secrets.module';
import { AuditModule } from '../../../../packages/agent/engine/src/infra/audit/audit.module';
import { ObservabilityModule } from '../../../../packages/agent/engine/src/infra/observability/observability.module';
import { LifecycleModule } from '../../../../packages/agent/engine/src/infra/lifecycle/lifecycle.module';
import { IdempotencyModule } from '../../../../packages/agent/engine/src/infra/idempotency/idempotency.module';
import { RateLimitModule } from '../../../../packages/agent/engine/src/infra/rate-limit/rate-limit.module';
import {
  AuthModule,
  AuthzModule,
  DescriptorModule,
  EngineSafetyModule,
  JobsModule,
  PlatformModule,
  SessionModule,
  ToolsModule,
  UsageModule,
} from '../../../../packages/agent/engine/src/bc';
import { FlowModule, FlowPlatformPortsModule } from '@cube-ai/flow-core';
import { AiCenterNacosRegistrationModule } from '../nacos/nacos-registration.wiring';
import { AiCenterDomainHttpModule } from '../routes/ai-center-domain-http.module';
import { applyDomainPrefixMounts } from './domain-prefix-mounts';
import { AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN } from '@cube-ai/contracts/platform';
import {
  AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN,
  AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN,
} from '@cube-ai/contracts/platform';

@Module({
  imports: [FlowPlatformPortsModule, KbPlatformModule],
  exports: [
    AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN,
    AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN,
    AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN,
  ],
})
export class AiCenterPlatformPortsModule {}

export class AiCenterAssembler {
  private readonly app: Application;

  constructor(options: ApplicationOptions = {}) {
    this.app = new Application({ enableSignalHandlers: false, ...options });
  }

  assemble(): Application {
    applyDomainPrefixMounts();

    this.app.registerModule(SfidModule);
    this.app.registerModule(TenantGuardModule);
    this.app.registerModule(ErrorsModule);

    const modules: ModuleClass[] = [
      NacosExtModule,
      AiCenterNacosRegistrationModule,
      SecretsModule,
      InfraModule,
      MysqlModule,
      ObservabilityModule,
      SseExtModule,
      LifecycleModule,
      OutboxExtModule,
      AuditModule,
      PlatformModule,
      TachuObservabilityModule,
      LlmCatalogModule,
      LlmProviderModule,
      TachuProviderModule,
      TachuRuntimeModule,
      EngineSafetyModule,
      TachuExecutionBackendModule,
      AiCenterPlatformPortsModule,
      FlowModule,
      AiCenterDomainHttpModule,
      DescriptorModule,
      AuthModule,
      AuthzModule,
      UsageModule,
      JobsModule,
      ToolsModule,
      SessionModule,
      IdempotencyModule,
      RateLimitModule,
    ];
    for (const m of modules) this.app.registerModule(m);
    return this.app;
  }
}
