import { LlmCatalogProvisioningService } from "./admin/llm-catalog-provisioning.service";
import { ModelMetadataInferenceService } from "./admin/model-metadata-inference.service";
import {
  type CatalogMysqlPool,
  SystemLlmModelMatchRuleRepository,
  SystemLlmModelRepository,
  SystemLlmProviderRepository,
  SystemLlmProviderTypeRepository,
  TenantLlmModelRepository,
  TenantLlmProviderRepository,
} from "./repositories";

/** Shared factory for admin + consumption catalog faces (same MySQL provisioning path). */
export function createMysqlCatalogProvisioning(pool: CatalogMysqlPool, getTenant: () => number): LlmCatalogProvisioningService {
  const systemTypeRepo = new SystemLlmProviderTypeRepository(pool);
  const systemProviderRepo = new SystemLlmProviderRepository(pool);
  const systemModelRepo = new SystemLlmModelRepository(pool);
  const matchRuleRepo = new SystemLlmModelMatchRuleRepository(pool);
  const tenantProviderRepo = new TenantLlmProviderRepository(pool, getTenant);
  const tenantModelRepo = new TenantLlmModelRepository(pool, getTenant);
  const inference = new ModelMetadataInferenceService(systemProviderRepo, systemModelRepo, matchRuleRepo);
  return new LlmCatalogProvisioningService(
    systemTypeRepo,
    systemProviderRepo,
    systemModelRepo,
    tenantProviderRepo,
    tenantModelRepo,
    inference,
  );
}
