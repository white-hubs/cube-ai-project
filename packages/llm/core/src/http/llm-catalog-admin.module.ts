import { type Container, Module } from "@dangao/bun-server";

import { LLM_PROVIDER_ICON_STORE_TOKEN, type LlmProviderIconStorePort } from "@cube-ai/contracts/platform";

import { LlmCatalogProvisioningService as ProvisioningClass } from "../catalog/admin/llm-catalog-provisioning.service";
import { LlmCatalogService } from "../catalog/admin/llm-catalog.service";
import { LocalProviderIconStore as LocalIconStoreClass } from "../catalog/admin/local-provider-icon-store";
import { ModelMetadataInferenceService as InferenceClass } from "../catalog/admin/model-metadata-inference.service";
import { LlmTypeAdapterService } from "../catalog/connectivity/llm-type-adapter.service";
import {
  type CatalogMysqlPool,
  SystemLlmModelMatchRuleRepository,
  SystemLlmModelRepository,
  SystemLlmProviderRepository,
  SystemLlmProviderTypeRepository,
  TenantLlmModelRepository,
  TenantLlmProviderRepository,
} from "../catalog/repositories";
import { LlmCatalogAdminController } from "./llm-catalog-admin.controller";
import { LLM_HTTP_TENANT_RESOLVER_TOKEN, type LlmHttpTenantResolver } from "./request-tenant";

/**
 * catalog 管理面共享同一 MySQL pool（与 engine/flow 同库）。用全局 Symbol 字符串与
 * engine `MYSQL_POOL_TOKEN`（Symbol.for('agentic.infra.mysql')）对齐，无需 import engine 包。
 */
export const CATALOG_MYSQL_POOL_TOKEN = Symbol.for("agentic.infra.mysql");

/**
 * LLM 目录管理面 HTTP 模块（/llm 全 CRUD + 远程发现/连通性）。
 * 需要 MySQL pool（CATALOG_MYSQL_POOL_TOKEN）+ 租户 resolver（LLM_HTTP_TENANT_RESOLVER_TOKEN）。
 * 图标默认走本地回退实现；ghcloud 环境可在更高层 @Global 模块覆盖 LLM_PROVIDER_ICON_STORE_TOKEN。
 */
@Module({
  controllers: [LlmCatalogAdminController],
  providers: [
    { provide: LLM_PROVIDER_ICON_STORE_TOKEN, useClass: LocalIconStoreClass },
    {
      provide: LlmCatalogService,
      useFactory: (c: Container) => {
        const pool = c.resolve(CATALOG_MYSQL_POOL_TOKEN) as CatalogMysqlPool;
        const resolve = c.resolve(LLM_HTTP_TENANT_RESOLVER_TOKEN) as LlmHttpTenantResolver;
        const getTenant = (): number => resolve();

        const typeAdapter = new LlmTypeAdapterService();
        const systemTypeRepo = new SystemLlmProviderTypeRepository(pool);
        const systemProviderRepo = new SystemLlmProviderRepository(pool);
        const systemModelRepo = new SystemLlmModelRepository(pool);
        const matchRuleRepo = new SystemLlmModelMatchRuleRepository(pool);
        const tenantProviderRepo = new TenantLlmProviderRepository(pool, getTenant);
        const tenantModelRepo = new TenantLlmModelRepository(pool, getTenant);

        const inference = new InferenceClass(systemProviderRepo, systemModelRepo, matchRuleRepo);
        const provisioning = new ProvisioningClass(
          systemTypeRepo,
          systemProviderRepo,
          systemModelRepo,
          tenantProviderRepo,
          tenantModelRepo,
          inference,
        );

        let iconStore: LlmProviderIconStorePort;
        try {
          iconStore = c.resolve(LLM_PROVIDER_ICON_STORE_TOKEN) as LlmProviderIconStorePort;
        } catch {
          iconStore = new LocalIconStoreClass();
        }

        return new LlmCatalogService(
          systemTypeRepo,
          tenantProviderRepo,
          tenantModelRepo,
          typeAdapter,
          inference,
          provisioning,
          iconStore,
          getTenant,
        );
      },
    },
  ],
})
export class LlmCatalogAdminHttpModule {}
