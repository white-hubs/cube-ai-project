import { ensureCatalogTables, type CatalogMysqlPool } from './catalog-mysql-pool';
import type { MatchRuleRow, SystemModelRow, SystemProviderRow, SystemTypeRow } from './row-types';
import {
  SystemLlmModelMatchRuleRepository,
  SystemLlmModelRepository,
  SystemLlmProviderRepository,
  SystemLlmProviderTypeRepository,
} from './system.repositories';
import { AUTHORITATIVE_SYSTEM_CATALOG_SEED } from './system-seed.data';

export { AUTHORITATIVE_SYSTEM_CATALOG_SEED };

/** 系统目录种子（迁移工具/初始化用）。租户副本由首访 provisioning 自动生成。 */
export interface SystemCatalogSeed {
  types?: Array<Pick<SystemTypeRow, 'code' | 'display_name' | 'description' | 'sort_order' | 'enabled'>>;
  providers?: SystemProviderRow[];
  models?: SystemModelRow[];
  matchRules?: MatchRuleRow[];
}

/** 幂等 upsert 系统目录到真实列式表（建表 + 写 types/providers/models/rules）。 */
export async function upsertSystemCatalogMysql(pool: CatalogMysqlPool, seed: SystemCatalogSeed): Promise<void> {
  await ensureCatalogTables(pool);
  const typeRepo = new SystemLlmProviderTypeRepository(pool);
  const providerRepo = new SystemLlmProviderRepository(pool);
  const modelRepo = new SystemLlmModelRepository(pool);
  const ruleRepo = new SystemLlmModelMatchRuleRepository(pool);
  for (const row of seed.types ?? []) await typeRepo.upsert(row);
  for (const row of seed.providers ?? []) await providerRepo.upsert(row);
  for (const row of seed.models ?? []) await modelRepo.upsert(row);
  for (const row of seed.matchRules ?? []) await ruleRepo.upsert(row);
}

/**
 * 权威 seed 入口：warm-load 系统目录到 MySQL。
 * 默认在 MySQL 可用时自动调用一次；`CUBE_AI_CATALOG_SEED_SYSTEM=0` 可关闭。
 */
export async function seedAuthoritativeSystemCatalogMysql(pool: CatalogMysqlPool): Promise<void> {
  return upsertSystemCatalogMysql(pool, AUTHORITATIVE_SYSTEM_CATALOG_SEED);
}
