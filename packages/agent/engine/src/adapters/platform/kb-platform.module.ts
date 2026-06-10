import { Module, type Container } from '@dangao/bun-server';
import {
  AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN,
  AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN,
  EMBEDDING_PORT_TOKEN,
  type LlmProviderPort,
} from '@cube-ai/contracts/platform';
import { LlmProviderEmbeddingPort } from '@cube-ai/embedding';
import {
  KnowledgeQueryPortImpl,
  RetrievalService,
  VectorStoreModule,
} from '@cube-ai/kb-core';

function resolveKbEmbeddingModel(): string {
  return (
    Bun.env.KB_EMBEDDING_MODEL?.trim() ||
    process.env.KB_EMBEDDING_MODEL?.trim() ||
    Bun.env.EMBEDDING_MODEL?.trim() ||
    process.env.EMBEDDING_MODEL?.trim() ||
    'doubao-embedding-vision-251215'
  );
}

function resolveKbEmbeddingDimension(): number {
  const raw = Bun.env.QDRANT_VECTOR_SIZE ?? process.env.QDRANT_VECTOR_SIZE ?? '1024';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1024;
}

function resolveKbEmbeddingTenant(): number {
  const raw = Bun.env.KB_EMBEDDING_TENANT ?? process.env.KB_EMBEDDING_TENANT ?? '1';
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

@Module({
  imports: [VectorStoreModule],
  providers: [
    {
      provide: EMBEDDING_PORT_TOKEN,
      useFactory: (container: Container) =>
        new LlmProviderEmbeddingPort({
          provider: container.resolve(AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN) as LlmProviderPort,
          modelCode: resolveKbEmbeddingModel(),
          tenant: resolveKbEmbeddingTenant(),
          dimension: resolveKbEmbeddingDimension(),
        }),
    },
    {
      provide: KnowledgeQueryPortImpl,
      useFactory: (container: Container) =>
        new KnowledgeQueryPortImpl(container.resolve(RetrievalService)),
    },
    {
      provide: AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN,
      useExisting: KnowledgeQueryPortImpl,
    },
  ],
  exports: [AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN, EMBEDDING_PORT_TOKEN, RetrievalService],
})
export class KbPlatformModule {}
