import type { InMemoryCatalogSeed } from '../../packages/llm/core/src/catalog/in-memory-catalog.store';
import {
  loadCatalogSeedFromSqlite,
  openCatalogSqlite,
  upsertCatalogSeed,
} from '../../packages/llm/core/src/catalog/sqlite-catalog.store';
import type {
  SystemLlmModelEntity,
  SystemLlmModelMatchRuleEntity,
  SystemLlmProviderEntity,
  SystemLlmProviderTypeEntity,
  TenantLlmModelEntity,
  TenantLlmProviderEntity,
} from '../../packages/llm/core/src/catalog/entities';
import type { LlmEndpointType } from '@cube-ai/contracts';

/** Raw ghcloud export row shapes (cube_base_ai_application). */
export interface GhcloudSystemLlmProviderTypeRow {
  id: number | string;
  code: string;
  display_name?: string;
  name?: string;
  sort?: number;
  enabled?: boolean | number;
}

export interface GhcloudSystemLlmProviderRow {
  id: number | string;
  provider_code: string;
  type_code: string;
  name: string;
  icon?: string | null;
  icon_url?: string | null;
  default_remark?: string | null;
  enabled?: boolean | number;
}

export interface GhcloudSystemLlmModelRow {
  id: number | string;
  system_provider_id: number | string;
  model_code: string;
  display_name: string;
  group_name?: string | null;
  icon?: string | null;
  icon_url?: string | null;
  api_base_url?: string | null;
  endpoint_type?: string | null;
  model_types?: string | null;
  is_free?: boolean | number;
  supports_test?: boolean | number;
}

export interface GhcloudSystemLlmModelMatchRuleRow {
  id: number | string;
  provider_type_code?: string | null;
  provider_code?: string | null;
  match_type: 'exact' | 'prefix' | 'contains' | 'regex';
  pattern: string;
  normalized_name?: string | null;
  native_family?: string | null;
  display_name_template?: string | null;
  group_name?: string | null;
  icon_url?: string | null;
  api_base_url?: string | null;
  endpoint_type?: string | null;
  request_schema_json?: string | null;
  response_schema_json?: string | null;
  dsl_schema_json?: string | null;
  model_types?: string | null;
  is_free?: boolean | number;
  priority?: number | string | null;
}

export interface GhcloudTenantLlmProviderRow {
  id: number | string;
  tenant: number;
  system_provider_id?: number | string | null;
  provider_code: string;
  type_code: string;
  name: string;
  icon?: string | null;
  icon_url?: string | null;
  api_base_url?: string | null;
  api_key?: string | null;
  enabled?: boolean | number;
  is_custom?: boolean | number;
  remark?: string | null;
}

export interface GhcloudTenantLlmModelRow {
  id: number | string;
  tenant: number;
  tenant_provider_id: number | string;
  system_model_id?: number | string | null;
  model_code: string;
  display_name: string;
  group_name?: string | null;
  icon?: string | null;
  icon_url?: string | null;
  api_base_url?: string | null;
  endpoint_type?: string | null;
  request_schema_json?: string | null;
  response_schema_json?: string | null;
  dsl_schema_json?: string | null;
  model_types?: string | null;
  is_free?: boolean | number;
  supports_test?: boolean | number;
  enabled?: boolean | number;
}

export interface GhcloudCatalogSource {
  systemTypes?: GhcloudSystemLlmProviderTypeRow[];
  systemProviders?: GhcloudSystemLlmProviderRow[];
  systemModels?: GhcloudSystemLlmModelRow[];
  matchRules?: GhcloudSystemLlmModelMatchRuleRow[];
  tenantProviders?: GhcloudTenantLlmProviderRow[];
  tenantModels?: GhcloudTenantLlmModelRow[];
}

export type CatalogMigrateTarget = 'memory' | 'sqlite';

