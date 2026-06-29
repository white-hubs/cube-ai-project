import { type Container, Module } from "@dangao/bun-server";

import { LlmGatewayController } from "./llm-gateway.controller";
import { LlmProvidersController } from "./llm-providers.controller";
import { LLM_HTTP_TENANT_RESOLVER_TOKEN, type LlmHttpTenantResolver, LlmHttpTenantResolverService } from "./request-tenant";

@Module({
  controllers: [LlmProvidersController, LlmGatewayController],
  providers: [
    // LLM_HTTP_TENANT_RESOLVER_TOKEN 由宿主（AiCenterDomainHttpModule @Global）提供。
    // 勿在此注册 env fallback（tenant 0）——会遮蔽宿主注入的 tenantContextAls 解析。
    // 显式工厂装配：直接用容器解析出的 resolver 构造服务，避免依赖 by-type
    // 解析 @Injectable 上 @Inject(symbol) 参数属性——后者在完整装配图里会
    // 退化成按类型解析、注入 undefined，导致 GET /llm/providers 抛
    // `this.resolve is not a function`。与 LlmCatalogAdminHttpModule 的
    // 命令式 c.resolve(...) 装配方式保持一致。
    {
      provide: LlmHttpTenantResolverService,
      useFactory: (c: Container) => new LlmHttpTenantResolverService(c.resolve(LLM_HTTP_TENANT_RESOLVER_TOKEN) as LlmHttpTenantResolver),
    },
  ],
})
export class LlmCatalogHttpModule {}
