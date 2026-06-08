import { describe, expect, it } from 'bun:test';
import { createDefaultCatalogSeed, InMemoryCatalogStore } from './in-memory-catalog.store';
import { LlmCatalogProvisioningService } from './provisioning.service';

describe('LlmCatalogProvisioningService', () => {
  it('syncTenantCatalog copies system models as disabled tenant copies without api_key', async () => {
    const tenant = 2002;
    const store = new InMemoryCatalogStore({
      systemTypes: [{ id: 't1', code: 'openai', name: 'OpenAI', enabled: true }],
      systemProviders: [
        {
          id: 'sp1',
          provider_code: 'openai-official',
          type_code: 'openai',
          name: 'OpenAI',
          icon_url: null,
          default_remark: null,
          enabled: true,
        },
      ],
      systemModels: [
        {
          id: 'sm1',
          system_provider_id: 'sp1',
          model_code: 'gpt-4o-mini',
          display_name: 'GPT-4o Mini',
          group_name: 'GPT',
          icon_url: null,
          api_base_url: 'https://api.openai.com/v1',
          endpoint_type: 'openai',
          model_types: 'chat',
          is_free: false,
          supports_test: true,
        },
      ],
    });
    const provisioning = new LlmCatalogProvisioningService(store);
    await provisioning.syncTenantCatalog(tenant);

    const providers = store.listTenantProviders(tenant);
    expect(providers.length).toBe(1);
    expect(providers[0]?.api_key).toBeNull();
    expect(providers[0]?.enabled).toBe(false);

    const models = store.listTenantModelsByProvider(tenant, providers[0]!.id);
    expect(models.length).toBe(1);
    expect(models[0]?.model_code).toBe('gpt-4o-mini');
    expect(models[0]?.enabled).toBe(false);
  });

  it('does not duplicate tenant models on second sync', async () => {
    const tenant = 1001;
    const store = new InMemoryCatalogStore(createDefaultCatalogSeed(tenant));
    const provisioning = new LlmCatalogProvisioningService(store);
    await provisioning.syncTenantCatalog(tenant);
    const before = store.listTenantModelsByProvider(tenant, 'tenant-prov-openai').length;
    await provisioning.syncTenantCatalog(tenant);
    const after = store.listTenantModelsByProvider(tenant, 'tenant-prov-openai').length;
    expect(after).toBe(before);
  });
});
