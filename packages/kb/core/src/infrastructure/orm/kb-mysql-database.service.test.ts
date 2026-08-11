import { afterEach, describe, expect, test } from "bun:test";
import { type Pool } from "mysql2/promise";

import { KbMysqlDatabaseService, buildKbMysqlConfigFromEnv, hasKbMysqlConfigFromEnv } from "./kb-mysql-database.service";

const ENV_KEYS = [
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_DATABASE",
  "MYSQL_DB",
  "MYSQL_USERNAME",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "KB_MYSQL_URL",
  "AGENTIC_ENGINE_MYSQL_URL",
] as const;

const saved = new Map<string, string | undefined>();

function setEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) {
    if (!saved.has(key)) {
      saved.set(key, process.env[key]);
    }
    delete process.env[key];
    delete Bun.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of saved.entries()) {
    if (value === undefined) {
      delete process.env[key];
      delete Bun.env[key];
    } else {
      process.env[key] = value;
    }
  }
  saved.clear();
});

describe("buildKbMysqlConfigFromEnv", () => {
  test("falls back to AGENTIC_ENGINE_MYSQL_URL when discrete MYSQL_* are unset (engine standalone / testcontainers)", () => {
    setEnv({ AGENTIC_ENGINE_MYSQL_URL: "mysql://eng:s3cret@10.0.0.9:32768/cube_ai_center" });
    expect(buildKbMysqlConfigFromEnv()).toEqual({
      database: "cube_ai_center",
      host: "10.0.0.9",
      password: "s3cret",
      port: 32768,
      user: "eng",
    });
  });

  test("KB_MYSQL_URL takes precedence over AGENTIC_ENGINE_MYSQL_URL", () => {
    setEnv({
      AGENTIC_ENGINE_MYSQL_URL: "mysql://eng:engpw@eng-host:3306/agentic_engine",
      KB_MYSQL_URL: "mysql://kb:kbpw@kb-host:3307/kb_db",
    });
    const cfg = buildKbMysqlConfigFromEnv();
    expect(cfg.host).toBe("kb-host");
    expect(cfg.port).toBe(3307);
    expect(cfg.database).toBe("kb_db");
  });

  test("discrete MYSQL_* env vars override URL-derived values (compose convention)", () => {
    setEnv({
      AGENTIC_ENGINE_MYSQL_URL: "mysql://other:pw@elsewhere:9999/otherdb",
      MYSQL_HOST: "compose-mysql",
      MYSQL_PASSWORD: "dev",
      MYSQL_PORT: "3306",
      MYSQL_USERNAME: "agentic_engine",
    });
    const cfg = buildKbMysqlConfigFromEnv();
    expect(cfg.host).toBe("compose-mysql");
    expect(cfg.port).toBe(3306);
    expect(cfg.user).toBe("agentic_engine");
  });

  test("defaults apply when nothing configured", () => {
    setEnv({});
    expect(buildKbMysqlConfigFromEnv()).toEqual({
      database: "cube_ai_center",
      host: "127.0.0.1",
      password: "",
      port: 3306,
      user: "root",
    });
  });

  test("malformed URL is ignored, defaults apply", () => {
    setEnv({ AGENTIC_ENGINE_MYSQL_URL: "not-a-url" });
    const cfg = buildKbMysqlConfigFromEnv();
    expect(cfg.host).toBe("127.0.0.1");
  });
});

describe("hasKbMysqlConfigFromEnv", () => {
  test("false when no source configured", () => {
    setEnv({});
    expect(hasKbMysqlConfigFromEnv()).toBe(false);
  });

  test("true with AGENTIC_ENGINE_MYSQL_URL", () => {
    setEnv({ AGENTIC_ENGINE_MYSQL_URL: "mysql://u:p@h:3306/db" });
    expect(hasKbMysqlConfigFromEnv()).toBe(true);
  });

  test("true with MYSQL_HOST", () => {
    setEnv({ MYSQL_HOST: "somewhere" });
    expect(hasKbMysqlConfigFromEnv()).toBe(true);
  });
});

