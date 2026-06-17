import { Global, Module, type Container } from '@dangao/bun-server';
import { LlmCatalogModule } from '@cube-ai/agent-engine/adapters/platform';
import { DescriptorManagementHttpModule } from '@cube-ai/agent-engine/descriptor/http';
import { LlmCatalogHttpModule } from '@cube-ai/llm-core/http';
import { LlmCatalogAdminHttpModule } from '@cube-ai/llm-core/http/admin';
import {
  createEnvFallbackTenantResolver,
  LLM_HTTP_TENANT_RESOLVER_TOKEN,
  parseTenantId,
} from '@cube-ai/llm-core/http/tenant';
import { currentTenantId } from '@cube-ai/tenant-context';
import { FlowStudioHttpModule } from '@cube-ai/flow-studio/http';
import { TenantContextService } from '../../../../packages/agent/engine/src/infra/tenant-guard/tenant-context.service';
import { AiCenterKbHttpModule } from './ai-center-kb-http.module';

@Global()
@Module({
  imports: [LlmCatalogModule, LlmCatalogHttpModule, LlmCatalogAdminHttpModule, DescriptorManagementHttpModule, AiCenterKbHttpModule, FlowStudioHttpModule],
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
        // ghcloud execution-auth injects tenant via tenantContextAls (tenant header);
        // agent OAuth2 subject uses TenantContextService — prefer ALS, then subject scope.
        return createEnvFallbackTenantResolver(() => {
          const fromAls = parseTenantId(currentTenantId());
          if (fromAls !== undefined) return fromAls;
          return tenantCtx?.current();
        });
      },
    },
  ],
  exports: [LLM_HTTP_TENANT_RESOLVER_TOKEN],
})
export class AiCenterDomainHttpModule {}
