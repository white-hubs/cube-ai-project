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

/** `KB_MYSQL_URL`/`AGENTIC_ENGINE_MYSQL_URL`（mysql://…）作为离散 MYSQL_* 变量缺省时的回退来源（ADR-0013 单库）。 */
function parseMysqlUrlFromEnv(): Partial<KbMysqlConfig> {
  const raw =
    Bun.env.KB_MYSQL_URL ??
    process.env.KB_MYSQL_URL ??
    Bun.env.AGENTIC_ENGINE_MYSQL_URL ??
    process.env.AGENTIC_ENGINE_MYSQL_URL;
  if (raw === undefined || raw.trim() === '') return {};
  try {
    const u = new URL(raw.trim());
    return {
      host: u.hostname || undefined,
      port: u.port ? Number(u.port) : undefined,
      database: u.pathname.replace(/^\//, '') || undefined,
      user: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    return {};
  }
}

export function buildKbMysqlConfigFromEnv(): KbMysqlConfig {
  const fromUrl = parseMysqlUrlFromEnv();
  return {
    host: envString('MYSQL_HOST', fromUrl.host ?? '127.0.0.1'),
    port: envNumber('MYSQL_PORT', fromUrl.port ?? 3306),
    database: envString('MYSQL_DATABASE', envString('MYSQL_DB', fromUrl.database ?? 'cube_ai_center')),
    user: envString('MYSQL_USERNAME', envString('MYSQL_USER', fromUrl.user ?? 'root')),
    password: envString('MYSQL_PASSWORD', fromUrl.password ?? ''),
  };
}

/** 是否存在任何 kb MySQL 配置来源（离散变量或 URL）。 */
export function hasKbMysqlConfigFromEnv(): boolean {
  const candidates = ['MYSQL_HOST', 'KB_MYSQL_URL', 'AGENTIC_ENGINE_MYSQL_URL'] as const;
  return candidates.some((key) => {
    const raw = Bun.env[key] ?? process.env[key];
    return raw !== undefined && raw.trim() !== '';
  });
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