class FakeMysqlConnection {
  public beginCalls = 0;
  public commitCalls = 0;
  public queryCalls: string[] = [];
  public releaseCalls = 0;
  public rollbackCalls = 0;

  public async beginTransaction(): Promise<void> {
    this.beginCalls += 1;
  }

  public async commit(): Promise<void> {
    this.commitCalls += 1;
  }

  public async query(sql: string): Promise<[unknown[], unknown[]]> {
    this.queryCalls.push(sql);
    return [[{ executor: "connection" }], []];
  }

  public release(): void {
    this.releaseCalls += 1;
  }

  public async rollback(): Promise<void> {
    this.rollbackCalls += 1;
  }
}

class FakeMysqlPool {
  public readonly connection = new FakeMysqlConnection();
  public getConnectionCalls = 0;
  public queryCalls: string[] = [];

  public async getConnection(): Promise<FakeMysqlConnection> {
    this.getConnectionCalls += 1;
    return this.connection;
  }

  public async query(sql: string): Promise<[unknown[], unknown[]]> {
    this.queryCalls.push(sql);
    return [[{ executor: "pool" }], []];
  }
}

function createTransactionTestService(pool: FakeMysqlPool): KbMysqlDatabaseService {
  return new KbMysqlDatabaseService(
    { database: "test", host: "127.0.0.1", password: "", port: 3306, user: "root" },
    pool as unknown as Pool,
  );
}

describe("KbMysqlDatabaseService transactions", () => {
  test("uses one acquired connection for every query in the transaction and commits", async () => {
    const pool = new FakeMysqlPool();
    const service = createTransactionTestService(pool);

    const result = await service.runInTransaction(async () => {
      const rows = await service.query<{ executor: string }>("SELECT 1");
      await service.query("UPDATE document_record SET status = ?", ["parsing"]);
      return rows[0]?.executor;
    });

    expect(result).toBe("connection");
    expect(pool.queryCalls).toEqual([]);
    expect(pool.connection.queryCalls).toEqual(["SELECT 1", "UPDATE document_record SET status = ?"]);
    expect(pool.getConnectionCalls).toBe(1);
    expect(pool.connection.beginCalls).toBe(1);
    expect(pool.connection.commitCalls).toBe(1);
    expect(pool.connection.rollbackCalls).toBe(0);
    expect(pool.connection.releaseCalls).toBe(1);
  });

  test("rolls back and releases the connection when work fails", async () => {
    const pool = new FakeMysqlPool();
    const service = createTransactionTestService(pool);

    await expect(
      service.runInTransaction(async () => {
        await service.query("INSERT INTO import_job (id) VALUES (?)", ["202"]);
        throw new Error("outbox insert failed");
      }),
    ).rejects.toThrow("outbox insert failed");

    expect(pool.connection.commitCalls).toBe(0);
    expect(pool.connection.rollbackCalls).toBe(1);
    expect(pool.connection.releaseCalls).toBe(1);
  });

  test("nested transaction scopes join the active connection", async () => {
    const pool = new FakeMysqlPool();
    const service = createTransactionTestService(pool);

    await service.runInTransaction(async () => {
      await service.runInTransaction(async () => {
        await service.query("SELECT nested");
      });
    });

    expect(pool.getConnectionCalls).toBe(1);
    expect(pool.connection.beginCalls).toBe(1);
    expect(pool.connection.commitCalls).toBe(1);
    expect(pool.connection.queryCalls).toEqual(["SELECT nested"]);
  });

  test("queries outside a transaction continue to use the pool", async () => {
    const pool = new FakeMysqlPool();
    const service = createTransactionTestService(pool);

    const rows = await service.query<{ executor: string }>("SELECT outside");

    expect(rows[0]?.executor).toBe("pool");
    expect(pool.queryCalls).toEqual(["SELECT outside"]);
    expect(pool.getConnectionCalls).toBe(0);
  });
});
