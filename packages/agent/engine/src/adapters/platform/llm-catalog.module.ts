import { Module } from '@dangao/bun-server';
import { AGENTIC_PLATFORM_LLM_CATALOG_TOKEN } from '@cube-ai/contracts/platform';
import { InMemoryCatalogStore, InMemoryLlmCatalogPort } from '@cube-ai/llm-core';

@Module({
  providers: [
    {
      provide: AGENTIC_PLATFORM_LLM_CATALOG_TOKEN,
      useFactory: () => new InMemoryLlmCatalogPort(new InMemoryCatalogStore()),
    },
  ],
  exports: [AGENTIC_PLATFORM_LLM_CATALOG_TOKEN],
})
export class LlmCatalogModule {}
