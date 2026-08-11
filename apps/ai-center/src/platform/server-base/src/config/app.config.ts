import path from "node:path";

/** 运行时可变文件路径（环境变量 / app.json / 默认值） */
export interface AppPaths {
  /** Langflow 组件注册表离线快照 JSON */
  langflowApiAllPath: string;
  /** 已生成的 cube 组件目录 JSON */
  componentCatalogPath: string;
  /** SQLite 数据库文件（localDev 或 flow 模块使用） */
  sqlitePath: string;
}

/**
 * 应用配置
 */
export interface AppConfig {
  name: string;
  port: number;
  /** 对外 gRPC 服务面监听端口（平台服务间调用，ADR-0028）。 */
  grpcPort: number;
  /** 注册到 Nacos 时广播的 gRPC 端口；未配置回退到 grpcPort。 */
  registerGrpcPort: number;
  /** Feign 内部调用签名校验密钥；为空则跳过 feign_inner_invoke 校验。 */
  internalInvokeSecretKey?: string;
  hostname?: string;
  /** Bun HTTP 连接空闲超时（毫秒）。大文件上传时需高于默认 10s。 */
  serverIdleTimeoutMs: number;
  /**
   * 为 true 时：bootstrap 使用本地 SQLite 占位库、空服务注册。
   * 由环境变量 `CUBE_LOCAL_DEV` 或配置文件 `localDev` 开启。
   */
  localDev: boolean;
  mysqlHost: string;
  mysqlPort: number;
  mysqlDatabase: string;
  mysqlUsername: string;
  mysqlPassword: string;
  langflowBaseUrl?: string;
  langflowApiKey?: string;
  langflowBearerToken?: string;
  /**
   * 本服务自身的对外基址（Langflow 运行时回调本 ai-center 时使用，如 flow-studio 编译出的
   * knowledge-retrieval 节点 `api_url = {selfBaseUrl}/kb/search/by-documents`）。环境变量 CUBE_SELF_BASE_URL。
   */
  selfBaseUrl?: string;
  qdrantBaseUrl: string;
  qdrantApiKey?: string;
  qdrantCollectionName: string;
  qdrantVectorSize: number;
  embeddingBaseUrl: string;
  embeddingApiKey: string;
  embeddingModel: string;
  retrievalScoreThreshold: number;
  retrievalPrefetchTopK: number;
  retrievalRerankEnabled: boolean;
  retrievalMaxQueryLength: number;
  doclingBaseUrl: string;
  doclingApiKey?: string;
  doclingTimeoutMs: number;
  doclingEnablePictureDescription: boolean;
  ingestionChunkSize: number;
  ingestionChunkOverlap: number;
  /** MinIO（S3 兼容）API 地址，如 http://127.0.0.1:9000 */
  minioEndpoint: string;
  minioAccessKey: string;
  minioSecretKey: string;
  /** 知识库文档对象所在存储桶 */
  minioKbBucket: string;
  /** S3 region，MinIO 无 region 概念时填 us-east-1 即可 */
  minioRegion: string;
  /** 是否路径风格访问（MinIO 一般为 true） */
  minioUsePathStyle: boolean;
  /** 内置超级管理员用户名（首次初始化 SQLite 时种子） */
  superAdminUsername: string;
  /** 内置超级管理员密码（首次初始化 SQLite 时种子，生产环境务必覆盖） */
  superAdminPassword: string;
  /** 内置系统级 API Key 明文（生产环境务必覆盖） */
  builtinSystemApiKey: string;
  /** Webhook HMAC 签名密钥（不设则跳过签名校验） */
  webhookHmacSecret?: string;
  /** 开发者 API 限流（每分钟请求数，适用于 /run/* /webhook/*） */
  devApiRateLimitPerMin: number;
  /** OTLP HTTP trace 导出端点（设置后自动启用 OpenTelemetry） */
  otelExporterOtlpEndpoint?: string;
  /** OpenTelemetry service.name */
  otelServiceName: string;
  paths: AppPaths;
}

