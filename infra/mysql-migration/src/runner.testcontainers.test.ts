/**
 * MigrationRunner 行为测试 — 真实 MySQL（Testcontainers）。
 *
 *   USE_TESTCONTAINERS=1 bun test infra/mysql-migration
 *   bun run test:containers
 */
import { afterAll, beforeAll, describe, expect, test, setDefaultTimeout } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import mysql from 'mysql2/promise';
import {
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlOnly,
  stopTrackedTestcontainersIfAny,
  type MysqlOnlyStack,
} from '@cube-ai/test-infra';
import { createMigrationRunner } from './index';

setDefaultTimeout(1_800_000);

async function tableExists(mysqlUrl: string, tableName: string): Promise<boolean> {
  const conn = await mysql.createConnection({ uri: mysqlUrl, multipleStatements: true });
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [tableName],
    );
    return rows[0].cnt > 0;
  } finally {
    await conn.end();
  }
}

async function queryScalar<T>(mysqlUrl: string, sql: string, params: unknown[] = []): Promise<T> {
  const conn = await mysql.createConnection({ uri: mysqlUrl, multipleStatements: true });
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(sql, params);
    const first = rows[0];
    return Object.values(first)[0] as T;
  } finally {
    await conn.end();
  }
}

/** MySQL testcontainers often accept TCP before the first session is stable. */
async function waitForMysqlReady(url: string): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const conn = await mysql.createConnection({ uri: url });
      try {
        await conn.query('SELECT 1');
        return;
      } finally {
        await conn.end();
      }
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('MySQL container not ready after 30 attempts');
}

async function makeTmpDir(): Promise<string> {
  const dir = join(tmpdir(), `migration-test-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

let stack: MysqlOnlyStack;
let mysqlUrl: string;

beforeAll(async () => {
  registerProcessShutdown(stopTrackedTestcontainersIfAny);
  const should = await resolveShouldRunTestcontainers();
  if (!should) return;
  stack = await startMysqlOnly();
  mysqlUrl = stack.mysqlUrl;
  await waitForMysqlReady(mysqlUrl);
});

afterAll(async () => {
  await stack?.stop();
});

describe('MigrationRunner', () => {
  test('Cycle 1 — creates history table on first run', async () => {
    const should = await resolveShouldRunTestcontainers();
    if (!should) { console.log('skip: USE_TESTCONTAINERS not set'); return; }

    const dir = await makeTmpDir();
    const historyTable = 'mig_test_c1_history';
    const runner = createMigrationRunner({ mysqlUrl, migrationsDir: dir, historyTable });

    await runner.run();

    expect(await tableExists(mysqlUrl, historyTable)).toBe(true);
    await rm(dir, { recursive: true });
  });

  test('Cycle 2 — V files run in version-number order', async () => {
    const should = await resolveShouldRunTestcontainers();
    if (!should) { console.log('skip: USE_TESTCONTAINERS not set'); return; }

    const dir = await makeTmpDir();
    const historyTable = 'mig_test_c2_history';

    await writeFile(join(dir, 'V002__second.sql'),
      'CREATE TABLE mig_c2_second (id INT PRIMARY KEY);');
    await writeFile(join(dir, 'V001__first.sql'),
      'CREATE TABLE mig_c2_first (id INT PRIMARY KEY);');

    const runner = createMigrationRunner({ mysqlUrl, migrationsDir: dir, historyTable });
    await runner.run();

    expect(await tableExists(mysqlUrl, 'mig_c2_first')).toBe(true);
    expect(await tableExists(mysqlUrl, 'mig_c2_second')).toBe(true);

    const applied = await queryScalar<number>(
      mysqlUrl,
      `SELECT COUNT(*) AS cnt FROM \`${historyTable}\``,
    );
    expect(applied).toBe(2);
    await rm(dir, { recursive: true });
  });

  test('Cycle 3 — V files not re-applied on second run', async () => {
    const should = await resolveShouldRunTestcontainers();
    if (!should) { console.log('skip: USE_TESTCONTAINERS not set'); return; }

    const dir = await makeTmpDir();
    const historyTable = 'mig_test_c3_history';

    await writeFile(join(dir, 'V001__seed_row.sql'),
      'CREATE TABLE mig_c3_counter (id INT PRIMARY KEY, val INT); ' +
      'INSERT INTO mig_c3_counter VALUES (1, 1);');

    const runner = createMigrationRunner({ mysqlUrl, migrationsDir: dir, historyTable });
    await runner.run();
    await runner.run();

    const count = await queryScalar<number>(
      mysqlUrl,
      'SELECT COUNT(*) AS cnt FROM mig_c3_counter',
    );
    expect(count).toBe(1);
    await rm(dir, { recursive: true });
  });

  test('Cycle 4 — S files re-run on every invocation', async () => {
    const should = await resolveShouldRunTestcontainers();
    if (!should) { console.log('skip: USE_TESTCONTAINERS not set'); return; }

    const dir = await makeTmpDir();
    const historyTable = 'mig_test_c4_history';

    await writeFile(join(dir, 'V001__setup.sql'),
      'CREATE TABLE mig_c4_items (id INT PRIMARY KEY, name VARCHAR(64));');
    await writeFile(join(dir, 'S001__seed.sql'),
      'INSERT INTO mig_c4_items (id, name) VALUES (1, \'item\') ON DUPLICATE KEY UPDATE name = VALUES(name);');

    const runner = createMigrationRunner({ mysqlUrl, migrationsDir: dir, historyTable });
    await runner.run();
    await runner.run();

    const count = await queryScalar<number>(
      mysqlUrl,
      'SELECT COUNT(*) AS cnt FROM mig_c4_items',
    );
    expect(count).toBe(1);
    await rm(dir, { recursive: true });
  });

  test('Cycle 5 — failed V file halts subsequent migrations', async () => {
    const should = await resolveShouldRunTestcontainers();
    if (!should) { console.log('skip: USE_TESTCONTAINERS not set'); return; }

    const dir = await makeTmpDir();
    const historyTable = 'mig_test_c5_history';

    await writeFile(join(dir, 'V001__ok.sql'),
      'CREATE TABLE mig_c5_ok (id INT PRIMARY KEY);');
    await writeFile(join(dir, 'V002__bad.sql'),
      'THIS IS NOT VALID SQL !!!;');
    await writeFile(join(dir, 'V003__should_not_run.sql'),
      'CREATE TABLE mig_c5_should_not_exist (id INT PRIMARY KEY);');

    const runner = createMigrationRunner({ mysqlUrl, migrationsDir: dir, historyTable });

    await expect(runner.run()).rejects.toThrow();
    expect(await tableExists(mysqlUrl, 'mig_c5_ok')).toBe(true);
    expect(await tableExists(mysqlUrl, 'mig_c5_should_not_exist')).toBe(false);
    await rm(dir, { recursive: true });
  });
});
