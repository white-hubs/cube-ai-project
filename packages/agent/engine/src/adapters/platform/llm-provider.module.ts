import { Module, type Container } from "@dangao/bun-server";

import {
  AGENTIC_PLATFORM_LLM_CATALOG_TOKEN,
  AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN,
  AGENTIC_PLATFORM_IMAGE_GENERATION_TOKEN,
  AGENTIC_PLATFORM_RERANK_TOKEN,
  type LlmCatalogPort,
} from "@cube-ai/contracts";
import { CatalogDrivenProvider, NoopLlmProvider, CatalogImageProvider, CatalogRerankProvider } from "@cube-ai/llm-core";

// 默认走真实目录驱动 provider（与 ghcloud agentic-platform-llm-catalog 对齐）。
// 仅当显式设为 'noop' 时使用空实现；其余任意取值均激活 CatalogDrivenProvider。
const providerKind = process.env["AGENTIC_ENGINE_PROVIDER"] ?? "agentic-platform-llm-catalog";

@Module({
  providers: [
    {
      provide: AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN,
      useFactory: (c: Container) => {
        if (providerKind === "noop") {
          return new NoopLlmProvider();
        }
        const catalog = c.resolve(AGENTIC_PLATFORM_LLM_CATALOG_TOKEN) as LlmCatalogPort;
        return new CatalogDrivenProvider({ catalog });
      },
    },
    {
      provide: AGENTIC_PLATFORM_IMAGE_GENERATION_TOKEN,
      useFactory: (c: Container) => {
        const catalog = c.resolve(AGENTIC_PLATFORM_LLM_CATALOG_TOKEN) as LlmCatalogPort;
        return new CatalogImageProvider({ catalog });
      },
    },
    {
      provide: AGENTIC_PLATFORM_RERANK_TOKEN,
      useFactory: (c: Container) => {
        const catalog = c.resolve(AGENTIC_PLATFORM_LLM_CATALOG_TOKEN) as LlmCatalogPort;
        return new CatalogRerankProvider({ catalog });
      },
    },
  ],
  exports: [AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN, AGENTIC_PLATFORM_IMAGE_GENERATION_TOKEN, AGENTIC_PLATFORM_RERANK_TOKEN],
})
export class LlmProviderModule {}
