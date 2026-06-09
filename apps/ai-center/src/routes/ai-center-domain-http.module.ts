import { Global, Module, type Container } from '@dangao/bun-server';
import { LlmCatalogModule } from '@cube-ai/agent-engine/adapters/platform';
import { LlmCatalogHttpModule } from '@cube-ai/llm-core/http';
import { LlmCatalogAdminHttpModule } from '@cube-ai/llm-core/http/admin';
import {
  createEnvFallbackTenantResolver,
  LLM_HTTP_TENANT_RESOLVER_TOKEN,
} from '@cube-ai/llm-core/http/tenant';
import { TenantContextService } from '../../../../packages/agent/engine/src/infra/tenant-guard/tenant-context.service';
import { AiCenterKbHttpModule } from './ai-center-kb-http.module';

@Global()
@Module({
  imports: [LlmCatalogModule, LlmCatalogHttpModule, LlmCatalogAdminHttpModule, AiCenterKbHttpModule],
  providers: [
    {
      provide: LLM_HTTP_TENANT_RESOLVER_TOKEN,
      useFactory: (c: Container) => {
        let tenantCtx: TenantContextService | undefined;
        try {
          tenantCtx = c.resolve(TenantContextService) as TenantContextService;
        } catch {
          tenantCtx = undefined;
        }
        return createEnvFallbackTenantResolver(() => tenantCtx?.current());
      },
    },
  ],
})
export class AiCenterDomainHttpModule {}
