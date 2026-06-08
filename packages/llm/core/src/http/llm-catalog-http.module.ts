import { Module } from '@dangao/bun-server';
import { LlmProvidersController } from './llm-providers.controller';
import { LlmGatewayController } from './llm-gateway.controller';
import {
  createEnvFallbackTenantResolver,
  LLM_HTTP_TENANT_RESOLVER_TOKEN,
  LlmHttpTenantResolverService,
} from './request-tenant';

@Module({
  controllers: [LlmProvidersController, LlmGatewayController],
  providers: [
    {
      provide: LLM_HTTP_TENANT_RESOLVER_TOKEN,
      useFactory: () => createEnvFallbackTenantResolver(),
    },
    LlmHttpTenantResolverService,
  ],
})
export class LlmCatalogHttpModule {}
