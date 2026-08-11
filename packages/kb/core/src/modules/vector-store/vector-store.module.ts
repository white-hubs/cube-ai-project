import { type Container, Module } from "@dangao/bun-server";

import {
  AGENTIC_PLATFORM_KNOWLEDGE_FEEDBACK_TOKEN,
  AGENTIC_PLATFORM_RERANK_TOKEN,
  EMBEDDING_PORT_TOKEN,
  type EmbeddingPort,
  type RerankPort,
} from "@cube-ai/contracts/platform";
import { QdrantClient, QdrantCollectionService } from "@cube-ai/vector-qdrant";

import { APP_CONFIG_TOKEN, loadAppConfig, type AppConfig } from "../../config/app.config";
import { OrmDatabaseModule } from "../../infrastructure/orm/orm-database.module";
import { DOCUMENT_PLATFORM_SYNC_PORT_TOKEN, type DocumentPlatformSyncPort } from "../../port/document-platform-sync.port";
import { KnowledgeFeedbackPortImpl } from "../../port/knowledge-feedback.port-impl";
import { DocumentRepositoryOrm } from "../documents/infrastructure/orm/document.repository";
import { PlatformDocumentSyncModule } from "../documents/platform-document-sync.module";
import { SearchController } from "./controllers/search.controller";
import { SearchFeedbackMetricsQuery } from "./feedback/search-feedback-metrics";
import { SearchFeedbackMetricsMysql } from "./feedback/search-feedback-metrics.mysql";
import { SearchFeedbackController } from "./feedback/search-feedback.controller";
import { SearchFeedbackRepositoryOrm } from "./feedback/search-feedback.repository";
import { SearchFeedbackService } from "./feedback/search-feedback.service";
import { SEARCH_FEEDBACK_REPOSITORY_TOKEN } from "./feedback/search-feedback.tokens";
import { EmbeddingProvider, type EmbeddingProvider as EmbeddingProviderContract } from "./infrastructure/embeddings/embedding-provider";
import { EmbeddingProviderAdapter } from "./infrastructure/embeddings/embedding-provider.adapter";
import { DocumentChunkRepositoryOrm } from "./infrastructure/qdrant/document-chunk.repository";
import { QdrantVectorRepository } from "./infrastructure/qdrant/qdrant-vector.repository";
import { RetrievalService } from "./services/retrieval.service";
import { MysqlOutboxVectorReconcileScheduler, VECTOR_RECONCILE_SCHEDULER_TOKEN } from "./services/vector-reconcile-scheduler";
import { VectorReconcileWorkerService } from "./services/vector-reconcile-worker.service";
import { VectorReconcileService } from "./services/vector-reconcile.service";
import { VectorizationService } from "./services/vectorization.service";

const appConfig = await loadAppConfig();

function createQdrantClient(config: typeof appConfig): QdrantClient {
  return new QdrantClient({
    apiKey: config.qdrantApiKey,
    url: config.qdrantBaseUrl,
  });
}

function tryResolveRerankPort(container: Container): RerankPort | undefined {
  try {
    return container.resolve(AGENTIC_PLATFORM_RERANK_TOKEN) as RerankPort;
  } catch {
    return undefined;
  }
}

@Module({
  controllers: appConfig.searchFeedbackEnabled ? [SearchController, SearchFeedbackController] : [SearchController],
  exports: [
    APP_CONFIG_TOKEN,
    EmbeddingProvider,
    QdrantClient,
    QdrantCollectionService,
    QdrantVectorRepository,
    RetrievalService,
    SearchFeedbackService,
    AGENTIC_PLATFORM_KNOWLEDGE_FEEDBACK_TOKEN,
    VectorizationService,
    VectorReconcileService,
    VECTOR_RECONCILE_SCHEDULER_TOKEN,
  ],
  imports: [OrmDatabaseModule, PlatformDocumentSyncModule],
  providers: [
    { provide: APP_CONFIG_TOKEN, useValue: appConfig },
    {
      provide: QdrantClient,
      useFactory: () => createQdrantClient(appConfig),
    },
    {
      provide: QdrantCollectionService,
      useFactory: (client: QdrantClient) => new QdrantCollectionService(client),
      inject: [QdrantClient],
    },
    QdrantVectorRepository,
    {
      provide: EmbeddingProvider,
      useFactory: (container: Container) => new EmbeddingProviderAdapter(container.resolve(EMBEDDING_PORT_TOKEN) as EmbeddingPort),
    },
    {
      provide: RetrievalService,
      useFactory: (container: Container) =>
        new RetrievalService(
          container.resolve(APP_CONFIG_TOKEN) as AppConfig,
          container.resolve(EmbeddingProvider) as EmbeddingProviderContract,
          container.resolve(QdrantVectorRepository),
          container.resolve(DocumentRepositoryOrm),
          container.resolve(DocumentChunkRepositoryOrm),
          container.resolve(DOCUMENT_PLATFORM_SYNC_PORT_TOKEN) as DocumentPlatformSyncPort,
          tryResolveRerankPort(container),
        ),
    },
    {
      provide: SEARCH_FEEDBACK_REPOSITORY_TOKEN,
      useFactory: (repo: SearchFeedbackRepositoryOrm) => repo,
      inject: [SearchFeedbackRepositoryOrm],
    },
    SearchFeedbackMetricsMysql,
    {
      provide: SearchFeedbackMetricsQuery,
      useFactory: (mysql: SearchFeedbackMetricsMysql) => mysql.createQuery(),
      inject: [SearchFeedbackMetricsMysql],
    },
    SearchFeedbackService,
    {
      provide: AGENTIC_PLATFORM_KNOWLEDGE_FEEDBACK_TOKEN,
      useClass: KnowledgeFeedbackPortImpl,
    },
    { provide: VECTOR_RECONCILE_SCHEDULER_TOKEN, useClass: MysqlOutboxVectorReconcileScheduler },
    VectorizationService,
    VectorReconcileService,
    VectorReconcileWorkerService,
  ],
})
export class VectorStoreModule {}
