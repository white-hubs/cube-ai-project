import mysql, { type Connection } from 'mysql2/promise';
import type { DatabaseService } from '@dangao/bun-server';

export interface KbMysqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

function envString(key: string, fallback: string): string {
  const raw = Bun.env[key] ?? process.env[key];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : fallback;
}

function envNumber(key: string, fallback: number): number {
  const raw = Bun.env[key] ?? process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function buildKbMysqlConfigFromEnv(): KbMysqlConfig {
  return {
    host: envString('MYSQL_HOST', '127.0.0.1'),
    port: envNumber('MYSQL_PORT', 3306),
    database: envString('MYSQL_DATABASE', envString('MYSQL_DB', 'agentic_engine')),
    user: envString('MYSQL_USERNAME', envString('MYSQL_USER', 'root')),
    password: envString('MYSQL_PASSWORD', ''),
  };
}

/** Static mysql2 adapter for compiled Bun binaries (ADR-0013). */
export class KbMysqlDatabaseService {
  private connection: Connection | null = null;

  public constructor(private readonly config: KbMysqlConfig) {}

  public async initialize(): Promise<void> {
    if (this.connection) return;
    this.connection = await mysql.createConnection({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    await this.connection.query("SET time_zone = '+08:00'");
  }

  public async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.connection) {
      throw new Error('KB MySQL connection is not initialized');
    }
    const [rows] = await this.connection.query(sql, params);
    if (/^\s*(SELECT|SHOW|DESCRIBE|WITH)\b/i.test(sql)) {
      return Array.isArray(rows) ? (rows as T[]) : [];
    }
    return [];
  }
}

export function createKbMysqlDatabaseServiceFromEnv(): DatabaseService {
  return new KbMysqlDatabaseService(buildKbMysqlConfigFromEnv()) as unknown as DatabaseService;
}
