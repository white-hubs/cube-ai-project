import type {
  LlmCatalogPort,
  LlmEndpointType,
  LlmModelRuntimeConfig,
  LlmProviderSummary,
} from '@cube-ai/contracts';
import {
  ensureCatalogTables,
  seedAuthoritativeSystemCatalogMysql,
  TenantLlmModelRepository,
  TenantLlmProviderRepository,
  type CatalogMysqlPool,
} from './repositories';
import { createMysqlCatalogProvisioning } from './create-mysql-catalog-provisioning';
import { splitModelTypes } from './schema/llm-schema';

function asEndpointType(value: string | null | undefined): LlmEndpointType | null {
  if (!value) return null;
  return value as LlmEndpointType;
}

/**
 * MySQL 后端的 `LlmCatalogPort`，直读 ghcloud 真实列式表
 * （`ai_application_tenant_llm_provider` / `ai_application_tenant_llm_model`）。
 * 与 engine/flow 共享同一 MySQL（库 `cube_ai_center`）；管理面 CRUD 写入实时可见、多实例一致。
 *
 * 首次 `ensure()` 执行权威系统目录 warm-load（幂等，多实例安全）；
 * 显式设 `CUBE_AI_CATALOG_SEED_SYSTEM=0` 可跳过。
 * dev 占位分支保留在 agent-engine `LlmCatalogModule`（`CUBE_AI_CATALOG_DEV_SEED=1`）。
 */
export class MysqlLlmCatalogPort implements LlmCatalogPort {
  private tablesReady?: Promise<void>;

  constructor(private readonly pool: CatalogMysqlPool) {}

  private ensure(): Promise<void> {
    if (!this.tablesReady) {
      const doSeed = (process.env['CUBE_AI_CATALOG_SEED_SYSTEM'] ?? '1') !== '0';
      this.tablesReady = ensureCatalogTables(this.pool).then(() => {
        if (doSeed) {
          return seedAuthoritativeSystemCatalogMysql(this.pool);
        }
      });
    }
    return this.tablesReady;
  }

  async listProviders(tenant: number, _signal: AbortSignal): Promise<LlmProviderSummary[]> {
    await this.ensure();
    const providerRepo = new TenantLlmProviderRepository(this.pool, () => tenant);
    let rows = await providerRepo.listByTenant();
    if (rows.length === 0) {
      // 与管理面 LlmCatalogService.listProviders 对齐：租户首访消费面时也自动
      // 从系统目录同步副本，避免 GET /llm/providers 在从未打开管理页时永远空列表。
      await createMysqlCatalogProvisioning(this.pool, () => tenant).syncTenantCatalog(tenant);
      rows = await providerRepo.listByTenant();
    }
    return rows.map((row) => ({
      id: String(row.id),
      providerCode: row.provider_code,
      typeCode: row.type_code,
      apiBaseUrl: row.api_base_url,
      enabled: Boolean(row.enabled),
    }));
  }

  async resolveModelRuntime(
    tenant: number,
    modelCode: string,
    _signal: AbortSignal,
  ): Promise<LlmModelRuntimeConfig | null> {
    await this.ensure();
    const modelRepo = new TenantLlmModelRepository(this.pool, () => tenant);
    const model = await modelRepo.findByCodeForTenant(modelCode);
    if (!model) return null;

    const providerRepo = new TenantLlmProviderRepository(this.pool, () => tenant);
    const provider = await providerRepo.findByIdForTenant(model.tenant_provider_id.toString());
    if (!provider || !provider.enabled) return null;

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
      isFree: Boolean(model.is_free),
      providerCode: provider.provider_code,
    };
  }
}