export interface AppConfigFile {
  /** 应用名（可选）；也可用环境变量 APP_NAME 或命令行 --app-name */
  name?: string;
  port?: number;
  grpcPort?: number;
  registerGrpcPort?: number;
  internalInvokeSecretKey?: string;
  hostname?: string;
  serverIdleTimeoutMs?: number;
  localDev?: boolean;
  mysqlHost?: string;
  mysqlPort?: number;
  mysqlDatabase?: string;
  mysqlUsername?: string;
  mysqlPassword?: string;
  langflowBaseUrl?: string;
  langflowApiKey?: string;
  langflowBearerToken?: string;
  selfBaseUrl?: string;
  qdrantBaseUrl?: string;
  qdrantApiKey?: string;
  qdrantCollectionName?: string;
  qdrantVectorSize?: number;
  embeddingBaseUrl?: string;
  embeddingApiKey?: string;
  embeddingModel?: string;
  retrievalScoreThreshold?: number;
  retrievalPrefetchTopK?: number;
  retrievalRerankEnabled?: boolean;
  retrievalMaxQueryLength?: number;
  doclingBaseUrl?: string;
  doclingApiKey?: string;
  doclingTimeoutMs?: number;
  doclingEnablePictureDescription?: boolean;
  ingestionChunkSize?: number;
  ingestionChunkOverlap?: number;
  minioEndpoint?: string;
  minioAccessKey?: string;
  minioSecretKey?: string;
  minioKbBucket?: string;
  minioRegion?: string;
  minioUsePathStyle?: boolean;
  superAdminUsername?: string;
  superAdminPassword?: string;
  builtinSystemApiKey?: string;
  webhookHmacSecret?: string;
  devApiRateLimitPerMin?: number;
  otelExporterOtlpEndpoint?: string;
  otelServiceName?: string;
  paths?: {
    langflowApiAllPath?: string;
    componentCatalogPath?: string;
    sqlitePath?: string;
  };
}

/** DI 注入令牌，用于向服务注入已解析的 AppConfig */
export const APP_CONFIG_TOKEN = Symbol("AppConfig");

/** 仅供测试使用：重置记忆化缓存，使下次 loadAppConfig() 重新读取配置 */
export function resetAppConfigCacheForTests(): void {
  cachedAppConfig = null;
}

let cachedAppConfig: AppConfig | null = null;

const DEFAULT_SERVER_IDLE_TIMEOUT_MS = 240000;
const MAX_BUN_SERVER_IDLE_TIMEOUT_MS = 255000;

function resolveServerIdleTimeoutMs(fileConfig: AppConfigFile): number {
  const raw =
    getCliArg("server-idle-timeout-ms") ??
    (fileConfig.serverIdleTimeoutMs !== undefined ? String(fileConfig.serverIdleTimeoutMs) : null) ??
    process.env.CUBE_SERVER_IDLE_TIMEOUT_MS?.trim() ??
    String(DEFAULT_SERVER_IDLE_TIMEOUT_MS);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_SERVER_IDLE_TIMEOUT_MS;
  return Math.min(Math.floor(parsed), MAX_BUN_SERVER_IDLE_TIMEOUT_MS);
}

function resolvePaths(file: AppConfigFile): AppPaths {
  const DATA_DIR = "/app/data";
  return {
    langflowApiAllPath:
      file.paths?.langflowApiAllPath?.trim() ||
      process.env.CUBE_LANGFLOW_API_ALL_PATH?.trim() ||
      process.env.LANGFLOW_API_ALL_PATH?.trim() ||
      `${DATA_DIR}/langflow-api-all.json`,

    componentCatalogPath:
      file.paths?.componentCatalogPath?.trim() ||
      process.env.CUBE_COMPONENT_CATALOG_PATH?.trim() ||
      `${DATA_DIR}/cube-component-catalog.json`,

    sqlitePath:
      file.paths?.sqlitePath?.trim() ||
      process.env.CUBE_AI_SQLITE_PATH?.trim() ||
      process.env.CUBE_LOCAL_SQLITE_PATH?.trim() ||
      `${DATA_DIR}/cube-ai.sqlite`,
  };
}

function getCliArg(name: string): string | undefined {
  const argv = (typeof Bun !== "undefined" ? Bun.argv : process.argv).slice(2).map((value) => String(value ?? ""));

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg.startsWith(`--${name}=`)) {
      return arg.substring(name.length + 3);
    }
    if (arg === `--${name}` && index + 1 < argv.length) {
      return argv[index + 1];
    }
  }

  return undefined;
}

async function searchConfigUpward(startDir: string): Promise<string | null> {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, "config", "app.json");
    if (await Bun.file(candidate).exists()) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function getEntryScriptDir(): string | null {
  const entry = process.argv[1];
  if (!entry) {
    return null;
  }

  const resolvedEntry = path.isAbsolute(entry) ? entry : path.resolve(process.cwd(), entry);
  return path.dirname(resolvedEntry);
}

