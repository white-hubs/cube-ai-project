import { Module } from '@dangao/bun-server';
import { AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN } from '../tokens';
import { GhcloudKnowledgeQueryAdapter } from './knowledge.adapter';

function createAdapter(): GhcloudKnowledgeQueryAdapter {
  const baseUrl = process.env['AGENTIC_ENGINE_PLATFORM_API_BASE_URL'] ?? 'http://localhost:3100';
  const serviceToken = process.env['AGENTIC_ENGINE_PLATFORM_SERVICE_TOKEN'] ?? '';
  return new GhcloudKnowledgeQueryAdapter({
    baseUrl,
    tokenProvider: async () => serviceToken,
    timeoutMs: Number(process.env['AGENTIC_ENGINE_PLATFORM_KNOWLEDGE_TIMEOUT_MS'] ?? '10000'),
  });
}

@Module({
  providers: [
    {
      provide: AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN,
      useValue: createAdapter(),
    },
  ],
  exports: [AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN],
})
export class GhcloudKnowledgeQueryModule {}
