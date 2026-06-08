/**
 * VectorHandler — VectorIndex Port：search / upsert（precomputed vectors only）。
 *
 * 权威来源：docs/detailed-design/07-tools/builtin-catalog.md §8
 */
import { Inject, Injectable } from '@dangao/bun-server';
import type { VectorIndexAdapter } from '@tachu/core';
import { TurnAwareEmbeddingRuntime } from '@cube-ai/agent-engine/adapters/embedding';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import { toAdapterCallContext, type ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';
import { TACHU_VECTOR_INDEX_TOKEN } from '@cube-ai/agent-engine/adapters/tokens';
import { TURN_AWARE_EMBEDDING_RUNTIME_TOKEN } from '../../tachu/tachu.tokens';

export interface VectorHandlerInput {
  operation?: 'search' | 'upsert';
  collection?: string;
  /** search */
  query?:       string;
  topK?:        number;
  scoreThreshold?: number;
  filter?:      Record<string, unknown>;
  /** upsert */
  id?:      string;
  /** precomputed vector only (string upsert retired) */
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorHandlerOutput {
  hits: Array<{
    id:      string;
    score:   number;
    payload: Record<string, unknown>;
  }>;
  truncated: boolean;
}

@Injectable()
export class VectorHandler implements ToolHandler<VectorHandlerInput, VectorHandlerOutput> {
  readonly kind = 'vector' as const;

  constructor(
    @Inject(TACHU_VECTOR_INDEX_TOKEN) private readonly vectorIndex: VectorIndexAdapter,
    @Inject(TURN_AWARE_EMBEDDING_RUNTIME_TOKEN)
    private readonly embeddingRuntime: TurnAwareEmbeddingRuntime,
  ) {}

  async invoke(input: VectorHandlerInput, ctx: ToolHandlerCtx): Promise<VectorHandlerOutput> {
    const op = input.operation ?? 'search';
    const ac = toAdapterCallContext(ctx);

    if (op === 'upsert') {
      if (!input.id || !Array.isArray(input.embedding) || input.embedding.length === 0) {
        throw AgenticEngineError.fromCode(
          'INVALID_ARGUMENT_SCHEMA_VIOLATION',
          'VectorHandler upsert requires id + precomputed embedding vector',
        );
      }
      const meta = {
        ...(input.metadata ?? {}),
        tenant: ctx.auth.tenant,
        collection: input.collection ?? 'default',
        ...(ctx.auth.user?.userId ? { userId: ctx.auth.user.userId } : {}),
      };
      await this.vectorIndex.upsert(
        [{ id: input.id, vector: input.embedding, payload: meta }],
        ac,
        ctx.signal,
      );
      return { hits: [], truncated: false };
    }

    const q = input.query?.trim();
    if (!q) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'VectorHandler search requires query',
      );
    }
    if (!this.embeddingRuntime) {
      throw AgenticEngineError.fromCode(
        'UNAVAILABLE_MEMORY_EMBED',
        'embedding runtime is not configured',
        { retryable: true },
      );
    }

    const topK = Math.min(50, Math.max(1, input.topK ?? 10));
    const profile = this.embeddingRuntime.describe();
    const embedded = await this.embeddingRuntime.embed(
      { model: profile.model, inputs: [q], taskType: 'RETRIEVAL_QUERY' },
      ac,
      ctx.signal,
    );
    const queryVector = embedded.embeddings[0] ?? [];
    if (queryVector.length === 0) {
      throw AgenticEngineError.fromCode(
        'UNAVAILABLE_MEMORY_EMBED',
        'embedding runtime returned empty vector',
        { retryable: true },
      );
    }

    const must: Record<string, unknown> = {
      tenant: ctx.auth.tenant,
      ...(input.filter ?? {}),
    };
    if (ctx.auth.user?.userId) {
      must['userId'] = ctx.auth.user.userId;
    }

    const results = await this.vectorIndex.searchVector(
      queryVector,
      topK,
      { must },
      ac,
      ctx.signal,
    );

    const threshold = input.scoreThreshold ?? 0;
    const hits = results
      .filter((h) => h.score >= threshold)
      .map((h) => ({
        id: h.id,
        score: h.score,
        payload: (h.metadata ?? {}) as Record<string, unknown>,
      }));

    return { hits, truncated: hits.length >= topK };
  }
}