export interface CatalogMigrateOptions {
  source: GhcloudCatalogSource;
  dryRun?: boolean;
  target?: CatalogMigrateTarget;
  sqlitePath?: string;
}

export interface CatalogMigrateResult {
  dryRun: boolean;
  target: CatalogMigrateTarget;
  counts: {
    systemTypes: number;
    systemProviders: number;
    systemModels: number;
    matchRules: number;
    tenantProviders: number;
    tenantModels: number;
  };
  seed: InMemoryCatalogSeed;
  warnings: string[];
}

function asId(value: number | string): string {
  return String(value);
}

function asBool(value: boolean | number | undefined, fallback = true): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return value !== 0;
}

function asEndpointType(raw: string | null | undefined): LlmEndpointType | null {
  if (!raw) return null;
  return raw as LlmEndpointType;
}

function asCsv(raw: string | null | undefined, fallback = ''): string {
  if (raw == null || raw === '') return fallback;
  return raw;
}

export function mapGhcloudCatalogToLlmCore(source: GhcloudCatalogSource): {
  seed: InMemoryCatalogSeed;
  warnings: string[];
} {
  const warnings: string[] = [];

  const systemTypes: SystemLlmProviderTypeEntity[] = (source.systemTypes ?? []).map((row) => ({
    id: asId(row.id),
    code: row.code,
    name: row.display_name ?? row.name ?? row.code,
    enabled: asBool(row.enabled),
  }));

  const systemProviders: SystemLlmProviderEntity[] = (source.systemProviders ?? []).map((row) => ({
    id: asId(row.id),
    provider_code: row.provider_code,
    type_code: row.type_code,
    name: row.name,
    icon_url: row.icon_url ?? row.icon ?? null,
    default_remark: row.default_remark ?? null,
    enabled: asBool(row.enabled),
  }));

  const systemModels: SystemLlmModelEntity[] = (source.systemModels ?? []).map((row) => ({
    id: asId(row.id),
    system_provider_id: asId(row.system_provider_id),
    model_code: row.model_code,
    display_name: row.display_name,
    group_name: row.group_name ?? row.display_name,
    icon_url: row.icon_url ?? row.icon ?? null,
    api_base_url: row.api_base_url ?? null,
    endpoint_type: asEndpointType(row.endpoint_type),
    model_types: asCsv(row.model_types),
    is_free: asBool(row.is_free, false),
    supports_test: asBool(row.supports_test, true),
  }));

  const matchRules: SystemLlmModelMatchRuleEntity[] = (source.matchRules ?? []).map((row) => ({
    id: asId(row.id),
    provider_type_code: row.provider_type_code ?? null,
    provider_code: row.provider_code ?? null,
    match_type: row.match_type,
    pattern: row.pattern,
    normalized_name: row.normalized_name ?? null,
    native_family: row.native_family ?? null,
    display_name_template: row.display_name_template ?? null,
    group_name: row.group_name ?? null,
    icon_url: row.icon_url ?? null,
    api_base_url: row.api_base_url ?? null,
    endpoint_type: asEndpointType(row.endpoint_type),
    request_schema_json: row.request_schema_json ?? null,
    response_schema_json: row.response_schema_json ?? null,
    dsl_schema_json: row.dsl_schema_json ?? null,
    model_types: asCsv(row.model_types),
    is_free: asBool(row.is_free, false),
    priority: row.priority != null ? String(row.priority) : '0',
  }));

  const tenantProviders: TenantLlmProviderEntity[] = (source.tenantProviders ?? []).map((row) => ({
    id: asId(row.id),
    tenant: row.tenant,
    system_provider_id: row.system_provider_id != null ? asId(row.system_provider_id) : null,
    provider_code: row.provider_code,
    type_code: row.type_code,
    name: row.name,
    icon_url: row.icon_url ?? row.icon ?? null,
    api_base_url: row.api_base_url ?? null,
    api_key: row.api_key ?? null,
    enabled: asBool(row.enabled),
    is_custom: asBool(row.is_custom, false),
    remark: row.remark ?? null,
  }));

  const tenantModels: TenantLlmModelEntity[] = (source.tenantModels ?? []).map((row) => {
    if (row.endpoint_type === 'ollama' || row.endpoint_type === 'jina_rerank') {
      warnings.push(`tenant model ${row.model_code}: endpoint_type ${row.endpoint_type} is contracts-only`);
    }
    return {
      id: asId(row.id),
      tenant: row.tenant,
      tenant_provider_id: asId(row.tenant_provider_id),
      system_model_id: row.system_model_id != null ? asId(row.system_model_id) : null,
      model_code: row.model_code,
      display_name: row.display_name,
      group_name: row.group_name ?? row.display_name,
      icon_url: row.icon_url ?? row.icon ?? null,
      api_base_url: row.api_base_url ?? null,
      endpoint_type: asEndpointType(row.endpoint_type),
      model_types: asCsv(row.model_types),
      is_free: asBool(row.is_free, false),
      enabled: asBool(row.enabled),
    };
  });

  return {
    seed: {
      systemTypes,
      systemProviders,
      systemModels,
      matchRules,
      tenantProviders,
      tenantModels,
    },
    warnings,
  };
}

