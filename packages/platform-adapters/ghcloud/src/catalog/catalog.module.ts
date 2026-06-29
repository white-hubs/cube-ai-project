import { Module } from "@dangao/bun-server";

import { AGENTIC_PLATFORM_LLM_CATALOG_TOKEN } from "../tokens";
import { GhcloudLlmCatalogAdapter } from "./catalog.adapter";

function createAdapter(): GhcloudLlmCatalogAdapter {
  const baseUrl = process.env["AGENTIC_ENGINE_PLATFORM_API_BASE_URL"] ?? "http://localhost:3100";
  const serviceToken = process.env["AGENTIC_ENGINE_PLATFORM_SERVICE_TOKEN"] ?? "";
  return new GhcloudLlmCatalogAdapter({
    baseUrl,
    cacheMax: Number(process.env["AGENTIC_ENGINE_LLM_CATALOG_CACHE_MAX"] ?? "1024"),
    cacheTtlMs: Number(process.env["AGENTIC_ENGINE_LLM_CATALOG_CACHE_TTL_MS"] ?? "60000"),
    timeoutMs: Number(process.env["AGENTIC_ENGINE_PLATFORM_CATALOG_TIMEOUT_MS"] ?? "10000"),
    tokenProvider: async () => serviceToken,
  });
}

@Module({
  exports: [AGENTIC_PLATFORM_LLM_CATALOG_TOKEN],
  providers: [
    {
      provide: AGENTIC_PLATFORM_LLM_CATALOG_TOKEN,
      useValue: createAdapter(),
    },
  ],
})
export class GhcloudLlmCatalogModule {}
