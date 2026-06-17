import mysql from 'mysql2/promise';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface MigrationRunnerOpts {
  /** mysql2-compatible connection URL, e.g. mysql://user:pass@host:3306/db */
  mysqlUrl: string;
  /** Absolute path to the domain's migrations/ directory. */
  migrationsDir: string;
  /** Name of the history table to create in the database, e.g. 'engine_schema_migrations'. */
  historyTable: string;
}

function versionFromFilename(filename: string): string {
  return filename.split('__')[0].slice(1);
}

function sortByVersion(files: string[]): string[] {
  return [...files].sort((a, b) => {
    const va = versionFromFilename(a).padStart(10, '0');
    const vb = versionFromFilename(b).padStart(10, '0');
    return va.localeCompare(vb);
  });
}

async function listMigrationFiles(dir: string, prefix: 'V' | 'S'): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    // 目录不存在时抛出，而非静默跳过——路径错误会导致迁移完全不运行且无任何提示
    throw new Error(
      `[mysql-migration] migrations directory not found: ${dir}\n${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return sortByVersion(entries.filter((f) => f.startsWith(prefix) && f.endsWith('.sql')));
}

/**
 * 整文件交给 MySQL 执行（连接已开 multipleStatements），不在客户端做语句切分——
 * 正则切分对存储过程 / 触发器 / 字符串内 `;` 不可靠。
 */
async function execSql(conn: mysql.Connection, sql: string): Promise<void> {
  if (!sql.trim()) return;
  await conn.query(sql);
}

export function createMigrationRunner(opts: MigrationRunnerOpts): { run(): Promise<void> } {
  const { mysqlUrl, migrationsDir, historyTable } = opts;

  return {
    async run(): Promise<void> {
      const conn = await mysql.createConnection({ uri: mysqlUrl, multipleStatements: true });
      try {
        await conn.query(`
          CREATE TABLE IF NOT EXISTS \`${historyTable}\` (
            \`version\` VARCHAR(64) NOT NULL,
            \`filename\` VARCHAR(255) NOT NULL,
            \`applied_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (\`version\`)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const [appliedRows] = await conn.query<mysql.RowDataPacket[]>(
          `SELECT version FROM \`${historyTable}\``,
        );
        const applied = new Set(appliedRows.map((r) => String(r.version)));

        const vFiles = await listMigrationFiles(migrationsDir, 'V');
        for (const filename of vFiles) {
          const version = versionFromFilename(filename);
          if (applied.has(version)) continue;

          const sql = await readFile(join(migrationsDir, filename), 'utf8');
          try {
            await execSql(conn, sql);
          } catch (err) {
            throw new Error(
              `[mysql-migration] V migration failed: ${filename}\n${err instanceof Error ? err.message : String(err)}`,
            );
          }
          await conn.query(
            `INSERT INTO \`${historyTable}\` (version, filename) VALUES (?, ?)`,
            [version, filename],
          );
        }

        const sFiles = await listMigrationFiles(migrationsDir, 'S');
        for (const filename of sFiles) {
          const sql = await readFile(join(migrationsDir, filename), 'utf8');
          try {
            await execSql(conn, sql);
          } catch (err) {
            throw new Error(
              `[mysql-migration] S migration failed: ${filename}\n${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      } finally {
        await conn.end();
      }
    },
  };
}
