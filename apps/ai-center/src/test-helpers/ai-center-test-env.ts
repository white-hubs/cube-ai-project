import { resetAppConfigCacheForTests } from "@cube-ai/ai-center/platform/server-base";
import { _resetAppConfigCache as resetKbAppConfigCache } from "@cube-ai/kb-core";

const ENV_KEYS = [
  "AGENTIC_ENGINE_SECRETS_SOURCE",
  "AGENTIC_ENGINE_MEMORY_KIND",
  "AGENTIC_ENGINE_PROVIDER",
  "AGENTIC_ENGINE_DESCRIPTOR_LOCAL_DIR",
  "AGENTIC_ENGINE_MYSQL_URL",
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_USER",
  "MYSQL_USERNAME",
  "MYSQL_PASSWORD",
  "MYSQL_DATABASE",
  "MYSQL_DB",
  "AGENTIC_ENGINE_REDIS_URL",
  "REDIS_URL",
  "CUBE_AI_MOCK",
  "CUBE_AI_MOCK_FLOWS",
  "USE_GHCLOUD_IDENTITY",
  "JWT_KEY_URL",
] as const;

export function snapshotAiCenterTestEnv(): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function applyMysqlUrlToEnv(mysqlUrl: string): void {
  const parsed = new URL(mysqlUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const host = parsed.hostname;
  const port = parsed.port || "3306";

  process.env.MYSQL_HOST = host;
  process.env.MYSQL_PORT = port;
  process.env.MYSQL_USER = user;
  process.env.MYSQL_USERNAME = user;
  process.env.MYSQL_PASSWORD = password;
  process.env.MYSQL_DATABASE = database;
  process.env.MYSQL_DB = database;
  process.env.AGENTIC_ENGINE_MYSQL_URL = mysqlUrl;
}

export interface AiCenterIntegrationTestEnv {
  mysqlUrl: string;
  redisUrl?: string;
}

/** Integration / e2e: MySQL + optional Redis (ADR-0013 — no SQLite). */
export function applyAiCenterIntegrationTestEnv(opts: AiCenterIntegrationTestEnv): void {
  process.env.AGENTIC_ENGINE_SECRETS_SOURCE = "env";
  process.env.AGENTIC_ENGINE_MEMORY_KIND = "in-memory";
  process.env.AGENTIC_ENGINE_PROVIDER = "noop";
  process.env.AGENTIC_ENGINE_DESCRIPTOR_LOCAL_DIR = "";
  // Opt-out of ghcloud identity for integration tests that don't supply a JWT key server.
  // Individual tests that need identity (e.g. identity-e2e.test.ts) must delete this and set JWT_KEY_URL.
  process.env.USE_GHCLOUD_IDENTITY = "0";
  applyMysqlUrlToEnv(opts.mysqlUrl);
  if (opts.redisUrl) {
    process.env.AGENTIC_ENGINE_REDIS_URL = opts.redisUrl;
    process.env.REDIS_URL = opts.redisUrl;
  } else {
    delete process.env.AGENTIC_ENGINE_REDIS_URL;
    delete process.env.REDIS_URL;
  }
  resetAppConfigCacheForTests();
  resetKbAppConfigCache();
}

/** @deprecated Use {@link applyAiCenterIntegrationTestEnv} with Testcontainers MySQL. */
export function applyAiCenterTestEnv(_sqlitePath: string): void {
  throw new Error("applyAiCenterTestEnv(sqlite) removed (ADR-0013). Use applyAiCenterIntegrationTestEnv({ mysqlUrl, redisUrl }).");
}

export function restoreAiCenterTestEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetAppConfigCacheForTests();
  resetKbAppConfigCache();
}
