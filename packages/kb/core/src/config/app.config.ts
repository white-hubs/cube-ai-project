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
  /**
   * 请求未传 similarityThreshold 时的默认绝对相关度阈值（与响应 score 比较）。
   * 显式传 0 表示关闭该层过滤。成熟产品默认宁可少返回，也不用弱相关凑满 topK。
   */
  retrievalDefaultSimilarityThreshold: number;
  retrievalPrefetchTopK: number;
  /**
   * 规则加分（pre-rank / fallback）。env 优先 `RETRIEVAL_RULE_BOOST_ENABLED`，
   * 未设置时回退已弃用的 `RETRIEVAL_RERANK_ENABLED`。
   */
  retrievalRerankEnabled: boolean;
  /** 模型精排总开关；默认 false（G0-9）。 */
  retrievalModelRerankEnabled: boolean;
  /** 送入 RerankPort 的候选上限。 */
  retrievalRerankInputTopN: number;
  /** Rerank modelCode；生产默认 `qwen3-rerank`。 */
  retrievalRerankModel: string;
  /** 模型精排成功后的独立相关度下限；不得与 fallback score 默认阈值混用。 */
  retrievalRerankMinScore: number;
  /** 开启 exact 去重、section 配额与 dense-vector MMR。 */
  retrievalDiversificationEnabled: boolean;
  /** MMR 中相关性权重，范围运行时 clamp 到 [0,1]。 */
  retrievalMmrLambda: number;
  /** 每个 document + section 最多返回的 chunk 数。 */
  retrievalMaxChunksPerSection: number;
  /** normalized exact-match 最多保留数。 */
  retrievalExactMatchReserve: number;
  retrievalMaxQueryLength: number;
  /**
   * 词法检索 SQL 预取窗口：`max(topK, lexicalCandidateLimit)` 后再由 JS 精算截 topK。
   * 唯一上界入口；禁止代码里再写死第二套 min(..., N)。
   */
  lexicalCandidateLimit: number;
  /**
   * MySQL ngram FULLTEXT 词法路径（W3.4）。默认 false（G0-9）。
   * false：既有 LIKE + buildLexicalPreScoreSql / calculateLexicalScore。
   * true：MATCH…AGAINST 候选 + log1p/min-max 归一化后再入 hybrid。
   */
  lexicalFulltextEnabled: boolean;
  /** Search feedback product surface is deferred; default false until a verified identity/owner exists. */
  searchFeedbackEnabled: boolean;
  /** chunk 质量策略：有效字符下限 */
  chunkQualityMinMeaningfulChars: number;
  /** chunk 质量策略：入库最低分 */
  chunkQualityMinScoreToIndex: number;
  /** chunk 质量策略：默认召回最低分 */
  chunkQualityMinScoreToRetrieve: number;
  doclingBaseUrl: string;
  doclingApiKey?: string;
  doclingTimeoutMs: number;
  doclingEnablePictureDescription: boolean;
  ingestionChunkSize: number;
  ingestionChunkOverlap: number;
  /**
   * When true, upload/reindex enqueue `kb.ingest` and return before parse+embed.
   * Default is false until the async operations surface is ready for product use.
   */
  ingestionAsyncEnabled: boolean;
  /** Max ingest attempts before dead-letter / failed status (inclusive). */
  ingestionMaxAttempts: number;
  /** Global in-process worker concurrency for async ingest. */
  ingestionWorkerConcurrency: number;
  /** Per-tenant concurrency cap within the global worker pool. */
  ingestionWorkerTenantConcurrency: number;
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

let warnedDeprecatedRerankEnv = false;

/** Prefer RETRIEVAL_RULE_BOOST_ENABLED; fall back to deprecated RETRIEVAL_RERANK_ENABLED. */
function resolveRuleBoostEnabled(fallback: boolean): boolean {
  const preferred = Bun.env.RETRIEVAL_RULE_BOOST_ENABLED ?? process.env.RETRIEVAL_RULE_BOOST_ENABLED;
  if (preferred !== undefined && preferred.trim() !== "") {
    return preferred === "1" || preferred.toLowerCase() === "true";
  }
  const legacy = Bun.env.RETRIEVAL_RERANK_ENABLED ?? process.env.RETRIEVAL_RERANK_ENABLED;
  if (legacy !== undefined && legacy.trim() !== "") {
    if (!warnedDeprecatedRerankEnv) {
      warnedDeprecatedRerankEnv = true;
      console.warn("[kb-config] RETRIEVAL_RERANK_ENABLED is deprecated for rule boost; use RETRIEVAL_RULE_BOOST_ENABLED instead");
    }
    return legacy === "1" || legacy.toLowerCase() === "true";
  }
  return fallback;
}

