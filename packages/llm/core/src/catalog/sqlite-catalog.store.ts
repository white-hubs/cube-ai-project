import { Database } from 'bun:sqlite';
import type { InMemoryCatalogSeed } from './in-memory-catalog.store';

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS catalog_system_types (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS catalog_system_providers (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS catalog_system_models (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS catalog_match_rules (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS catalog_tenant_providers (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS catalog_tenant_models (id TEXT PRIMARY KEY, data TEXT NOT NULL);
`;

function upsertRow(db: Database, table: string, id: string, data: unknown): void {
  db.query(
    `INSERT INTO ${table} (id, data) VALUES (?1, ?2)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
  ).run(id, JSON.stringify(data));
}

export function openCatalogSqlite(path: string): Database {
  const db = new Database(path);
  db.exec(TABLE_DDL);
  return db;
}

export function upsertCatalogSeed(db: Database, seed: InMemoryCatalogSeed): void {
  for (const row of seed.systemTypes ?? []) upsertRow(db, 'catalog_system_types', row.id, row);
  for (const row of seed.systemProviders ?? []) upsertRow(db, 'catalog_system_providers', row.id, row);
  for (const row of seed.systemModels ?? []) upsertRow(db, 'catalog_system_models', row.id, row);
  for (const row of seed.matchRules ?? []) upsertRow(db, 'catalog_match_rules', row.id, row);
  for (const row of seed.tenantProviders ?? []) upsertRow(db, 'catalog_tenant_providers', row.id, row);
  for (const row of seed.tenantModels ?? []) upsertRow(db, 'catalog_tenant_models', row.id, row);
}

export function loadCatalogSeedFromSqlite(db: Database): InMemoryCatalogSeed {
  const read = (table: string) =>
    db.query<{ data: string }, []>(`SELECT data FROM ${table}`).all().map((r) => JSON.parse(r.data));

  return {
    systemTypes: read('catalog_system_types'),
    systemProviders: read('catalog_system_providers'),
    systemModels: read('catalog_system_models'),
    matchRules: read('catalog_match_rules'),
    tenantProviders: read('catalog_tenant_providers'),
    tenantModels: read('catalog_tenant_models'),
  };
}