export async function migrateCatalog(options: CatalogMigrateOptions): Promise<CatalogMigrateResult> {
  const dryRun = options.dryRun ?? false;
  const target = options.target ?? 'memory';
  const { seed, warnings } = mapGhcloudCatalogToLlmCore(options.source);

  const counts = {
    systemTypes: seed.systemTypes?.length ?? 0,
    systemProviders: seed.systemProviders?.length ?? 0,
    systemModels: seed.systemModels?.length ?? 0,
    matchRules: seed.matchRules?.length ?? 0,
    tenantProviders: seed.tenantProviders?.length ?? 0,
    tenantModels: seed.tenantModels?.length ?? 0,
  };

  if (!dryRun && target === 'sqlite') {
    const path = options.sqlitePath ?? `${process.cwd()}/.tmp/catalog-migrate.sqlite`;
    const db = openCatalogSqlite(path);
    upsertCatalogSeed(db, seed);
    db.close();
  }

  return { dryRun, target, counts, seed, warnings };
}

export async function loadGhcloudCatalogSourceFromFile(path: string): Promise<GhcloudCatalogSource> {
  const text = await Bun.file(path).text();
  return JSON.parse(text) as GhcloudCatalogSource;
}

export function parseCatalogMigrateCliArgs(argv: string[]): {
  sourcePath: string | null;
  dryRun: boolean;
  target: CatalogMigrateTarget;
  sqlitePath?: string;
} {
  let sourcePath: string | null = null;
  let dryRun = false;
  let target: CatalogMigrateTarget = 'memory';
  let sqlitePath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--target' && argv[i + 1]) {
      const raw = argv[++i];
      if (raw === 'memory' || raw === 'sqlite') target = raw;
    } else if (arg === '--sqlite' && argv[i + 1]) {
      sqlitePath = argv[++i];
    } else if (arg === '--source' && argv[i + 1]) {
      sourcePath = argv[++i] ?? null;
    }
  }

  return { sourcePath, dryRun, target, sqlitePath };
}

async function main(): Promise<void> {
  const { sourcePath, dryRun, target, sqlitePath } = parseCatalogMigrateCliArgs(process.argv.slice(2));
  if (!sourcePath) {
    console.error('Usage: bun tools/migration/catalog-migrate.ts --source <export.json> [--dry-run] [--target memory|sqlite] [--sqlite path]');
    process.exit(1);
  }

  const source = await loadGhcloudCatalogSourceFromFile(sourcePath);
  const result = await migrateCatalog({ source, dryRun, target, sqlitePath });

  console.log(JSON.stringify({ counts: result.counts, dryRun: result.dryRun, target: result.target, warnings: result.warnings }, null, 2));
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
