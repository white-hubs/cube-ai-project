export interface AppPaths {
  langflowApiAllPath: string;
  componentCatalogPath: string;
}

export interface AppConfig {
  name: string;
  port: number;
  hostname?: string;
  serverIdleTimeoutMs: number;
  mysqlHost: string;
  mysqlPort: number;
  mysqlDatabase: string;
  mysqlUsername: string;
  mysqlPassword: string;
  langflowBaseUrl?: string;
  langflowApiKey?: string;
  langflowBearerToken?: string;
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
  minioEndpoint: string;
  minioAccessKey: string;
  minioSecretKey: string;
  minioKbBucket: string;
  minioRegion: string;
  minioUsePathStyle: boolean;
  superAdminUsername: string;
  superAdminPassword: string;
  builtinSystemApiKey: string;
  webhookHmacSecret?: string;
  devApiRateLimitPerMin: number;
  otelExporterOtlpEndpoint?: string;
  otelServiceName: string;
  paths: AppPaths;
}

export const APP_CONFIG_TOKEN = Symbol("AppConfig");

let cachedConfig: AppConfig | null = null;

export function resetAppConfigCache(): void {
  cachedConfig = null;
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

function envBool(key: string, fallback: boolean): boolean {
  const raw = Bun.env[key] ?? process.env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  return raw === "1" || raw.toLowerCase() === "true";
}

function buildAppConfigFromEnv(): AppConfig {
  return {
    builtinSystemApiKey: envString("BUILTIN_SYSTEM_API_KEY", "sk_cube_builtin_system_test"),
    devApiRateLimitPerMin: envNumber("DEV_API_RATE_LIMIT_PER_MIN", 60),
    doclingApiKey: Bun.env.DOCLING_API_KEY ?? process.env.DOCLING_API_KEY,
    doclingBaseUrl: envString("DOCLING_BASE_URL", "http://127.0.0.1:5001"),
    doclingEnablePictureDescription: envBool("DOCLING_ENABLE_PICTURE_DESCRIPTION", false),
    doclingTimeoutMs: envNumber("DOCLING_TIMEOUT_MS", 300_000),
    embeddingApiKey: envString("EMBEDDING_API_KEY", ""),
    embeddingBaseUrl: envString("EMBEDDING_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"),
    embeddingModel: envString("EMBEDDING_MODEL", "doubao-embedding-vision-251215"),
    hostname: envString("KB_HOSTNAME", "0.0.0.0"),
    ingestionChunkOverlap: envNumber("INGESTION_CHUNK_OVERLAP", 200),
    ingestionChunkSize: envNumber("INGESTION_CHUNK_SIZE", 1000),
    minioAccessKey: envString("MINIO_ACCESS_KEY", "minioadmin"),
    minioEndpoint: envString("MINIO_ENDPOINT", "http://127.0.0.1:9000"),
    minioKbBucket: envString("MINIO_KB_BUCKET", "kb-documents"),
    minioRegion: envString("MINIO_REGION", "us-east-1"),
    minioSecretKey: envString("MINIO_SECRET_KEY", "minioadmin"),
    minioUsePathStyle: envBool("MINIO_USE_PATH_STYLE", true),
    mysqlDatabase: envString("MYSQL_DATABASE", envString("MYSQL_DB", "cube_ai_center")),
    mysqlHost: envString("MYSQL_HOST", "127.0.0.1"),
    mysqlPassword: envString("MYSQL_PASSWORD", ""),
    mysqlPort: envNumber("MYSQL_PORT", 3306),
    mysqlUsername: envString("MYSQL_USERNAME", "root"),
    name: envString("APP_NAME", "@cube-ai/kb-core"),
    otelExporterOtlpEndpoint: Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceName: envString("OTEL_SERVICE_NAME", "cube-ai-kb"),
    paths: {
      componentCatalogPath: "/app/data/cube-component-catalog.json",
      langflowApiAllPath: "/app/data/langflow-api-all.json",
    },
    port: envNumber("KB_PORT", 3322),
    qdrantApiKey: Bun.env.QDRANT_API_KEY ?? process.env.QDRANT_API_KEY,
    qdrantBaseUrl: envString("QDRANT_BASE_URL", "http://127.0.0.1:6333"),
    qdrantCollectionName: envString("QDRANT_COLLECTION_NAME", "ai_server_documents"),
    qdrantVectorSize: envNumber("QDRANT_VECTOR_SIZE", 1024),
    retrievalMaxQueryLength: envNumber("RETRIEVAL_MAX_QUERY_LENGTH", 200),
    retrievalPrefetchTopK: envNumber("RETRIEVAL_PREFETCH_TOP_K", 20),
    retrievalRerankEnabled: envBool("RETRIEVAL_RERANK_ENABLED", true),
    retrievalScoreThreshold: envNumber("RETRIEVAL_SCORE_THRESHOLD", 0.25),
    serverIdleTimeoutMs: envNumber("SERVER_IDLE_TIMEOUT_MS", 240_000),
    superAdminPassword: envString("SUPER_ADMIN_PASSWORD", "ChangeMe123!"),
    superAdminUsername: envString("SUPER_ADMIN_USERNAME", "admin"),
    webhookHmacSecret: Bun.env.WEBHOOK_HMAC_SECRET ?? process.env.WEBHOOK_HMAC_SECRET,
  };
}

/** Sync config for DI factories (env-only; respects `resetAppConfigCache`). */
export function loadAppConfigSync(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }
  cachedConfig = buildAppConfigFromEnv();
  return cachedConfig;
}

export async function loadAppConfig(): Promise<AppConfig> {
  return loadAppConfigSync();
}
