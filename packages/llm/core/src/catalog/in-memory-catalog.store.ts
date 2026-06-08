import type {
  SystemLlmModelEntity,
  SystemLlmModelMatchRuleEntity,
  SystemLlmProviderEntity,
  SystemLlmProviderTypeEntity,
  TenantLlmModelEntity,
  TenantLlmProviderEntity,
} from './entities';

export interface InMemoryCatalogSeed {
  systemTypes?: SystemLlmProviderTypeEntity[];
  systemProviders?: SystemLlmProviderEntity[];
  systemModels?: SystemLlmModelEntity[];
  matchRules?: SystemLlmModelMatchRuleEntity[];
  tenantProviders?: TenantLlmProviderEntity[];
  tenantModels?: TenantLlmModelEntity[];
}

export class InMemoryCatalogStore {
  readonly systemTypes = new Map<string, SystemLlmProviderTypeEntity>();
  readonly systemProviders = new Map<string, SystemLlmProviderEntity>();
  readonly systemModels = new Map<string, SystemLlmModelEntity>();
  readonly matchRules = new Map<string, SystemLlmModelMatchRuleEntity>();
  readonly tenantProviders = new Map<string, TenantLlmProviderEntity>();
  readonly tenantModels = new Map<string, TenantLlmModelEntity>();

  constructor(seed?: InMemoryCatalogSeed) {
    for (const row of seed?.systemTypes ?? []) this.systemTypes.set(row.id, row);
    for (const row of seed?.systemProviders ?? []) this.systemProviders.set(row.id, row);
    for (const row of seed?.systemModels ?? []) this.systemModels.set(row.id, row);
    for (const row of seed?.matchRules ?? []) this.matchRules.set(row.id, row);
    for (const row of seed?.tenantProviders ?? []) this.tenantProviders.set(row.id, row);
    for (const row of seed?.tenantModels ?? []) this.tenantModels.set(row.id, row);
  }

  listEnabledSystemTypes(): SystemLlmProviderTypeEntity[] {
    return [...this.systemTypes.values()].filter((item) => item.enabled);
  }

  listSystemProvidersByTypeCodes(typeCodes: string[]): SystemLlmProviderEntity[] {
    const set = new Set(typeCodes);
    return [...this.systemProviders.values()].filter(
      (item) => item.enabled && set.has(item.type_code),
    );
  }

  listSystemModelsByProvider(systemProviderId: string): SystemLlmModelEntity[] {
    return [...this.systemModels.values()].filter(
      (item) => item.system_provider_id === systemProviderId,
    );
  }

  listActiveMatchRules(): SystemLlmModelMatchRuleEntity[] {
    return [...this.matchRules.values()];
  }

  listTenantProviders(tenant: number): TenantLlmProviderEntity[] {
    return [...this.tenantProviders.values()].filter((item) => item.tenant === tenant);
  }

  findTenantProviderBySystemId(tenant: number, systemProviderId: string): TenantLlmProviderEntity | null {
    return (
      [...this.tenantProviders.values()].find(
        (item) => item.tenant === tenant && item.system_provider_id === systemProviderId,
      ) ?? null
    );
  }

  findTenantProviderById(tenant: number, id: string): TenantLlmProviderEntity | null {
    const row = this.tenantProviders.get(id);
    return row?.tenant === tenant ? row : null;
  }

  listTenantModelsByProvider(tenant: number, tenantProviderId: string): TenantLlmModelEntity[] {
    return [...this.tenantModels.values()].filter(
      (item) => item.tenant === tenant && item.tenant_provider_id === tenantProviderId,
    );
  }

  findTenantModelByCode(tenant: number, modelCode: string): TenantLlmModelEntity | null {
    return (
      [...this.tenantModels.values()].find(
        (item) => item.tenant === tenant && item.model_code === modelCode && item.enabled,
      ) ?? null
    );
  }

