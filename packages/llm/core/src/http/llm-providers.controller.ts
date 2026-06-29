import { Controller, GET, Inject, Param } from "@dangao/bun-server";

import { AGENTIC_PLATFORM_LLM_CATALOG_TOKEN, type LlmCatalogPort, type LlmProviderSummary } from "@cube-ai/contracts/platform";

import { LlmHttpTenantResolverService } from "./request-tenant";

@Controller("/providers")
export class LlmProvidersController {
  public constructor(
    @Inject(AGENTIC_PLATFORM_LLM_CATALOG_TOKEN)
    private readonly catalog: LlmCatalogPort,
    @Inject(LlmHttpTenantResolverService)
    private readonly tenantResolver: LlmHttpTenantResolverService,
  ) {}

  @GET("/")
  public async list(): Promise<{ items: LlmProviderSummary[] }> {
    const tenant = this.tenantResolver.require();
    const items = await this.catalog.listProviders(tenant, new AbortController().signal);
    return { items };
  }

  @GET("/:id")
  public async getOne(@Param("id") id: string): Promise<LlmProviderSummary> {
    const tenant = this.tenantResolver.require();
    const items = await this.catalog.listProviders(tenant, new AbortController().signal);
    const found = items.find((p) => p.id === id);
    if (!found) {
      throw new Error(`provider not found: ${id}`);
    }
    return found;
  }
}
