import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createPool } from "mysql2/promise";

import {
  type MysqlOnlyStack,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlOnly,
  stopTrackedTestcontainersIfAny,
} from "@cube-ai/test-infra";

import { LlmCatalogProvisioningService } from "./admin/llm-catalog-provisioning.service";
import { LlmCatalogService } from "./admin/llm-catalog.service";
import { LocalProviderIconStore } from "./admin/local-provider-icon-store";
import { ModelMetadataInferenceService } from "./admin/model-metadata-inference.service";
import { LlmTypeAdapterService } from "./connectivity/llm-type-adapter.service";
import { MysqlLlmCatalogPort } from "./mysql-catalog.store";
import {
  AUTHORITATIVE_SYSTEM_CATALOG_SEED,
  type CatalogMysqlPool,
  type SystemCatalogSeed,
  SystemLlmModelMatchRuleRepository,
  SystemLlmModelRepository,
  SystemLlmProviderRepository,
  SystemLlmProviderTypeRepository,
  TenantLlmModelRepository,
  TenantLlmProviderRepository,
  upsertSystemCatalogMysql,
} from "./repositories";

/**
 * LLM Catalog 真实 MySQL 端到端 — Testcontainers。
 *
 * 验证「列式表 + 首访 provisioning 自动同步租户副本 + 管理面 CRUD + 运行期 MysqlLlmCatalogPort 读回」闭环，
 * 与 ai-center 装配（LlmCatalogAdminHttpModule）使用同一套仓储/服务/端口。
 *
 *   USE_TESTCONTAINERS=1 bun test …/llm-catalog.testcontainers.test.ts
 *   bun run test:containers
 */

const TENANT = 4242;
const HOOK_MS = 1_800_000;
const SYSTEM_PROVIDER_COUNT = AUTHORITATIVE_SYSTEM_CATALOG_SEED.providers?.length ?? 0;

function requireProvider<T extends { providerCode: string }>(providers: T[], providerCode: string): T {
  const provider = providers.find((item) => item.providerCode === providerCode);
  expect(provider).toBeDefined();
  return provider!;
}

/** 刚启动的 MySQL 容器初始化期会断开首批连接；与 test-infra 同策略重试。 */
function isTransientMysqlErr(e: unknown): boolean {
  const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
  const msg = e instanceof Error ? e.message : String(e);
  return (
    code === "PROTOCOL_CONNECTION_LOST" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    msg.includes("PROTOCOL_CONNECTION_LOST") ||
    msg.includes("ECONNREFUSED")
  );
}

function makePool(mysqlUrl: string): CatalogMysqlPool {
  return createPool({
    bigNumberStrings: true,
    connectionLimit: 4,
    supportBigNumbers: true,
    uri: mysqlUrl,
  }) as unknown as CatalogMysqlPool;
}

async function endPool(pool: CatalogMysqlPool): Promise<void> {
  await (pool as unknown as { end: () => Promise<void> }).end();
}