  insertTenantProvider(row: TenantLlmProviderEntity): void {
    this.tenantProviders.set(row.id, row);
  }

  insertTenantModel(row: TenantLlmModelEntity): void {
    this.tenantModels.set(row.id, row);
  }
}

export function createDefaultCatalogSeed(tenant = 1001): InMemoryCatalogSeed {
  return {
    systemTypes: [
      { id: 'type-openai', code: 'openai', name: 'OpenAI', enabled: true },
      { id: 'type-volc', code: 'volcengine_ark', name: 'Volcengine', enabled: true },
    ],
    systemProviders: [
      {
        id: 'sys-prov-openai',
        provider_code: 'openai-official',
        type_code: 'openai',
        name: 'OpenAI Official',
        icon_url: null,
        default_remark: null,
        enabled: true,
      },
      {
        id: 'sys-prov-volc',
        provider_code: 'volc-doubao',
        type_code: 'volcengine_ark',
        name: 'Doubao',
        icon_url: null,
        default_remark: null,
        enabled: true,
      },
    ],
    systemModels: [
      {
        id: 'sys-model-gpt4o',
        system_provider_id: 'sys-prov-openai',
        model_code: 'gpt-4o',
        display_name: 'GPT-4o',
        group_name: 'GPT-4o',
        icon_url: null,
        api_base_url: 'https://api.openai.com/v1',
        endpoint_type: 'openai',
        model_types: 'reasoning,tool',
        is_free: false,
        supports_test: true,
      },
      {
        id: 'sys-model-doubao-embed',
        system_provider_id: 'sys-prov-volc',
        model_code: 'doubao-embedding-vision-251215',
        display_name: 'Doubao Embedding Vision',
        group_name: 'Embedding',
        icon_url: null,
        api_base_url: 'https://ark.cn-beijing.volces.com/api/v3',
        endpoint_type: 'volcengine_ark',
        model_types: 'embedding,multimodal',
        is_free: false,
        supports_test: true,
      },
    ],
    tenantProviders: [
      {
        id: 'tenant-prov-openai',
        tenant,
        system_provider_id: 'sys-prov-openai',
        provider_code: 'openai-official',
        type_code: 'openai',
        name: 'OpenAI Official',
        icon_url: null,
        api_base_url: 'https://api.openai.com/v1',
        api_key: 'sk-tenant-openai',
        enabled: true,
        is_custom: false,
        remark: null,
      },
      {
        id: 'tenant-prov-volc',
        tenant,
        system_provider_id: 'sys-prov-volc',
        provider_code: 'volc-doubao',
        type_code: 'volcengine_ark',
        name: 'Doubao',
        icon_url: null,
        api_base_url: 'https://ark.cn-beijing.volces.com/api/v3',
        api_key: 'sk-tenant-volc',
        enabled: true,
        is_custom: false,
        remark: null,
      },
    ],
    tenantModels: [
      {
        id: 'tenant-model-gpt4o',
        tenant,
        tenant_provider_id: 'tenant-prov-openai',
        system_model_id: 'sys-model-gpt4o',
        model_code: 'gpt-4o',
        display_name: 'GPT-4o',
        group_name: 'GPT-4o',
        icon_url: null,
        api_base_url: 'https://api.openai.com/v1',
        endpoint_type: 'openai',
        model_types: 'reasoning,tool',
        is_free: false,
        enabled: true,
      },
      {
        id: 'tenant-model-doubao-embed',
        tenant,
        tenant_provider_id: 'tenant-prov-volc',
        system_model_id: 'sys-model-doubao-embed',
        model_code: 'doubao-embedding-vision-251215',
        display_name: 'Doubao Embedding Vision',
        group_name: 'Embedding',
        icon_url: null,
        api_base_url: 'https://ark.cn-beijing.volces.com/api/v3',
        endpoint_type: 'volcengine_ark',
        model_types: 'embedding,multimodal',
        is_free: false,
        enabled: true,
      },
    ],
  };
}
