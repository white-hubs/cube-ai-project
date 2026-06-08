import { Module } from '@dangao/bun-server';
import { EMBEDDING_PORT_TOKEN, type EmbeddingPort } from '@cube-ai/contracts/platform';
import { QdrantClient, QdrantCollectionService } from '@cube-ai/vector-qdrant';
import { loadAppConfig, APP_CONFIG_TOKEN } from '../../config/app.config';
import { OrmDatabaseModule } from '../../infrastructure/orm/orm-database.module';
import { SearchController } from './controllers/search.controller';
import { EmbeddingProviderAdapter } from './infrastructure/embeddings/embedding-provider.adapter';
import { EmbeddingProvider } from './infrastructure/embeddings/embedding-provider';
import { QdrantVectorRepository } from './infrastructure/qdrant/qdrant-vector.repository';
import { RetrievalService } from './services/retrieval.service';
import { VectorizationService } from './services/vectorization.service';

const appConfig = await loadAppConfig();

function createQdrantClient(config: typeof appConfig): QdrantClient {
  return new QdrantClient({
    url: config.qdrantBaseUrl,
    apiKey: config.qdrantApiKey,
  });
}

@Module({
  imports: [OrmDatabaseModule],
  controllers: [SearchController],
  providers: [
    { provide: APP_CONFIG_TOKEN, useValue: appConfig },
    {
      provide: QdrantClient,
      useFactory: () => createQdrantClient(appConfig),
    },
    QdrantCollectionService,
    QdrantVectorRepository,
    {
      provide: EmbeddingProvider,
      useFactory: (embeddingPort: EmbeddingPort) => new EmbeddingProviderAdapter(embeddingPort),
      inject: [EMBEDDING_PORT_TOKEN],
    },
    RetrievalService,
    VectorizationService,
  ],
  exports: [
    APP_CONFIG_TOKEN,
    EmbeddingProvider,
    QdrantClient,
    QdrantCollectionService,
    QdrantVectorRepository,
    RetrievalService,
    VectorizationService,
  ],
})
export class VectorStoreModule {}