async function seedWithRetry(mysqlUrl: string, seed: SystemCatalogSeed): Promise<void> {
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const pool = makePool(mysqlUrl);
    try {
      await upsertSystemCatalogMysql(pool, seed);
      await endPool(pool);
      return;
    } catch (e) {
      await endPool(pool).catch(() => {});
      if (!isTransientMysqlErr(e) || attempt === maxAttempts) {
        throw e;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const run = await resolveShouldRunTestcontainers();
const stackHolder: { current: MysqlOnlyStack | null } = { current: null };

if (run) {
  setDefaultTimeout(3_600_000);
  registerProcessShutdown(
    async () => {
      await stopTrackedTestcontainersIfAny();
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
    },
    { exitProcessAfterSignal: true },
  );
}

function buildService(pool: CatalogMysqlPool, getTenant: () => number): LlmCatalogService {
  const typeAdapter = new LlmTypeAdapterService();
  const systemTypeRepo = new SystemLlmProviderTypeRepository(pool);
  const systemProviderRepo = new SystemLlmProviderRepository(pool);
  const systemModelRepo = new SystemLlmModelRepository(pool);
  const matchRuleRepo = new SystemLlmModelMatchRuleRepository(pool);
  const tenantProviderRepo = new TenantLlmProviderRepository(pool, getTenant);
  const tenantModelRepo = new TenantLlmModelRepository(pool, getTenant);
  const inference = new ModelMetadataInferenceService(systemProviderRepo, systemModelRepo, matchRuleRepo);
  const provisioning = new LlmCatalogProvisioningService(
    systemTypeRepo,
    systemProviderRepo,
    systemModelRepo,
    tenantProviderRepo,
    tenantModelRepo,
    inference,
  );
  return new LlmCatalogService(
    systemTypeRepo,
    tenantProviderRepo,
    tenantModelRepo,
    typeAdapter,
    inference,
    provisioning,
    new LocalProviderIconStore(),
    getTenant,
  );
}

(run ? describe : describe.skip)("LLM Catalog [testcontainers] — 真实 MySQL 列式闭环", () => {
  beforeAll(async () => {
    const s = await startMysqlOnly();
    try {
      // 建表（与运行期 ensureCatalogTables 同一 DDL）+ 系统目录种子（含启动期断连重试）。
      await seedWithRetry(s.mysqlUrl, AUTHORITATIVE_SYSTEM_CATALOG_SEED);
      stackHolder.current = s;
    } catch (e) {
      await s.stop();
      throw e;
    }
  }, HOOK_MS);

  afterAll(async () => {
    if (stackHolder.current) {
      await stackHolder.current.stop().catch(() => {});
      stackHolder.current = null;
    }
    await stopTrackedTestcontainersIfAny();
  });

  test("消费面 MysqlLlmCatalogPort 首访空租户也会自动 provisioning", async () => {
    const pool = makePool(stackHolder.current!.mysqlUrl);
    const port = new MysqlLlmCatalogPort(pool);
    const freshTenant = TENANT + 99;

    const summaries = await port.listProviders(freshTenant, new AbortController().signal);
    expect(summaries.length).toBe(SYSTEM_PROVIDER_COUNT);
    expect(summaries.some((provider) => provider.providerCode === "openai-official")).toBe(true);

    await endPool(pool);
  });

  test("首访 provisioning 自动同步内置供应商 + 模型副本", async () => {
    const pool = makePool(stackHolder.current!.mysqlUrl);
    const service = buildService(pool, () => TENANT);

    const providers = await service.listProviders();
    expect(providers.length).toBe(SYSTEM_PROVIDER_COUNT);
    const builtin = requireProvider(providers, "openai-official");
    expect(builtin.providerCode).toBe("openai-official");
    expect(builtin.typeCode).toBe("openai");
    expect(builtin.isCustom).toBe(false);
    expect(builtin.enabled).toBe(false);
    expect(builtin.systemProviderId).not.toBeNull();

    const groups = await service.listModelsGrouped(builtin.id);
    const allModels = groups.flatMap((g) => g.items);
    const gpt4o = allModels.find((m) => m.modelCode === "gpt-4o");
    expect(gpt4o).toBeDefined();
    expect(gpt4o?.systemModelId).not.toBeNull();
    expect(gpt4o?.supportsTest).toBe(true);
    expect(gpt4o?.modelTypes).toContain("reasoning");

    // 幂等：再次首访不重复 provisioning。
    const providersAgain = await service.listProviders();
    expect(providersAgain.length).toBe(SYSTEM_PROVIDER_COUNT);

    await endPool(pool);
  });

  test("配置凭据 + 启用后，运行期 MysqlLlmCatalogPort 读回真实 runtime 配置", async () => {
    const pool = makePool(stackHolder.current!.mysqlUrl);
    const service = buildService(pool, () => TENANT);

    const builtin = requireProvider(await service.listProviders(), "openai-official");
    const updated = await service.updateProviderSettings(builtin.id, {
      apiBaseUrl: "https://api.openai.com/v1",
      apiKey: "sk-live-abcdef123456",
      enabled: true,
    });
    expect(updated.enabled).toBe(true);
    // 管理面读回脱敏。
    expect(updated.apiKey).toContain("****");

    const signal = new AbortController().signal;
    const port = new MysqlLlmCatalogPort(pool);

    const summaries = await port.listProviders(TENANT, signal);
    const portProvider = summaries.find((p) => p.providerCode === "openai-official");
    expect(portProvider?.enabled).toBe(true);
    expect(portProvider?.apiBaseUrl).toBe("https://api.openai.com/v1");

    const runtime = await port.resolveModelRuntime(TENANT, "gpt-4o", signal);
    expect(runtime).not.toBeNull();
    expect(runtime?.endpointType).toBe("openai");
    expect(runtime?.apiBaseUrl).toBe("https://api.openai.com/v1");
    // 运行期返回真实未脱敏密钥（供 provider 实际调用）。
    expect(runtime?.apiKey).toBe("sk-live-abcdef123456");
    expect(runtime?.providerCode).toBe("openai-official");
    expect(runtime?.modelTypes).toContain("reasoning");

    await endPool(pool);
  });

  test("自定义供应商 + 模型全 CRUD（含逻辑删除）", async () => {
    const pool = makePool(stackHolder.current!.mysqlUrl);
    const service = buildService(pool, () => TENANT);

    // 先建供应商（暂不配地址，避免 createModel 触发真实远程拉取）。
    const created = await service.createProvider({
      name: "我的兼容网关",
      providerCode: "my-openai-compat",
      remark: "e2e custom",
      typeCode: "openai",
    });
    expect(created.isCustom).toBe(true);

    const model = await service.createModel(created.id, {
      displayName: "Local X",
      endpointType: "openai",
      modelCode: "local-x",
      modelTypes: ["reasoning"],
    });
    expect(model.modelCode).toBe("local-x");

    const groups = await service.listModelsGrouped(created.id);
    expect(groups.flatMap((g) => g.items).some((m) => m.modelCode === "local-x")).toBe(true);

    // 配置凭据 + 启用，运行期才可解析其模型。
    await service.updateProviderSettings(created.id, {
      apiBaseUrl: "https://gw.example.com/v1",
      apiKey: "sk-custom-9999",
      enabled: true,
    });
    const port = new MysqlLlmCatalogPort(pool);
    const runtime = await port.resolveModelRuntime(TENANT, "local-x", new AbortController().signal);
    expect(runtime?.providerCode).toBe("my-openai-compat");
    expect(runtime?.apiBaseUrl).toBe("https://gw.example.com/v1");

    // 列表此时应有内置 + 自定义两个供应商。
    const before = await service.listProviders();
    expect(before.length).toBe(SYSTEM_PROVIDER_COUNT + 1);

    await service.deleteModel(created.id, model.id);
    await service.deleteProvider(created.id);

    const after = await service.listProviders();
    expect(after.length).toBe(SYSTEM_PROVIDER_COUNT);
    expect(after.some((provider) => provider.providerCode === "openai-official")).toBe(true);

    // 逻辑删除后运行期不再解析。
    const gone = await port.resolveModelRuntime(TENANT, "local-x", new AbortController().signal);
    expect(gone).toBeNull();

    await endPool(pool);
  });
});
