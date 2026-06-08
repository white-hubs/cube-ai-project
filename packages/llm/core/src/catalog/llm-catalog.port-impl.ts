import type {
  LlmCatalogPort,
  LlmModelRuntimeConfig,
  LlmProviderSummary,
} from '@cube-ai/contracts';
import type { LlmEndpointType } from '@cube-ai/contracts';
import type { InMemoryCatalogStore } from './in-memory-catalog.store';
import { splitModelTypes } from './schema/llm-schema';

function asEndpointType(value: string | null | undefined): LlmEndpointType | null {
  if (!value) return null;
  return value as LlmEndpointType;
}

export class InMemoryLlmCatalogPort implements LlmCatalogPort {
  constructor(private readonly store: InMemoryCatalogStore) {}

  async listProviders(tenant: number, _signal: AbortSignal): Promise<LlmProviderSummary[]> {
    return this.store.listTenantProviders(tenant).map((row) => ({
      id: row.id,
      providerCode: row.provider_code,
      typeCode: row.type_code,
      apiBaseUrl: row.api_base_url ?? '',
      enabled: row.enabled,
    }));
  }

  async resolveModelRuntime(
    tenant: number,
    modelCode: string,
    _signal: AbortSignal,
  ): Promise<LlmModelRuntimeConfig | null> {
    const model = this.store.findTenantModelByCode(tenant, modelCode);
    if (!model) return null;

    const provider = this.store.findTenantProviderById(tenant, model.tenant_provider_id);
    if (!provider?.enabled) return null;

    const apiBaseUrl = model.api_base_url ?? provider.api_base_url;
    const apiKey = provider.api_key;
    const endpointType = asEndpointType(model.endpoint_type) ?? asEndpointType(provider.type_code);
    if (!apiBaseUrl || !apiKey || !endpointType) return null;

    return {
      modelCode: model.model_code,
      displayName: model.display_name,
      endpointType,
      apiBaseUrl,
      apiKey,
      modelTypes: splitModelTypes(model.model_types),
      isFree: model.is_free,
      providerCode: provider.provider_code,
    };
  }
}
