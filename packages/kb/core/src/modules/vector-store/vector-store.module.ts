import { type Container, Module } from "@dangao/bun-server";

import { EMBEDDING_PORT_TOKEN, type EmbeddingPort } from "@cube-ai/contracts/platform";
import { QdrantClient, QdrantCollectionService } from "@cube-ai/vector-qdrant";

import { APP_CONFIG_TOKEN, loadAppConfig } from "../../config/app.config";
import { OrmDatabaseModule } from "../../infrastructure/orm/orm-database.module";
import { PlatformDocumentSyncModule } from "../documents/platform-document-sync.module";
import { SearchController } from "./controllers/search.controller";
import { EmbeddingProvider } from "./infrastructure/embeddings/embedding-provider";
import { EmbeddingProviderAdapter } from "./infrastructure/embeddings/embedding-provider.adapter";
import { QdrantVectorRepository } from "./infrastructure/qdrant/qdrant-vector.repository";
import { RetrievalService } from "./services/retrieval.service";
import { VectorizationService } from "./services/vectorization.service";

const appConfig = await loadAppConfig();

function createQdrantClient(config: typeof appConfig): QdrantClient {
  return new QdrantClient({
    apiKey: config.qdrantApiKey,
    url: config.qdrantBaseUrl,
  });
}

@Module({
  controllers: [SearchController],
  exports: [
    APP_CONFIG_TOKEN,
    EmbeddingProvider,
    QdrantClient,
    QdrantCollectionService,
    QdrantVectorRepository,
    RetrievalService,
    VectorizationService,
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
    RetrievalService,
    VectorizationService,
  ],
})
export class VectorStoreModule {}
