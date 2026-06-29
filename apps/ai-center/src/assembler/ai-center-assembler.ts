import { Application, type ApplicationOptions, Module, type ModuleClass } from "@dangao/bun-server";

import { TachuExecutionBackendModule, TachuObservabilityModule, TachuProviderModule } from "@cube-ai/agent-engine/adapters";
import { KbPlatformModule, LlmCatalogModule, LlmProviderModule } from "@cube-ai/agent-engine/adapters/platform";
import { NacosExtModule } from "@cube-ai/bun-server-ext-nacos";
import { OutboxExtModule } from "@cube-ai/bun-server-ext-outbox";
import { SseExtModule } from "@cube-ai/bun-server-ext-sse";
import {
  AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN,
  AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN,
  AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN,
} from "@cube-ai/contracts/platform";
import { FlowModule, FlowPlatformPortsModule } from "@cube-ai/flow-core";
import { FlowStudioHttpModule } from "@cube-ai/flow-studio/http";

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
} from "../../../../packages/agent/engine/src/bc";
import { TachuRuntimeModule } from "../../../../packages/agent/engine/src/bc/tachu/tachu-runtime.module";
import { AuditModule } from "../../../../packages/agent/engine/src/infra/audit/audit.module";
import { ErrorsModule } from "../../../../packages/agent/engine/src/infra/errors/errors.module";
import { IdempotencyModule } from "../../../../packages/agent/engine/src/infra/idempotency/idempotency.module";
import { InfraModule } from "../../../../packages/agent/engine/src/infra/infra.module";
import { LifecycleModule } from "../../../../packages/agent/engine/src/infra/lifecycle/lifecycle.module";
import { MysqlModule } from "../../../../packages/agent/engine/src/infra/mysql/mysql.module";
import { ObservabilityModule } from "../../../../packages/agent/engine/src/infra/observability/observability.module";
import { RateLimitModule } from "../../../../packages/agent/engine/src/infra/rate-limit/rate-limit.module";
import { SecretsModule } from "../../../../packages/agent/engine/src/infra/secrets/secrets.module";
import { SfidModule } from "../../../../packages/agent/engine/src/infra/sfid/sfid.module";
import { TenantGuardModule } from "../../../../packages/agent/engine/src/infra/tenant-guard/tenant-guard.module";
import { AiCenterNacosRegistrationModule } from "../nacos/nacos-registration.wiring";
import { AiCenterDomainHttpModule } from "../routes/ai-center-domain-http.module";
import { applyDomainPrefixMounts } from "./domain-prefix-mounts";

@Module({
  exports: [AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN, AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN, AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN],
  imports: [FlowPlatformPortsModule, KbPlatformModule],
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
      FlowStudioHttpModule,
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
    for (const m of modules) {
      this.app.registerModule(m);
    }
    return this.app;
  }
}