export function resetRuleBoostDeprecationWarnForTests(): void {
  warnedDeprecatedRerankEnv = false;
}

function buildAppConfigFromEnv(): AppConfig {
  return {
    builtinSystemApiKey: envString("BUILTIN_SYSTEM_API_KEY", "sk_cube_builtin_system_test"),
    chunkQualityMinMeaningfulChars: envNumber("CHUNK_QUALITY_MIN_MEANINGFUL_CHARS", 4),
    chunkQualityMinScoreToIndex: envNumber("CHUNK_QUALITY_MIN_SCORE_TO_INDEX", 0.25),
    chunkQualityMinScoreToRetrieve: envNumber("CHUNK_QUALITY_MIN_SCORE_TO_RETRIEVE", 0.35),
    devApiRateLimitPerMin: envNumber("DEV_API_RATE_LIMIT_PER_MIN", 60),
    doclingApiKey: Bun.env.DOCLING_API_KEY ?? process.env.DOCLING_API_KEY,
    doclingBaseUrl: envString("DOCLING_BASE_URL", "http://127.0.0.1:5001"),
    doclingEnablePictureDescription: envBool("DOCLING_ENABLE_PICTURE_DESCRIPTION", false),
    doclingTimeoutMs: envNumber("DOCLING_TIMEOUT_MS", 300_000),
    embeddingApiKey: envString("EMBEDDING_API_KEY", ""),
    embeddingBaseUrl: envString("EMBEDDING_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"),
    embeddingModel: envString("EMBEDDING_MODEL", "doubao-embedding-vision-251215"),
    hostname: envString("KB_HOSTNAME", "0.0.0.0"),
    ingestionAsyncEnabled: envBool("INGESTION_ASYNC_ENABLED", false),
    ingestionChunkOverlap: envNumber("INGESTION_CHUNK_OVERLAP", 200),
    ingestionChunkSize: envNumber("INGESTION_CHUNK_SIZE", 1000),
    ingestionMaxAttempts: envNumber("INGESTION_MAX_ATTEMPTS", 3),
    ingestionWorkerConcurrency: envNumber("INGESTION_WORKER_CONCURRENCY", 2),
    ingestionWorkerTenantConcurrency: envNumber("INGESTION_WORKER_TENANT_CONCURRENCY", 1),
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
    lexicalCandidateLimit: envNumber("LEXICAL_CANDIDATE_LIMIT", 500),
    lexicalFulltextEnabled: envBool("LEXICAL_FULLTEXT_ENABLED", false),
    searchFeedbackEnabled: envBool("KB_SEARCH_FEEDBACK_ENABLED", false),
    retrievalDefaultSimilarityThreshold: envNumber("RETRIEVAL_DEFAULT_SIMILARITY_THRESHOLD", 0.2),
    retrievalMaxQueryLength: envNumber("RETRIEVAL_MAX_QUERY_LENGTH", 200),
    retrievalModelRerankEnabled: envBool("RETRIEVAL_MODEL_RERANK_ENABLED", false),
    retrievalDiversificationEnabled: envBool("RETRIEVAL_DIVERSIFICATION_ENABLED", false),
    retrievalExactMatchReserve: envNumber("RETRIEVAL_EXACT_MATCH_RESERVE", 1),
    retrievalMaxChunksPerSection: envNumber("RETRIEVAL_MAX_CHUNKS_PER_SECTION", 1),
    retrievalMmrLambda: envNumber("RETRIEVAL_MMR_LAMBDA", 0.75),
    retrievalPrefetchTopK: envNumber("RETRIEVAL_PREFETCH_TOP_K", 20),
    retrievalRerankEnabled: resolveRuleBoostEnabled(true),
    retrievalRerankInputTopN: envNumber("RETRIEVAL_RERANK_INPUT_TOP_N", 50),
    retrievalRerankMinScore: envNumber("RETRIEVAL_RERANK_MIN_SCORE", 0.65),
    retrievalRerankModel: envString("RETRIEVAL_RERANK_MODEL", "qwen3-rerank"),
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
