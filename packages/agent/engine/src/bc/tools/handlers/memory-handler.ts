/**
 * MemoryHandler — MemorySystem Port：get / set / delete / search(recall)。
 *
 * 权威来源：docs/detailed-design/07-tools/builtin-catalog.md §8
 */
import { Inject, Injectable } from '@dangao/bun-server';
import type { MemoryEntry, MemorySystem, VectorIndexAdapter } from '@tachu/core';
import { TurnAwareEmbeddingRuntime } from '@cube-ai/agent-engine/adapters/embedding';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import { toAdapterCallContext, type ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';
import {
  AGENTIC_MEMORY_SYSTEM_TOKEN,
  TACHU_VECTOR_INDEX_TOKEN,
} from '@cube-ai/agent-engine/adapters/tokens';
import { TURN_AWARE_EMBEDDING_RUNTIME_TOKEN } from '../../tachu/tachu.tokens';

export interface MemoryHandlerInput {
  operation: 'get' | 'set' | 'delete' | 'search';
  key?:      string;
  value?:    unknown;
  query?:    string;
  topK?:     number;
  scope?:    'CURRENT_SESSION' | 'CROSS_SESSION';
}

export interface MemoryRecallHit {
  sessionId:  string;
  turnId?:    string;
  snippet:    string;
  score:      number;
  occurredAt: number;
}

export interface MemoryHandlerOutput {
  value?:    unknown;
  hits?:     MemoryRecallHit[];
  success:   boolean;
  truncated?: boolean;
}

@Injectable()
export class MemoryHandler implements ToolHandler<MemoryHandlerInput, MemoryHandlerOutput> {
  readonly kind = 'memory' as const;

  constructor(
    @Inject(AGENTIC_MEMORY_SYSTEM_TOKEN) private readonly memory: MemorySystem,
    @Inject(TACHU_VECTOR_INDEX_TOKEN) private readonly vectorIndex: VectorIndexAdapter,
    @Inject(TURN_AWARE_EMBEDDING_RUNTIME_TOKEN)
    private readonly embeddingRuntime: TurnAwareEmbeddingRuntime,
  ) {}

  async invoke(input: MemoryHandlerInput, ctx: ToolHandlerCtx): Promise<MemoryHandlerOutput> {
    const sessionKey =
      input.scope === 'CROSS_SESSION'
        ? `tenant:${ctx.auth.tenant}:global`
        : ctx.session.id;

    const ac = toAdapterCallContext(ctx);

    switch (input.operation) {
      case 'get': {
        if (!input.key) {
          throw AgenticEngineError.fromCode(
            'INVALID_ARGUMENT_SCHEMA_VIOLATION',
            'memory get requires key',
          );
        }
        const window = await this.memory.load(sessionKey, ac);
        const hit = window.entries.find(
          (e) =>
            typeof e.content === 'object' &&
            e.content !== null &&
            'key' in (e.content as object) &&
            String((e.content as { key?: unknown }).key) === input.key,
        );
        const content = hit?.content as { value?: unknown } | undefined;
        return { success: true, value: content?.value };
      }
      case 'set': {
        if (!input.key) {
          throw AgenticEngineError.fromCode(
            'INVALID_ARGUMENT_SCHEMA_VIOLATION',
            'memory set requires key',
          );
        }
        const entry: MemoryEntry = {
          id:        `memory-set-${Date.now()}`,
          role:      'tool',
          content:   { key: input.key, value: input.value },
          timestamp: Date.now(),
          anchored:  false,
        };
        await this.memory.append(sessionKey, entry, ac);
        return { success: true };
      }
      case 'delete': {
        if (!input.key) {
          await this.memory.clear(sessionKey);
          return { success: true };
        }
        const window = await this.memory.load(sessionKey, ac);
        const kept = window.entries.filter((e) => {
          if (typeof e.content !== 'object' || !e.content || !('key' in e.content)) return true;
          return String((e.content as { key?: unknown }).key) !== input.key;
        });
        await this.memory.clear(sessionKey);
        for (const e of kept) {
          await this.memory.append(sessionKey, e, ac);
        }
        return { success: true };
      }
      case 'search': {
        return this.search(input, ctx, ac);
      }
      default:
        throw AgenticEngineError.fromCode(
          'INVALID_ARGUMENT_SCHEMA_VIOLATION',
          `memory unknown operation: ${String((input as MemoryHandlerInput).operation)}`,
        );
    }
  }

  private async search(
    input: MemoryHandlerInput,
    ctx: ToolHandlerCtx,
    ac: ReturnType<typeof toAdapterCallContext>,
  ): Promise<MemoryHandlerOutput> {
    const q = input.query?.trim();
    if (!q) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'memory search requires query',
      );
    }
    if (!this.embeddingRuntime || !this.vectorIndex) {
      throw AgenticEngineError.fromCode(
        'UNAVAILABLE_MEMORY_RECALL',
        'memory vector recall is not configured',
        { retryable: true },
      );
    }

    const topK = Math.min(50, Math.max(1, input.topK ?? 8));
    let queryVector: number[];
    try {
      const profile = this.embeddingRuntime.describe();
      const embedded = await this.embeddingRuntime.embed(
        { model: profile.model, inputs: [q], taskType: 'RETRIEVAL_QUERY' },
        ac,
        ctx.signal,
      );
      queryVector = embedded.embeddings[0] ?? [];
      if (queryVector.length === 0) {
        throw new Error('empty embedding vector');
      }
    } catch (e) {
      throw AgenticEngineError.fromCode(
        'UNAVAILABLE_MEMORY_EMBED',
        e instanceof Error ? e.message : String(e),
        { retryable: true },
      );
    }

    const must: Record<string, unknown> = { tenant: ctx.auth.tenant };
    if (ctx.auth.user?.userId) {
      must['userId'] = ctx.auth.user.userId;
    }
    if (input.scope !== 'CROSS_SESSION') {
      must['sessionId'] = ctx.session.id;
    }

    let vectorHits;
    try {
      vectorHits = await this.vectorIndex.searchVector(
        queryVector,
        topK,
        { must },
        ac,
        ctx.signal,
      );
    } catch (e) {
      throw AgenticEngineError.fromCode(
        'UNAVAILABLE_MEMORY_RECALL',
        e instanceof Error ? e.message : String(e),
        { retryable: true },
      );
    }

    const hits: MemoryRecallHit[] = vectorHits.map((h) => {
      const meta = (h.metadata ?? {}) as Record<string, unknown>;
      const snippet =
        typeof meta['snippet'] === 'string'
          ? meta['snippet']
          : typeof meta['content'] === 'string'
            ? meta['content']
            : JSON.stringify(meta);
      const occurredAt =
        typeof meta['timestamp'] === 'number'
          ? meta['timestamp']
          : typeof meta['occurredAt'] === 'number'
            ? meta['occurredAt']
            : Date.now();
      return {
        sessionId:
          typeof meta['sessionId'] === 'string' ? meta['sessionId'] : ctx.session.id,
        ...(typeof meta['turnId'] === 'string' ? { turnId: meta['turnId'] } : {}),
        snippet: snippet.slice(0, 1000),
        score: h.score,
        occurredAt,
      };
    });

    return { success: true, hits, truncated: hits.length >= topK };
  }
}
