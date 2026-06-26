import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resetAppConfigCacheForTests, loadAppConfig, resolveConfigPathFrom } from "./app.config";

const tempDirs: string[] = [];

beforeEach(() => {
  resetAppConfigCacheForTests();
});

afterEach(async () => {
  resetAppConfigCacheForTests();
  await Promise.all(
    tempDirs.splice(0).map(async (dirPath) => {
      await rm(dirPath, { recursive: true, force: true });
    }),
  );
});

describe("resolveConfigPathFrom", () => {
  test("finds app.json from entry script path when cwd is workspace root", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "ai-server-base-config-"));
    tempDirs.push(rootDir);

    const workspaceRoot = path.join(rootDir, "workspace");
    const serviceSrcDir = path.join(workspaceRoot, "prod", "cube-services", "ai-server", "src");
    const configDir = path.join(workspaceRoot, "prod", "cube-services", "ai-server", "config");
    const configPath = path.join(configDir, "app.json");

    await mkdir(serviceSrcDir, { recursive: true });
    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, '{"port":3210}', "utf8");

    const resolved = await resolveConfigPathFrom([workspaceRoot, serviceSrcDir]);

    expect(resolved).toBe(configPath);
  });
});

describe("loadAppConfig", () => {
  test("uses multimodal embedding model as the default embeddingModel", async () => {
    const originalAppConfigPath = process.env.APP_CONFIG_PATH;
    const originalEmbeddingModel = process.env.EMBEDDING_MODEL;

    delete process.env.APP_CONFIG_PATH;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.CUBE_LOCAL_DEV;

    try {
      const config = await loadAppConfig();
      expect(config.embeddingModel).toBe("doubao-embedding-vision-251215");
      expect(config.localDev).toBe(false);
      expect(config.paths.sqlitePath).toContain("cube-ai.sqlite");
      expect(config.paths.componentCatalogPath).toBe("/app/data/cube-component-catalog.json");
    } finally {
      if (originalAppConfigPath === undefined) {
        delete process.env.APP_CONFIG_PATH;
      } else {
        process.env.APP_CONFIG_PATH = originalAppConfigPath;
      }

      if (originalEmbeddingModel === undefined) {
        delete process.env.EMBEDDING_MODEL;
      } else {
        process.env.EMBEDDING_MODEL = originalEmbeddingModel;
      }
    }
  });

  test("CUBE_LOCAL_DEV enables localDev flag", async () => {
    const originalAppConfigPath = process.env.APP_CONFIG_PATH;
    const originalLocalDev = process.env.CUBE_LOCAL_DEV;

    delete process.env.APP_CONFIG_PATH;
    process.env.CUBE_LOCAL_DEV = "1";

    try {
      const config = await loadAppConfig();
      expect(config.localDev).toBe(true);
    } finally {
      if (originalAppConfigPath === undefined) {
        delete process.env.APP_CONFIG_PATH;
      } else {
        process.env.APP_CONFIG_PATH = originalAppConfigPath;
      }
      if (originalLocalDev === undefined) {
        delete process.env.CUBE_LOCAL_DEV;
      } else {
        process.env.CUBE_LOCAL_DEV = originalLocalDev;
      }
    }
  });

  test("JSON file config takes priority over environment variable", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "ai-config-priority-"));
    tempDirs.push(rootDir);
    const configDir = path.join(rootDir, "config");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "app.json"), JSON.stringify({ mysqlHost: "from-json-file" }), "utf8");
    const originalConfigPath = process.env.APP_CONFIG_PATH;
    const originalMysqlHost = process.env.MYSQL_HOST;
    process.env.APP_CONFIG_PATH = path.join(configDir, "app.json");
    process.env.MYSQL_HOST = "from-env-var";

    try {
      const config = await loadAppConfig();
      expect(config.mysqlHost).toBe("from-json-file");
    } finally {
      if (originalConfigPath === undefined) {
        delete process.env.APP_CONFIG_PATH;
      } else {
        process.env.APP_CONFIG_PATH = originalConfigPath;
      }
      if (originalMysqlHost === undefined) {
        delete process.env.MYSQL_HOST;
      } else {
        process.env.MYSQL_HOST = originalMysqlHost;
      }
    }
  });

  test("JSON file localDev takes priority over CUBE_LOCAL_DEV env var", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "ai-config-localdev-"));
    tempDirs.push(rootDir);
    const configDir = path.join(rootDir, "config");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "app.json"), JSON.stringify({ localDev: false }), "utf8");
    const originalConfigPath = process.env.APP_CONFIG_PATH;
    const originalLocalDev = process.env.CUBE_LOCAL_DEV;
    process.env.APP_CONFIG_PATH = path.join(configDir, "app.json");
    process.env.CUBE_LOCAL_DEV = "1";

    try {
      const config = await loadAppConfig();
      expect(config.localDev).toBe(false);
    } finally {
      if (originalConfigPath === undefined) {
        delete process.env.APP_CONFIG_PATH;
      } else {
        process.env.APP_CONFIG_PATH = originalConfigPath;
      }
      if (originalLocalDev === undefined) {
        delete process.env.CUBE_LOCAL_DEV;
      } else {
        process.env.CUBE_LOCAL_DEV = originalLocalDev;
      }
    }
  });

  test("new fields have correct defaults", async () => {
    const originalAppConfigPath = process.env.APP_CONFIG_PATH;
    delete process.env.APP_CONFIG_PATH;
    delete process.env.CUBE_SUPER_ADMIN_USERNAME;
    delete process.env.CUBE_SUPER_ADMIN_PASSWORD;
    delete process.env.CUBE_AI_BUILTIN_SYSTEM_API_KEY;
    delete process.env.CUBE_DEV_API_RATE_LIMIT_PER_MIN;
    delete process.env.CUBE_SERVER_IDLE_TIMEOUT_MS;
    delete process.env.OTEL_SERVICE_NAME;

    try {
      const config = await loadAppConfig();
      expect(config.superAdminUsername).toBe("admin");
      expect(config.superAdminPassword).toBe("ChangeMe123!");
      expect(config.builtinSystemApiKey).toBe("sk_cube_builtin_system_ChangeMeInProduction");
      expect(config.devApiRateLimitPerMin).toBe(60);
      expect(config.serverIdleTimeoutMs).toBe(240000);
      expect(config.otelServiceName).toBe("cube-ai");
      expect(config.webhookHmacSecret).toBeUndefined();
      expect(config.otelExporterOtlpEndpoint).toBeUndefined();
    } finally {
      if (originalAppConfigPath === undefined) {
        delete process.env.APP_CONFIG_PATH;
      } else {
        process.env.APP_CONFIG_PATH = originalAppConfigPath;
      }
    }
  });

  test("CUBE_SERVER_IDLE_TIMEOUT_MS overrides request idle timeout", async () => {
    const originalAppConfigPath = process.env.APP_CONFIG_PATH;
    const originalIdleTimeout = process.env.CUBE_SERVER_IDLE_TIMEOUT_MS;

    delete process.env.APP_CONFIG_PATH;
    process.env.CUBE_SERVER_IDLE_TIMEOUT_MS = "180000";

    try {
      const config = await loadAppConfig();
      expect(config.serverIdleTimeoutMs).toBe(180000);
    } finally {
      if (originalAppConfigPath === undefined) {
        delete process.env.APP_CONFIG_PATH;
      } else {
        process.env.APP_CONFIG_PATH = originalAppConfigPath;
      }
      if (originalIdleTimeout === undefined) {
        delete process.env.CUBE_SERVER_IDLE_TIMEOUT_MS;
      } else {
        process.env.CUBE_SERVER_IDLE_TIMEOUT_MS = originalIdleTimeout;
      }
    }
  });

  test("server idle timeout is clamped to Bun maximum", async () => {
    const originalAppConfigPath = process.env.APP_CONFIG_PATH;
    const originalIdleTimeout = process.env.CUBE_SERVER_IDLE_TIMEOUT_MS;

    delete process.env.APP_CONFIG_PATH;
    process.env.CUBE_SERVER_IDLE_TIMEOUT_MS = "300000";

    try {
      const config = await loadAppConfig();
      expect(config.serverIdleTimeoutMs).toBe(255000);
    } finally {
      if (originalAppConfigPath === undefined) {
        delete process.env.APP_CONFIG_PATH;
      } else {
        process.env.APP_CONFIG_PATH = originalAppConfigPath;
      }
      if (originalIdleTimeout === undefined) {
        delete process.env.CUBE_SERVER_IDLE_TIMEOUT_MS;
      } else {
        process.env.CUBE_SERVER_IDLE_TIMEOUT_MS = originalIdleTimeout;
      }
    }
  });

  test("grpcPort defaults to 3110 and registerGrpcPort falls back to grpcPort", async () => {
    resetAppConfigCacheForTests();
    delete process.env.AI_CENTER_GRPC_PORT;
    delete process.env.AGENTIC_ENGINE_GRPC_PORT;
    delete process.env.AI_CENTER_REGISTER_GRPC_PORT;
    const cfg = await loadAppConfig();
    expect(cfg.grpcPort).toBe(3110);
    expect(cfg.registerGrpcPort).toBe(3110);
  });

  test("AI_CENTER_GRPC_PORT overrides and registerGrpcPort can split", async () => {
    resetAppConfigCacheForTests();
    process.env.AI_CENTER_GRPC_PORT = "3211";
    process.env.AI_CENTER_REGISTER_GRPC_PORT = "3110";
    const cfg = await loadAppConfig();
    expect(cfg.grpcPort).toBe(3211);
    expect(cfg.registerGrpcPort).toBe(3110);
    resetAppConfigCacheForTests();
    delete process.env.AI_CENTER_GRPC_PORT;
    delete process.env.AI_CENTER_REGISTER_GRPC_PORT;
  });
});
