import { generateNumericId } from '../generate-id';
import type {
  SystemLlmModelRepository,
  SystemLlmProviderRepository,
  SystemLlmProviderTypeRepository,
  TenantLlmModelRepository,
  TenantLlmProviderRepository,
  TenantProviderRow,
} from '../repositories';
import { ModelMetadataInferenceService } from './model-metadata-inference.service';

/**
 * 移植自 ghcloud LlmCatalogProvisioningService：租户首访模型管理时，
 * 把启用的系统供应商/模型目录同步成该租户的初始副本（mysql2 仓储版）。
 * 租户由仓储构造时注入的 resolver 决定，无需 sessionContext。
 */
export class LlmCatalogProvisioningService {
  constructor(
    private readonly systemTypeRepository: SystemLlmProviderTypeRepository,
    private readonly systemProviderRepository: SystemLlmProviderRepository,
    private readonly systemModelRepository: SystemLlmModelRepository,
    private readonly tenantProviderRepository: TenantLlmProviderRepository,
    private readonly tenantModelRepository: TenantLlmModelRepository,
    private readonly modelMetadataInferenceService: ModelMetadataInferenceService,
  ) {}

  async syncTenantCatalog(_tenant: number): Promise<void> {
    const enabledTypes = await this.systemTypeRepository.listEnabled();
    const typeCodes = enabledTypes.map((item) => item.code);
    const providers = await this.systemProviderRepository.listByTypeCodes(typeCodes);
    for (const provider of providers) {
      const tenantProvider = await this.ensureTenantProvider(provider.id, {
        provider_code: provider.provider_code,
        type_code: provider.type_code,
        name: provider.name,
        icon_url: provider.icon_url,
        remark: provider.default_remark,
      });
      await this.syncModelsForProvider(provider.id, tenantProvider);
    }
  }

  private async ensureTenantProvider(
    systemProviderId: string,
    data: { provider_code: string; type_code: string; name: string; icon_url: string | null; remark: string | null },
  ): Promise<TenantProviderRow> {
    const existing = await this.tenantProviderRepository.findBySystemProviderId(systemProviderId);
    if (existing) return existing;
    const id = generateNumericId();
    await this.tenantProviderRepository.insertRow({
      id,
      system_provider_id: systemProviderId,
      provider_code: data.provider_code,
      type_code: data.type_code,
      name: data.name,
      icon_url: data.icon_url,
      api_base_url: null,
      api_key: null,
      enabled: false,
      is_custom: false,
      remark: data.remark,
    });
    return (await this.tenantProviderRepository.findByIdForTenant(id)) as TenantProviderRow;
  }

  private async syncModelsForProvider(systemProviderId: string, tenantProvider: TenantProviderRow): Promise<void> {
    const tenantModels = await this.tenantModelRepository.listByProvider(tenantProvider.id);
    const existingBySystemModel = new Set<string>();
    for (const model of tenantModels) {
      if (model.system_model_id != null) existingBySystemModel.add(model.system_model_id.toString());
    }
    const systemModels = await this.systemModelRepository.listBySystemProvider(systemProviderId);
    for (const model of systemModels) {
      if (existingBySystemModel.has(model.id.toString())) continue;
      const inferred = await this.inferCatalogModelMetadata(tenantProvider, systemProviderId, model);
      await this.tenantModelRepository.insertRow({
        id: generateNumericId(),
        tenant_provider_id: tenantProvider.id,
        system_model_id: model.id,
        model_code: model.model_code,
        display_name: model.display_name,
        group_name: model.group_name,
        sort_order: model.sort_order,
        remark: null,
        icon_url: model.icon_url,
        api_base_url: model.api_base_url,
        endpoint_type: model.endpoint_type,
        request_schema_json: inferred.requestSchemaJson,
        response_schema_json: inferred.responseSchemaJson,
        dsl_schema_json: inferred.dslSchemaJson,
        model_types: model.model_types,
        is_free: model.is_free,
        supports_test: model.supports_test,
      });
    }
  }

  private async inferCatalogModelMetadata(
    tenantProvider: TenantProviderRow,
    systemProviderId: string,
    model: { model_code: string; display_name: string; group_name: string },
  ): Promise<{ requestSchemaJson: string | null; responseSchemaJson: string | null; dslSchemaJson: string | null }> {
    const [candidate] = await this.modelMetadataInferenceService.inferRemoteModels(
      {
        typeCode: tenantProvider.type_code,
        providerCode: tenantProvider.provider_code,
        iconUrl: tenantProvider.icon_url,
        systemProviderId,
      },
      [
        {
          modelCode: model.model_code,
          displayName: model.display_name,
          groupName: model.group_name,
        },
      ],
    );
    return {
      requestSchemaJson: candidate?.requestSchema == null ? null : JSON.stringify(candidate.requestSchema),
      responseSchemaJson: candidate?.responseSchema == null ? null : JSON.stringify(candidate.responseSchema),
      dslSchemaJson: candidate?.dslSchema == null ? null : JSON.stringify(candidate.dslSchema),
    };
  }
}
