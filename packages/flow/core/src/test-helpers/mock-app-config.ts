import type { AppConfig } from "@cube-ai/ai-center/platform/server-base";

import { flowCoreFixturePaths } from "./fixture-paths";

export { flowCoreFixturePaths };

export function makeMockAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const fixtures = flowCoreFixturePaths;
  return {
    builtinSystemApiKey: "sk_cube_builtin_system_test",
    devApiRateLimitPerMin: 60,
    doclingApiKey: undefined,
    doclingBaseUrl: "http://127.0.0.1:5001",
    doclingEnablePictureDescription: false,
    doclingTimeoutMs: 300000,
    embeddingApiKey: "test-key",
    embeddingBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    embeddingModel: "doubao-embedding-vision-251215",
    grpcPort: 3110,
    hostname: "0.0.0.0",
    ingestionChunkOverlap: 200,
    ingestionChunkSize: 1000,
    internalInvokeSecretKey: undefined,
    langflowApiKey: undefined,
    langflowBaseUrl: undefined,
    langflowBearerToken: undefined,
    localDev: false,
    minioAccessKey: "minioadmin",
    minioEndpoint: "http://127.0.0.1:9000",
    minioKbBucket: "kb-documents",
    minioRegion: "us-east-1",
    minioSecretKey: "minioadmin",
    minioUsePathStyle: true,
    mysqlDatabase: "ai",
    mysqlHost: "localhost",
    mysqlPassword: "",
    mysqlPort: 3306,
    mysqlUsername: "root",
    name: "@cube-ai/test",
    otelExporterOtlpEndpoint: undefined,
    otelServiceName: "cube-ai",
    paths: {
      componentCatalogPath: fixtures.componentCatalogPath,
      langflowApiAllPath: fixtures.langflowApiAllPath,
      sqlitePath: "/app/data/cube-ai.sqlite",
    },
    port: 3210,
    qdrantApiKey: undefined,
    qdrantBaseUrl: "http://127.0.0.1:6333",
    qdrantCollectionName: "ai_server_documents",
    qdrantVectorSize: 1024,
    registerGrpcPort: 3110,
    retrievalMaxQueryLength: 200,
    retrievalPrefetchTopK: 20,
    retrievalRerankEnabled: true,
    retrievalScoreThreshold: 0.25,
    serverIdleTimeoutMs: 240000,
    superAdminPassword: "ChangeMe123!",
    superAdminUsername: "admin",
    webhookHmacSecret: undefined,
    ...overrides,
  };
}
