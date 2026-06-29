import { generateNumericId } from "../generate-id";
import {
  type SystemLlmModelRepository,
  type SystemLlmProviderRepository,
  type SystemLlmProviderTypeRepository,
  type TenantLlmModelRepository,
  type TenantLlmProviderRepository,
  type TenantProviderRow,
} from "../repositories";
import { type ModelMetadataInferenceService } from "./model-metadata-inference.service";

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
        icon_url: provider.icon_url,
        name: provider.name,
        provider_code: provider.provider_code,
        remark: provider.default_remark,
        type_code: provider.type_code,
      });
      await this.syncModelsForProvider(provider.id, tenantProvider);
    }
  }

  private async ensureTenantProvider(
    systemProviderId: string,
    data: { provider_code: string; type_code: string; name: string; icon_url: string | null; remark: string | null },
  ): Promise<TenantProviderRow> {
    const existing = await this.tenantProviderRepository.findBySystemProviderId(systemProviderId);
    if (existing) {
      return existing;
    }
    const id = generateNumericId();
    await this.tenantProviderRepository.insertRow({
      api_base_url: null,
      api_key: null,
      enabled: false,
      icon_url: data.icon_url,
      id,
      is_custom: false,
      name: data.name,
      provider_code: data.provider_code,
      remark: data.remark,
      system_provider_id: systemProviderId,
      type_code: data.type_code,
    });
    return (await this.tenantProviderRepository.findByIdForTenant(id)) as TenantProviderRow;
  }

  private async syncModelsForProvider(systemProviderId: string, tenantProvider: TenantProviderRow): Promise<void> {
    const tenantModels = await this.tenantModelRepository.listByProvider(tenantProvider.id);
    const existingBySystemModel = new Set<string>();
    for (const model of tenantModels) {
      if (model.system_model_id !== null && model.system_model_id !== undefined) {
        existingBySystemModel.add(model.system_model_id.toString());
      }
    }
    const systemModels = await this.systemModelRepository.listBySystemProvider(systemProviderId);
    for (const model of systemModels) {
      if (existingBySystemModel.has(model.id.toString())) {
        continue;
      }
      const inferred = await this.inferCatalogModelMetadata(tenantProvider, systemProviderId, model);
      await this.tenantModelRepository.insertRow({
        api_base_url: model.api_base_url,
        display_name: model.display_name,
        dsl_schema_json: inferred.dslSchemaJson,
        endpoint_type: model.endpoint_type,
        group_name: model.group_name,
        icon_url: model.icon_url,
        id: generateNumericId(),
        is_free: model.is_free,
        model_code: model.model_code,
        model_types: model.model_types,
        remark: null,
        request_schema_json: inferred.requestSchemaJson,
        response_schema_json: inferred.responseSchemaJson,
        sort_order: model.sort_order,
        supports_test: model.supports_test,
        system_model_id: model.id,
        tenant_provider_id: tenantProvider.id,
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
        iconUrl: tenantProvider.icon_url,
        providerCode: tenantProvider.provider_code,
        systemProviderId,
        typeCode: tenantProvider.type_code,
      },
      [
        {
          displayName: model.display_name,
          groupName: model.group_name,
          modelCode: model.model_code,
        },
      ],
    );
    return {
      dslSchemaJson: candidate?.dslSchema === null || candidate?.dslSchema === undefined ? null : JSON.stringify(candidate.dslSchema),
      requestSchemaJson:
        candidate?.requestSchema === null || candidate?.requestSchema === undefined ? null : JSON.stringify(candidate.requestSchema),
      responseSchemaJson:
        candidate?.responseSchema === null || candidate?.responseSchema === undefined ? null : JSON.stringify(candidate.responseSchema),
    };
  }
}