export async function resolveConfigPathFrom(searchRoots: string[]): Promise<string | null> {
  const dedupedRoots = Array.from(new Set(searchRoots.map((root) => root.trim()).filter((root) => root !== "")));

  for (const root of dedupedRoots) {
    const resolved = await searchConfigUpward(root);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

async function resolveDefaultConfigPath(): Promise<string | null> {
  return resolveConfigPathFrom([process.cwd(), getEntryScriptDir() ?? ""]);
}

function parseLocalDevFlag(fileValue: boolean | undefined, envValue: string | undefined): boolean {
  if (fileValue !== undefined) return fileValue === true;
  if (envValue !== undefined && envValue.trim() !== "") {
    const normalized = envValue.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
}

async function loadConfigFile(): Promise<AppConfigFile> {
  const configPath = process.env.APP_CONFIG_PATH ?? (await resolveDefaultConfigPath());
  if (!configPath) {
    return {};
  }
  try {
    const file = Bun.file(configPath);
    const text = await file.text();
    const data = JSON.parse(text) as AppConfigFile;
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}

/**
 * Resolve only the Bun HTTP idle timeout before the application/container exists.
 * The complete config remains lazy so Nacos may load credentials before loadAppConfig().
 */
export async function loadServerIdleTimeoutMs(): Promise<number> {
  return resolveServerIdleTimeoutMs(await loadConfigFile());
}

async function resolveAppConfigUncached(): Promise<AppConfig> {
  const fileConfig = await loadConfigFile();

  const cliAppName = getCliArg("app-name");
  const cliPort = getCliArg("port");
  const cliHostname = getCliArg("hostname");
  const cliMysqlHost = getCliArg("mysql-host");
  const cliMysqlPort = getCliArg("mysql-port");
  const cliMysqlDb = getCliArg("mysql-database");
  const cliMysqlUser = getCliArg("mysql-username");
  const cliMysqlPwd = getCliArg("mysql-password");
  const cliLangflowUrl = getCliArg("langflow-base-url");
  const cliLangflowKey = getCliArg("langflow-api-key");
  const cliLangflowBearerToken = getCliArg("langflow-bearer-token");
  const cliQdrantBaseUrl = getCliArg("qdrant-base-url");
  const cliQdrantApiKey = getCliArg("qdrant-api-key");
  const cliQdrantCollectionName = getCliArg("qdrant-collection-name");
  const cliQdrantVectorSize = getCliArg("qdrant-vector-size");
  const cliEmbeddingBaseUrl = getCliArg("embedding-base-url");
  const cliEmbeddingApiKey = getCliArg("embedding-api-key");
  const cliEmbeddingModel = getCliArg("embedding-model");
  const cliRetrievalScoreThreshold = getCliArg("retrieval-score-threshold");
  const cliRetrievalPrefetchTopK = getCliArg("retrieval-prefetch-top-k");
  const cliRetrievalRerankEnabled = getCliArg("retrieval-rerank-enabled");
  const cliRetrievalMaxQueryLength = getCliArg("retrieval-max-query-length");
  const cliDoclingBaseUrl = getCliArg("docling-base-url");
  const cliDoclingApiKey = getCliArg("docling-api-key");
  const cliDoclingTimeoutMs = getCliArg("docling-timeout-ms");
  const cliDoclingEnablePictureDescription = getCliArg("docling-enable-picture-description");
  const cliIngestionChunkSize = getCliArg("ingestion-chunk-size");
  const cliIngestionChunkOverlap = getCliArg("ingestion-chunk-overlap");
  const cliMinioEndpoint = getCliArg("minio-endpoint");
  const cliMinioAccessKey = getCliArg("minio-access-key");
  const cliMinioSecretKey = getCliArg("minio-secret-key");
  const cliMinioKbBucket = getCliArg("minio-kb-bucket");
  const cliMinioRegion = getCliArg("minio-region");
  const cliMinioUsePathStyle = getCliArg("minio-use-path-style");
  const cliSuperAdminUsername = getCliArg("super-admin-username");
  const cliSuperAdminPassword = getCliArg("super-admin-password");
  const cliBuiltinSystemApiKey = getCliArg("builtin-system-api-key");
  const cliWebhookHmacSecret = getCliArg("webhook-hmac-secret");
  const cliDevApiRateLimitPerMin = getCliArg("dev-api-rate-limit-per-min");
  const cliOtelExporterOtlpEndpoint = getCliArg("otel-exporter-otlp-endpoint");
  const cliOtelServiceName = getCliArg("otel-service-name");

  // 优先级：CLI > JSON 文件 > 环境变量 > 内置默认值
  const name = cliAppName?.trim() || fileConfig.name?.trim() || process.env.APP_NAME?.trim() || "@cube-ai/bootstrap";
  const portStr = cliPort ?? (fileConfig.port !== undefined ? String(fileConfig.port) : null) ?? process.env.PORT ?? "3210";
  const hostname = cliHostname ?? fileConfig.hostname ?? process.env.HOSTNAME ?? "0.0.0.0";
  const serverIdleTimeoutMs = resolveServerIdleTimeoutMs(fileConfig);
  const mysqlHost = cliMysqlHost ?? fileConfig.mysqlHost ?? process.env.MYSQL_HOST ?? "localhost";
  const mysqlPortStr =
    cliMysqlPort ?? (fileConfig.mysqlPort !== undefined ? String(fileConfig.mysqlPort) : null) ?? process.env.MYSQL_PORT ?? "3306";
  const mysqlDatabase = cliMysqlDb ?? fileConfig.mysqlDatabase ?? process.env.MYSQL_DATABASE ?? "cube_ai_center";
  const mysqlUsername = cliMysqlUser ?? fileConfig.mysqlUsername ?? process.env.MYSQL_USERNAME ?? "root";
  const mysqlPassword = cliMysqlPwd ?? fileConfig.mysqlPassword ?? process.env.MYSQL_PASSWORD ?? "";
  const langflowBaseUrl = cliLangflowUrl ?? fileConfig.langflowBaseUrl ?? process.env.LANGFLOW_BASE_URL ?? undefined;
  const langflowApiKey = cliLangflowKey ?? fileConfig.langflowApiKey ?? process.env.LANGFLOW_API_KEY ?? undefined;
  const langflowBearerToken = cliLangflowBearerToken ?? fileConfig.langflowBearerToken ?? process.env.LANGFLOW_BEARER_TOKEN ?? undefined;
  const selfBaseUrl = getCliArg("self-base-url") ?? fileConfig.selfBaseUrl ?? process.env.CUBE_SELF_BASE_URL?.trim() ?? undefined;
  const qdrantBaseUrl = cliQdrantBaseUrl ?? fileConfig.qdrantBaseUrl ?? process.env.QDRANT_BASE_URL ?? "http://127.0.0.1:6333";
  const qdrantApiKey = cliQdrantApiKey ?? fileConfig.qdrantApiKey ?? process.env.QDRANT_API_KEY ?? undefined;
  const qdrantCollectionName =
    cliQdrantCollectionName ?? fileConfig.qdrantCollectionName ?? process.env.QDRANT_COLLECTION_NAME ?? "ai_server_documents";
  const qdrantVectorSizeStr =
    cliQdrantVectorSize ??
    (fileConfig.qdrantVectorSize !== undefined ? String(fileConfig.qdrantVectorSize) : null) ??
    process.env.QDRANT_VECTOR_SIZE ??
    "1024";
  const embeddingBaseUrl =
    cliEmbeddingBaseUrl ?? fileConfig.embeddingBaseUrl ?? process.env.EMBEDDING_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3";
  const embeddingApiKey = cliEmbeddingApiKey ?? fileConfig.embeddingApiKey ?? process.env.EMBEDDING_API_KEY ?? "";
  const embeddingModel = cliEmbeddingModel ?? fileConfig.embeddingModel ?? process.env.EMBEDDING_MODEL ?? "doubao-embedding-vision-251215";
  const retrievalScoreThresholdStr =
    cliRetrievalScoreThreshold ??
    (fileConfig.retrievalScoreThreshold !== undefined ? String(fileConfig.retrievalScoreThreshold) : null) ??
    process.env.RETRIEVAL_SCORE_THRESHOLD ??
    "0.25";
  const retrievalPrefetchTopKStr =
    cliRetrievalPrefetchTopK ??
    (fileConfig.retrievalPrefetchTopK !== undefined ? String(fileConfig.retrievalPrefetchTopK) : null) ??
    process.env.RETRIEVAL_PREFETCH_TOP_K ??
    "20";
  const retrievalRerankEnabledRaw =
    cliRetrievalRerankEnabled ??
    (fileConfig.retrievalRerankEnabled !== undefined ? String(fileConfig.retrievalRerankEnabled) : null) ??
    process.env.RETRIEVAL_RERANK_ENABLED ??
    "true";
  const retrievalMaxQueryLengthStr =
    cliRetrievalMaxQueryLength ??
    (fileConfig.retrievalMaxQueryLength !== undefined ? String(fileConfig.retrievalMaxQueryLength) : null) ??
    process.env.RETRIEVAL_MAX_QUERY_LENGTH ??
    "200";
  const doclingBaseUrl = cliDoclingBaseUrl ?? fileConfig.doclingBaseUrl ?? process.env.DOCLING_BASE_URL ?? "http://127.0.0.1:5001";
  const doclingApiKey = cliDoclingApiKey ?? fileConfig.doclingApiKey ?? process.env.DOCLING_API_KEY ?? undefined;
  const doclingTimeoutMsStr =
    cliDoclingTimeoutMs ??
    (fileConfig.doclingTimeoutMs !== undefined ? String(fileConfig.doclingTimeoutMs) : null) ??
    process.env.DOCLING_TIMEOUT_MS ??
    "300000";
  const doclingEnablePictureDescriptionRaw =
    cliDoclingEnablePictureDescription ??
    (fileConfig.doclingEnablePictureDescription !== undefined ? String(fileConfig.doclingEnablePictureDescription) : null) ??
    process.env.DOCLING_ENABLE_PICTURE_DESCRIPTION ??
    "false";
  const ingestionChunkSizeStr =
    cliIngestionChunkSize ??
    (fileConfig.ingestionChunkSize !== undefined ? String(fileConfig.ingestionChunkSize) : null) ??
    process.env.INGESTION_CHUNK_SIZE ??
    "1000";
  const ingestionChunkOverlapStr =
    cliIngestionChunkOverlap ??
    (fileConfig.ingestionChunkOverlap !== undefined ? String(fileConfig.ingestionChunkOverlap) : null) ??
    process.env.INGESTION_CHUNK_OVERLAP ??
    "200";
  const minioEndpoint = cliMinioEndpoint ?? fileConfig.minioEndpoint ?? process.env.MINIO_ENDPOINT ?? "";
  const minioAccessKey = cliMinioAccessKey ?? fileConfig.minioAccessKey ?? process.env.MINIO_ACCESS_KEY ?? "";
  const minioSecretKey = cliMinioSecretKey ?? fileConfig.minioSecretKey ?? process.env.MINIO_SECRET_KEY ?? "";
  const minioKbBucket = cliMinioKbBucket ?? fileConfig.minioKbBucket ?? process.env.MINIO_KB_BUCKET ?? "kb-documents";
  const minioRegion = cliMinioRegion ?? fileConfig.minioRegion ?? process.env.MINIO_REGION ?? "us-east-1";
  const minioUsePathStyleRaw =
    cliMinioUsePathStyle ??
    (fileConfig.minioUsePathStyle !== undefined ? String(fileConfig.minioUsePathStyle) : null) ??
    process.env.MINIO_USE_PATH_STYLE ??
    "true";

  const localDev = parseLocalDevFlag(fileConfig.localDev, process.env.CUBE_LOCAL_DEV);

  const superAdminUsername =
    cliSuperAdminUsername ?? fileConfig.superAdminUsername ?? process.env.CUBE_SUPER_ADMIN_USERNAME?.trim() ?? "admin";
  const superAdminPassword =
    cliSuperAdminPassword ?? fileConfig.superAdminPassword ?? process.env.CUBE_SUPER_ADMIN_PASSWORD?.trim() ?? "ChangeMe123!";
  const builtinSystemApiKey =
    cliBuiltinSystemApiKey ??
    fileConfig.builtinSystemApiKey ??
    process.env.CUBE_AI_BUILTIN_SYSTEM_API_KEY?.trim() ??
    "sk_cube_builtin_system_ChangeMeInProduction";
  const webhookHmacSecret =
    cliWebhookHmacSecret ?? fileConfig.webhookHmacSecret ?? process.env.CUBE_WEBHOOK_HMAC_SECRET?.trim() ?? undefined;
  const devApiRateLimitPerMin = (() => {
    const raw =
      cliDevApiRateLimitPerMin ??
      (fileConfig.devApiRateLimitPerMin !== undefined ? String(fileConfig.devApiRateLimitPerMin) : null) ??
      process.env.CUBE_DEV_API_RATE_LIMIT_PER_MIN?.trim() ??
      "60";
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60;
  })();
  const otelExporterOtlpEndpoint =
    cliOtelExporterOtlpEndpoint ?? fileConfig.otelExporterOtlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ?? undefined;
  const otelServiceName = cliOtelServiceName ?? fileConfig.otelServiceName ?? process.env.OTEL_SERVICE_NAME?.trim() ?? "cube-ai";

  const grpcPortStr =
    getCliArg("grpc-port") ??
    (fileConfig.grpcPort !== undefined ? String(fileConfig.grpcPort) : null) ??
    process.env.AI_CENTER_GRPC_PORT?.trim() ??
    process.env.AGENTIC_ENGINE_GRPC_PORT?.trim() ??
    "3110";
  const grpcPort = (() => {
    const parsed = parseInt(grpcPortStr, 10);
    return Number.isFinite(parsed) ? parsed : 3110;
  })();
  const registerGrpcPortStr =
    getCliArg("register-grpc-port") ??
    (fileConfig.registerGrpcPort !== undefined ? String(fileConfig.registerGrpcPort) : null) ??
    process.env.AI_CENTER_REGISTER_GRPC_PORT?.trim() ??
    null;
  const registerGrpcPort = (() => {
    const parsed = registerGrpcPortStr !== null ? parseInt(registerGrpcPortStr, 10) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : grpcPort;
  })();
  const internalInvokeSecretKey =
    getCliArg("internal-invoke-secret-key") ??
    fileConfig.internalInvokeSecretKey ??
    process.env.CUBE2_INTERNAL_INVOKE_SECRET_KEY?.trim() ??
    process.env.GHCLOUD_INTERNAL_INVOKE_SECRET_KEY?.trim() ??
    process.env.INTERNAL_INVOKE_SECRET_KEY?.trim() ??
    undefined;

  return {
    name,
    port: parseInt(portStr, 10),
    grpcPort,
    registerGrpcPort,
    internalInvokeSecretKey,
    hostname,
    serverIdleTimeoutMs,
    localDev,
    mysqlHost,
    mysqlPort: parseInt(mysqlPortStr, 10),
    mysqlDatabase,
    mysqlUsername,
    mysqlPassword,
    langflowBaseUrl,
    langflowApiKey,
    langflowBearerToken,
    selfBaseUrl,
    qdrantBaseUrl,
    qdrantApiKey,
    qdrantCollectionName,
    qdrantVectorSize: parseInt(qdrantVectorSizeStr, 10),
    embeddingBaseUrl,
    embeddingApiKey,
    embeddingModel,
    retrievalScoreThreshold: (() => {
      const parsed = Number.parseFloat(retrievalScoreThresholdStr);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.25;
    })(),
    retrievalPrefetchTopK: (() => {
      const parsed = parseInt(retrievalPrefetchTopKStr, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
    })(),
    retrievalRerankEnabled: retrievalRerankEnabledRaw === "true" || retrievalRerankEnabledRaw === "1",
    retrievalMaxQueryLength: (() => {
      const parsed = parseInt(retrievalMaxQueryLengthStr, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 200;
    })(),
    doclingBaseUrl,
    doclingApiKey,
    doclingTimeoutMs: (() => {
      const parsed = parseInt(doclingTimeoutMsStr, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 300000;
    })(),
    doclingEnablePictureDescription: doclingEnablePictureDescriptionRaw === "true" || doclingEnablePictureDescriptionRaw === "1",
    ingestionChunkSize: parseInt(ingestionChunkSizeStr, 10),
    ingestionChunkOverlap: parseInt(ingestionChunkOverlapStr, 10),
    minioEndpoint,
    minioAccessKey,
    minioSecretKey,
    minioKbBucket,
    minioRegion,
    minioUsePathStyle: minioUsePathStyleRaw === "true" || minioUsePathStyleRaw === "1",
    superAdminUsername,
    superAdminPassword,
    builtinSystemApiKey,
    webhookHmacSecret,
    devApiRateLimitPerMin,
    otelExporterOtlpEndpoint,
    otelServiceName,
    paths: resolvePaths(fileConfig),
  };
}

export async function loadAppConfig(): Promise<AppConfig> {
  if (cachedAppConfig) return cachedAppConfig;
  cachedAppConfig = await resolveAppConfigUncached();
  return cachedAppConfig;
}
