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
import { upsertSystemCatalogMysql } from './repositories/seed';
import { AUTHORITATIVE_SYSTEM_CATALOG_SEED } from './repositories/system-seed.data';
import { splitModelTypes } from './schema/llm-schema';

function asEndpointType(value: string | null | undefined): LlmEndpointType | null {
  if (!value) return null;
  return value as LlmEndpointType;
}

/**
 * MySQL 后端的 `LlmCatalogPort`，直读 ghcloud 真实列式表
 * （`ai_application_tenant_llm_provider` / `ai_application_tenant_llm_model`）。
 * 与 engine/flow 共享同一 MySQL（库 `agentic_engine`）；管理面 CRUD 写入实时可见、多实例一致。
 * 解析逻辑对齐 InMemoryLlmCatalogPort / ghcloud getModelRuntimeConfig。
 */
/**
 * MySQL 后端的 `LlmCatalogPort`。
 * 当 `CUBE_AI_CATALOG_SEED_SYSTEM=1` 时，首次 ensure() 会执行一次权威系统目录 warm-load
 * （upsert `AUTHORITATIVE_SYSTEM_CATALOG_SEED`）；幂等，多实例安全。
 * 保留 `CUBE_AI_CATALOG_DEV_SEED=1` 仅在 InMemory 分支（engine llm-catalog.module），不影响此类。
 */
export class MysqlLlmCatalogPort implements LlmCatalogPort {
  private tablesReady?: Promise<void>;

  constructor(private readonly pool: CatalogMysqlPool) {}

  private ensure(): Promise<void> {
    if (!this.tablesReady) {
      const shouldSeedSystem = process.env['CUBE_AI_CATALOG_SEED_SYSTEM'] === '1';
      this.tablesReady = ensureCatalogTables(this.pool).then(async () => {
        if (shouldSeedSystem) {
          await upsertSystemCatalogMysql(this.pool, AUTHORITATIVE_SYSTEM_CATALOG_SEED);
        }
      });
    }
    return this.tablesReady;
  }

  async listProviders(tenant: number, _signal: AbortSignal): Promise<LlmProviderSummary[]> {
    await this.ensure();
    const providerRepo = new TenantLlmProviderRepository(this.pool, () => tenant);
    const rows = await providerRepo.listByTenant();
    return rows.map((row) => ({
      id: String(row.id),
      providerCode: row.provider_code,
      typeCode: row.type_code,
      apiBaseUrl: row.api_base_url ?? '',
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
