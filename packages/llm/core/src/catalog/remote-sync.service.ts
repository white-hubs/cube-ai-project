import { type LlmConnectivityAdapter } from "./connectivity/adapters";
import { type InMemoryCatalogStore } from "./in-memory-catalog.store";
import { type LlmRemoteModelItem, type ModelMetadataInferenceService } from "./metadata-inference.service";

export class LlmRemoteSyncService {
  constructor(
    private readonly store: InMemoryCatalogStore,
    private readonly inference: ModelMetadataInferenceService,
    private readonly adapters: LlmConnectivityAdapter[],
  ) {}

  async fetchRemoteModels(
    tenantProvider: { id: string; type_code: string; provider_code: string; api_base_url: string | null; api_key: string | null },
    signal?: AbortSignal,
  ): Promise<LlmRemoteModelItem[]> {
    const adapter = this.adapters.find((item) => item.endpointType === tenantProvider.type_code);
    if (!adapter?.fetchModels || !tenantProvider.api_base_url || !tenantProvider.api_key) {
      return [];
    }
    return adapter.fetchModels(tenantProvider.api_base_url, tenantProvider.api_key, signal).then((rows) =>
      rows.map((row) => ({
        displayName: row.displayName,
        groupName: row.displayName,
        modelCode: row.modelCode,
      })),
    );
  }

  async syncRemoteModelsForTenantProvider(tenant: number, tenantProviderId: string, signal?: AbortSignal): Promise<number> {
    const provider = this.store.findTenantProviderById(tenant, tenantProviderId);
    if (!provider) {
      return 0;
    }
    const remote = await this.fetchRemoteModels(provider, signal);
    const inferred = await this.inference.inferRemoteModels(
      {
        iconUrl: provider.icon_url,
        providerCode: provider.provider_code,
        systemProviderId: provider.system_provider_id,
        typeCode: provider.type_code,
      },
      remote,
    );
    let upserted = 0;
    for (const candidate of inferred) {
      const existing = this.store.findTenantModelByCode(tenant, candidate.modelCode);
      if (existing) {
        continue;
      }
      this.store.insertTenantModel({
        api_base_url: provider.api_base_url,
        display_name: candidate.displayName,
        enabled: false,
        endpoint_type: candidate.endpointType,
        group_name: candidate.groupName,
        icon_url: null,
        id: `remote-${candidate.modelCode}`,
        is_free: candidate.isFree,
        model_code: candidate.modelCode,
        model_types: candidate.modelTypes.join(","),
        system_model_id: candidate.systemModelId,
        tenant,
        tenant_provider_id: tenantProviderId,
      });
      upserted += 1;
    }
    return upserted;
  }
}
