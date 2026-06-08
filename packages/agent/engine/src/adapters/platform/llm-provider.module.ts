import { Module, type Container } from '@dangao/bun-server';
import {
  AGENTIC_PLATFORM_LLM_CATALOG_TOKEN,
  AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN,
  type LlmCatalogPort,
} from '@cube-ai/contracts';
import { CatalogDrivenProvider, NoopLlmProvider } from '@cube-ai/llm-core';

const providerKind = process.env['AGENTIC_ENGINE_PROVIDER'] ?? 'llm-core';

@Module({
  providers: [
    {
      provide: AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN,
      useFactory: (c: Container) => {
        if (providerKind === 'noop') {
          return new NoopLlmProvider();
        }
        const catalog = c.resolve(AGENTIC_PLATFORM_LLM_CATALOG_TOKEN) as LlmCatalogPort;
        return new CatalogDrivenProvider({ catalog });
      },
    },
  ],
  exports: [AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN],
})
export class LlmProviderModule {}
