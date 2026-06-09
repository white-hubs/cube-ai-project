import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testInfraLog } from './log';
import { findMonorepoRoot } from './repo-path';

const fixtureUrl = new URL('../fixtures/minimal-mysql.sql', import.meta.url);
const grantsFixtureUrl = new URL('../fixtures/grants-mysql.sql', import.meta.url);

function isTransientMysqlConnectErr(e: unknown): boolean {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  const msg = e instanceof Error ? e.message : String(e);
  return (
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    msg.includes('PROTOCOL_CONNECTION_LOST') ||
    msg.includes('ECONNREFUSED')
  );
}

/**
 * Applies {@link fixtureUrl} on the given pool URI (`multipleStatements` enabled).
 */
export async function applyMinimalMysqlSchema(mysqlUrl: string): Promise<void> {
  testInfraLog('Applying minimal MySQL schema (sessions + outbox_events)…');
  const sql = await readFile(fileURLToPath(fixtureUrl), 'utf8');

  const maxAttempts = 30;
  const delayMs = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const conn = await mysql.createConnection({
        uri: mysqlUrl,
        multipleStatements: true,
      });
      try {
        await conn.query(sql);
        testInfraLog('Minimal MySQL schema applied.');
        return;
      } finally {
        await conn.end();
      }
    } catch (e) {
      if (!isTransientMysqlConnectErr(e) || attempt === maxAttempts) throw e;
      testInfraLog(
        `applyMinimalMysqlSchema: transient error (attempt ${attempt}/${maxAttempts}), retry in ${delayMs}ms — ${e instanceof Error ? e.message : String(e)}`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/**
 * 应用 `grants` 表（AuthZ MySQL 持久化）；须在 {@link applyMinimalMysqlSchema} 之后调用（独立库即可）。
 */
export async function applyGrantsMysqlSchema(mysqlUrl: string): Promise<void> {
  testInfraLog('Applying grants MySQL schema…');
  const sql = await readFile(fileURLToPath(grantsFixtureUrl), 'utf8');

  const maxAttempts = 30;
  const delayMs = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const conn = await mysql.createConnection({
        uri: mysqlUrl,
        multipleStatements: true,
      });
      try {
        await conn.query(sql);
        testInfraLog('Grants MySQL schema applied.');
        return;
      } finally {
        await conn.end();
      }
    } catch (e) {
      if (!isTransientMysqlConnectErr(e) || attempt === maxAttempts) throw e;
      testInfraLog(
        `applyGrantsMysqlSchema: transient error (attempt ${attempt}/${maxAttempts}), retry in ${delayMs}ms — ${e instanceof Error ? e.message : String(e)}`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function applySqlWithRetry(mysqlUrl: string, sql: string, label: string): Promise<void> {
  const maxAttempts = 30;
  const delayMs = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const conn = await mysql.createConnection({
        uri: mysqlUrl,
        multipleStatements: true,
      });
      try {
        await conn.query(sql);
        testInfraLog(`${label} applied.`);
        return;
      } finally {
        await conn.end();
      }
    } catch (e) {
      if (!isTransientMysqlConnectErr(e) || attempt === maxAttempts) throw e;
      testInfraLog(
        `${label}: transient error (attempt ${attempt}/${maxAttempts}), retry in ${delayMs}ms — ${e instanceof Error ? e.message : String(e)}`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function applyComposeInitSqlFile(mysqlUrl: string, fileName: string): Promise<void> {
  const root = findMonorepoRoot(fileURLToPath(new URL('.', import.meta.url)));
  const filePath = join(root, 'deploy/docker-compose/mysql/init', fileName);
  let sql = await readFile(filePath, 'utf8');
  sql = sql.replace(/^USE\s+[\w`]+\s*;\s*\n?/im, '');
  await applySqlWithRetry(mysqlUrl, sql, `Compose init ${fileName}`);
}

/**
 * flow / kb / llm-catalog 域表 + engine minimal schema，供 ai-center 集成测试。
 */
export async function applyAiCenterDomainMysqlSchemas(mysqlUrl: string): Promise<void> {
  await applyMinimalMysqlSchema(mysqlUrl);
  await applyGrantsMysqlSchema(mysqlUrl);
  for (const file of ['02-flow.sql', '03-llm-catalog.sql', '04-kb.sql'] as const) {
    await applyComposeInitSqlFile(mysqlUrl, file);
  }
}
