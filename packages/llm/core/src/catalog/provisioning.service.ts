import { type SystemLlmProviderEntity } from "./entities";
import { type InMemoryCatalogStore } from "./in-memory-catalog.store";
import { ModelMetadataInferenceService } from "./metadata-inference.service";

let nextId = 1;
function genId(): string {
  return `gen-${nextId++}`;
}

export class LlmCatalogProvisioningService {
  constructor(
    private readonly store: InMemoryCatalogStore,
    private readonly inference = new ModelMetadataInferenceService({
      listActiveModels: async () => [...this.store.systemModels.values()],
      listActiveProviders: async () =>
        [...this.store.systemProviders.values()].map((p) => ({
          id: p.id,
          provider_code: p.provider_code,
          type_code: p.type_code,
        })),
      listActiveRules: async () => this.store.listActiveMatchRules(),
    }),
  ) {}

  async syncTenantCatalog(tenant: number): Promise<void> {
    const enabledTypes = this.store.listEnabledSystemTypes();
    const typeCodes = enabledTypes.map((item) => item.code);
    const providers = this.store.listSystemProvidersByTypeCodes(typeCodes);
    for (const provider of providers) {
      const tenantProvider = await this.ensureTenantProvider(tenant, provider);
      await this.syncModelsForProvider(tenant, provider, tenantProvider.id);
    }
  }

  private async ensureTenantProvider(tenant: number, provider: SystemLlmProviderEntity): Promise<{ id: string }> {
    const existing = this.store.findTenantProviderBySystemId(tenant, provider.id);
    if (existing) {
      return existing;
    }
    const id = genId();
    this.store.insertTenantProvider({
      api_base_url: null,
      api_key: null,
      enabled: false,
      icon_url: provider.icon_url,
      id,
      is_custom: false,
      name: provider.name,
      provider_code: provider.provider_code,
      remark: provider.default_remark,
      system_provider_id: provider.id,
      tenant,
      type_code: provider.type_code,
    });
    return { id };
  }

  private async syncModelsForProvider(tenant: number, systemProvider: SystemLlmProviderEntity, tenantProviderId: string): Promise<void> {
    const existing = this.store.listTenantModelsByProvider(tenant, tenantProviderId);
    const existingSystemModelIds = new Set(
      existing.map((m) => m.system_model_id).filter((id): id is string => id !== null && id !== undefined),
    );
    const systemModels = this.store.listSystemModelsByProvider(systemProvider.id);
    for (const model of systemModels) {
      if (existingSystemModelIds.has(model.id)) {
        continue;
      }
      const inferred = (
        await this.inference.inferRemoteModels(
          {
            iconUrl: systemProvider.icon_url,
            providerCode: systemProvider.provider_code,
            systemProviderId: systemProvider.id,
            typeCode: systemProvider.type_code,
          },
          [{ displayName: model.display_name, groupName: model.group_name, modelCode: model.model_code }],
        )
      )[0];
      this.store.insertTenantModel({
        api_base_url: model.api_base_url,
        display_name: inferred?.displayName ?? model.display_name,
        enabled: false,
        endpoint_type: model.endpoint_type,
        group_name: inferred?.groupName ?? model.group_name,
        icon_url: model.icon_url,
        id: genId(),
        is_free: model.is_free,
        model_code: model.model_code,
        model_types: (inferred?.modelTypes ?? model.model_types.split(",")).join(","),
        system_model_id: model.id,
        tenant,
        tenant_provider_id: tenantProviderId,
      });
    }
  }
}
