import type { LlmRemoteModelItem } from './metadata-inference.service';
import { ModelMetadataInferenceService } from './metadata-inference.service';
import type { InMemoryCatalogStore } from './in-memory-catalog.store';
import type { LlmConnectivityAdapter } from './connectivity/adapters';

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
    if (!adapter?.fetchModels || !tenantProvider.api_base_url || !tenantProvider.api_key) return [];
    return adapter.fetchModels(tenantProvider.api_base_url, tenantProvider.api_key, signal).then((rows) =>
      rows.map((row) => ({
        modelCode: row.modelCode,
        displayName: row.displayName,
        groupName: row.displayName,
      })),
    );
  }

  async syncRemoteModelsForTenantProvider(
    tenant: number,
    tenantProviderId: string,
    signal?: AbortSignal,
  ): Promise<number> {
    const provider = this.store.findTenantProviderById(tenant, tenantProviderId);
    if (!provider) return 0;
    const remote = await this.fetchRemoteModels(provider, signal);
    const inferred = await this.inference.inferRemoteModels(
      {
        typeCode: provider.type_code,
        providerCode: provider.provider_code,
        iconUrl: provider.icon_url,
        systemProviderId: provider.system_provider_id,
      },
      remote,
    );
    let upserted = 0;
    for (const candidate of inferred) {
      const existing = this.store.findTenantModelByCode(tenant, candidate.modelCode);
      if (existing) continue;
      this.store.insertTenantModel({
        id: `remote-${candidate.modelCode}`,
        tenant,
        tenant_provider_id: tenantProviderId,
        system_model_id: candidate.systemModelId,
        model_code: candidate.modelCode,
        display_name: candidate.displayName,
        group_name: candidate.groupName,
        icon_url: null,
        api_base_url: provider.api_base_url,
        endpoint_type: candidate.endpointType,
        model_types: candidate.modelTypes.join(','),
        is_free: candidate.isFree,
        enabled: false,
      });
      upserted += 1;
    }
    return upserted;
  }
}
