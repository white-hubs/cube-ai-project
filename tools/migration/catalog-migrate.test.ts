import { describe, expect, test } from 'bun:test';
import { InMemoryCatalogStore } from '../../packages/llm/core/src/catalog/in-memory-catalog.store';
import {
  loadGhcloudCatalogSourceFromFile,
  mapGhcloudCatalogToLlmCore,
  migrateCatalog,
  parseCatalogMigrateCliArgs,
} from './catalog-migrate';
import { loadCatalogSeedFromSqlite, openCatalogSqlite } from '../../packages/llm/core/src/catalog/sqlite-catalog.store';

const fixturePath = new URL('./fixtures/sample-ghcloud-catalog.json', import.meta.url).pathname;

describe('catalog-migrate dry-run', () => {
  test('maps ghcloud rows to llm-core entity ids as strings', async () => {
    const source = await loadGhcloudCatalogSourceFromFile(fixturePath);
    const { seed } = mapGhcloudCatalogToLlmCore(source);

    expect(seed.systemTypes?.[0]?.id).toBe('1');
    expect(seed.systemProviders?.[0]?.id).toBe('10');
    expect(seed.tenantProviders?.[0]?.api_key).toBe('sk-exported');
    expect(seed.tenantModels?.[0]?.system_model_id).toBe('100');
  });

  test('dry-run returns counts without writing sqlite', async () => {
    const source = await loadGhcloudCatalogSourceFromFile(fixturePath);
    const result = await migrateCatalog({ source, dryRun: true, target: 'sqlite' });

    expect(result.dryRun).toBe(true);
    expect(result.counts).toEqual({
      systemTypes: 1,
      systemProviders: 1,
      systemModels: 1,
      matchRules: 1,
      tenantProviders: 1,
      tenantModels: 1,
    });
  });

  test('in-memory seed loads into InMemoryCatalogStore', async () => {
    const source = await loadGhcloudCatalogSourceFromFile(fixturePath);
    const { seed } = mapGhcloudCatalogToLlmCore(source);
    const store = new InMemoryCatalogStore(seed);

    expect(store.listTenantProviders(900001)).toHaveLength(1);
    expect(store.findTenantModelByCode(900001, 'gpt-4o')?.model_code).toBe('gpt-4o');
  });

  test('sqlite target upserts and reloads seed', async () => {
    const source = await loadGhcloudCatalogSourceFromFile(fixturePath);
    const sqlitePath = `${import.meta.dir}/.tmp-catalog-migrate.sqlite`;
    await migrateCatalog({ source, dryRun: false, target: 'sqlite', sqlitePath });

    const db = openCatalogSqlite(sqlitePath);
    const reloaded = loadCatalogSeedFromSqlite(db);
    db.close();

    expect(reloaded.tenantModels?.[0]?.model_code).toBe('gpt-4o');
    expect(reloaded.tenantProviders?.[0]?.api_key).toBe('sk-exported');
  });

  test('parseCatalogMigrateCliArgs recognizes --dry-run', () => {
    const parsed = parseCatalogMigrateCliArgs([
      '--source',
      '/tmp/export.json',
      '--dry-run',
      '--target',
      'memory',
    ]);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.sourcePath).toBe('/tmp/export.json');
    expect(parsed.target).toBe('memory');
  });
});
