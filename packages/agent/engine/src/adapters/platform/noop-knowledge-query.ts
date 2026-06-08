import type {
  KnowledgeQueryPort,
  KnowledgeQueryRequest,
  KnowledgeQueryResponse,
} from '@cube-ai/contracts';

export class NoopKnowledgeQueryPort implements KnowledgeQueryPort {
  async query(_req: KnowledgeQueryRequest, _signal: AbortSignal): Promise<KnowledgeQueryResponse> {
    const err = Object.assign(new Error('Knowledge query is not wired in M2 (pending M3)'), {
      name: 'AgenticPlatformNotConnectedError',
      code: 'PLATFORM_KNOWLEDGE_NOT_CONNECTED',
    });
    throw err;
  }
}
