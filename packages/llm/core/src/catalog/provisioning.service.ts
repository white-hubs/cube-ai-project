import type { SystemLlmProviderEntity } from './entities';
import { InMemoryCatalogStore } from './in-memory-catalog.store';
import { ModelMetadataInferenceService } from './metadata-inference.service';

let nextId = 1;
function genId(): string {
  return `gen-${nextId++}`;
}

export class LlmCatalogProvisioningService {
  constructor(
    private readonly store: InMemoryCatalogStore,
    private readonly inference = new ModelMetadataInferenceService({
      listActiveProviders: async () =>
        [...this.store.systemProviders.values()].map((p) => ({
          id: p.id,
          provider_code: p.provider_code,
          type_code: p.type_code,
        })),
      listActiveModels: async () => [...this.store.systemModels.values()],
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

  private async ensureTenantProvider(
    tenant: number,
    provider: SystemLlmProviderEntity,
  ): Promise<{ id: string }> {
    const existing = this.store.findTenantProviderBySystemId(tenant, provider.id);
    if (existing) return existing;
    const id = genId();
    this.store.insertTenantProvider({
      id,
      tenant,
      system_provider_id: provider.id,
      provider_code: provider.provider_code,
      type_code: provider.type_code,
      name: provider.name,
      icon_url: provider.icon_url,
      api_base_url: null,
      api_key: null,
      enabled: false,
      is_custom: false,
      remark: provider.default_remark,
    });
    return { id };
  }

  private async syncModelsForProvider(
    tenant: number,
    systemProvider: SystemLlmProviderEntity,
    tenantProviderId: string,
  ): Promise<void> {
    const existing = this.store.listTenantModelsByProvider(tenant, tenantProviderId);
    const existingSystemModelIds = new Set(
      existing.map((m) => m.system_model_id).filter((id): id is string => id != null),
    );
    const systemModels = this.store.listSystemModelsByProvider(systemProvider.id);
    for (const model of systemModels) {
      if (existingSystemModelIds.has(model.id)) continue;
      const inferred = (
        await this.inference.inferRemoteModels(
          {
            typeCode: systemProvider.type_code,
            providerCode: systemProvider.provider_code,
            iconUrl: systemProvider.icon_url,
            systemProviderId: systemProvider.id,
          },
          [{ modelCode: model.model_code, displayName: model.display_name, groupName: model.group_name }],
        )
      )[0];
      this.store.insertTenantModel({
        id: genId(),
        tenant,
        tenant_provider_id: tenantProviderId,
        system_model_id: model.id,
        model_code: model.model_code,
        display_name: inferred?.displayName ?? model.display_name,
        group_name: inferred?.groupName ?? model.group_name,
        icon_url: model.icon_url,
        api_base_url: model.api_base_url,
        endpoint_type: model.endpoint_type,
        model_types: (inferred?.modelTypes ?? model.model_types.split(',')).join(','),
        is_free: model.is_free,
        enabled: false,
      });
    }
  }
}
