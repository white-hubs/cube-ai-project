import { type DatabaseService } from "@dangao/bun-server";
import mysql, { type Pool } from "mysql2/promise";

export interface KbMysqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

function envString(key: string, fallback: string): string {
  const raw = Bun.env[key] ?? process.env[key];
  return raw !== undefined && raw.trim() !== "" ? raw.trim() : fallback;
}

function envNumber(key: string, fallback: number): number {
  const raw = Bun.env[key] ?? process.env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** `KB_MYSQL_URL`/`AGENTIC_ENGINE_MYSQL_URL`（mysql://…）作为离散 MYSQL_* 变量缺省时的回退来源（ADR-0013 单库）。 */
function parseMysqlUrlFromEnv(): Partial<KbMysqlConfig> {
  const raw = Bun.env.KB_MYSQL_URL ?? process.env.KB_MYSQL_URL ?? Bun.env.AGENTIC_ENGINE_MYSQL_URL ?? process.env.AGENTIC_ENGINE_MYSQL_URL;
  if (raw === undefined || raw.trim() === "") {
    return {};
  }
  try {
    const u = new URL(raw.trim());
    return {
      database: u.pathname.replace(/^\//u, "") || undefined,
      host: u.hostname || undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      port: u.port ? Number(u.port) : undefined,
      user: u.username ? decodeURIComponent(u.username) : undefined,
    };
  } catch {
    return {};
  }
}

export function buildKbMysqlConfigFromEnv(): KbMysqlConfig {
  const fromUrl = parseMysqlUrlFromEnv();
  return {
    database: envString("MYSQL_DATABASE", envString("MYSQL_DB", fromUrl.database ?? "cube_ai_center")),
    host: envString("MYSQL_HOST", fromUrl.host ?? "127.0.0.1"),
    password: envString("MYSQL_PASSWORD", fromUrl.password ?? ""),
    port: envNumber("MYSQL_PORT", fromUrl.port ?? 3306),
    user: envString("MYSQL_USERNAME", envString("MYSQL_USER", fromUrl.user ?? "root")),
  };
}

/** 是否存在任何 kb MySQL 配置来源（离散变量或 URL）。 */
export function hasKbMysqlConfigFromEnv(): boolean {
  const candidates = ["MYSQL_HOST", "KB_MYSQL_URL", "AGENTIC_ENGINE_MYSQL_URL"] as const;
  return candidates.some((key) => {
    const raw = Bun.env[key] ?? process.env[key];
    return raw !== undefined && raw.trim() !== "";
  });
}

/** Static mysql2 adapter for compiled Bun binaries (ADR-0013). */
export class KbMysqlDatabaseService {
  private pool: Pool | null = null;

  public constructor(private readonly config: KbMysqlConfig) {}

  public async initialize(): Promise<void> {
    if (this.pool) {
      return;
    }
    this.pool = mysql.createPool({
      bigNumberStrings: true,
      connectionLimit: 10,
      database: this.config.database,
      host: this.config.host,
      password: this.config.password,
      port: this.config.port,
      supportBigNumbers: true,
      timezone: "+08:00",
      user: this.config.user,
      waitForConnections: true,
    });
  }

  public async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.pool) {
      throw new Error("KB MySQL connection is not initialized");
    }
    const [rows] = await this.pool.query(sql, params);
    if (/^\s*(SELECT|SHOW|DESCRIBE|WITH)\b/iu.test(sql)) {
      return Array.isArray(rows) ? (rows as T[]) : [];
    }
    return [];
  }
}

export function createKbMysqlDatabaseServiceFromEnv(): DatabaseService {
  return new KbMysqlDatabaseService(buildKbMysqlConfigFromEnv()) as unknown as DatabaseService;
}
