import { type DatabaseService } from "@dangao/bun-server";
import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import { AsyncLocalStorage } from "node:async_hooks";

export interface KbMysqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** Transaction boundary implemented by the same mysql2 connection used by KB repositories. */
export interface KbTransactionRunner {
  runInTransaction<T>(work: () => Promise<T>): Promise<T>;
}

export type KbTransactionalDatabaseService = DatabaseService & KbTransactionRunner;

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
export class KbMysqlDatabaseService implements KbTransactionRunner {
  private readonly transactionConnection = new AsyncLocalStorage<PoolConnection>();

  public constructor(
    private readonly config: KbMysqlConfig,
    private pool: Pool | null = null,
  ) {}

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
    const executor = this.transactionConnection.getStore() ?? this.pool;
    const [rows] = await executor.query(sql, params);
    if (/^\s*(SELECT|SHOW|DESCRIBE|WITH)\b/iu.test(sql)) {
      return Array.isArray(rows) ? (rows as T[]) : [];
    }
    return [];
  }

  /**
   * Run all KB queries in `work` on one mysql2 connection.
   * Nested calls join the active transaction (REQUIRED semantics).
   */
  public async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error("KB MySQL connection is not initialized");
    }
    if (this.transactionConnection.getStore()) {
      return work();
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await this.transactionConnection.run(connection, work);
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original failure; connection release below prevents pool exhaustion.
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}

export function createKbMysqlDatabaseServiceFromEnv(): KbTransactionalDatabaseService {
  return new KbMysqlDatabaseService(buildKbMysqlConfigFromEnv()) as unknown as KbTransactionalDatabaseService;
}
