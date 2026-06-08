/**
 * KnowledgeHandler — proxies platform.knowledge.query to the AI middle-platform
 * via KnowledgeQueryPort. See docs/detailed-design/07-tools/builtin-catalog.md §7.
 */
import { Inject, Injectable } from '@dangao/bun-server';
import type { KnowledgeQueryPort } from '@cube-ai/contracts';
import { AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN } from '@cube-ai/contracts/platform';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import type { ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';

export interface KnowledgeHandlerInput {
  query: string;
  kbIds?: string[];
  topK?: number;
  scoreThreshold?: number;
}

export interface KnowledgeHandlerOutput {
  hits: Array<{
    docId: string;
    kbId?: string;
    title?: string;
    snippet: string;
    score: number;
    link?: string;
  }>;
  truncated: boolean;
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

@Injectable()
export class KnowledgeHandler
  implements ToolHandler<KnowledgeHandlerInput, KnowledgeHandlerOutput>
{
  readonly kind = 'knowledge' as unknown as ToolHandler['kind'];

  constructor(
    @Inject(AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN)
    private readonly port: KnowledgeQueryPort,
  ) {}

  async invoke(
    input: KnowledgeHandlerInput,
    ctx: ToolHandlerCtx,
  ): Promise<KnowledgeHandlerOutput> {
    if (!input?.query || input.query.length < 2 || input.query.length > 512) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'platform.knowledge.query requires query length 2..512',
      );
    }
    const boundKbIds = uniqueNonEmpty(
      (ctx.turn?.runtimeRefs?.knowledgeBases ?? []).map((ref) => ref.kbId),
    );
    if (boundKbIds.length === 0) {
      throw AgenticEngineError.fromCode(
        'PERMISSION_DENIED_AUTHZ_AT_RUNTIME',
        'platform.knowledge.query requires knowledgeBases attached to the current turn',
      );
    }

    const requestedKbIds =
      input.kbIds !== undefined && input.kbIds.length > 0
        ? uniqueNonEmpty(input.kbIds)
        : boundKbIds;
    const allowed = new Set(boundKbIds);
    const outOfScope = requestedKbIds.filter((id) => !allowed.has(id));
    if (outOfScope.length > 0) {
      throw AgenticEngineError.fromCode(
        'PERMISSION_DENIED_AUTHZ_AT_RUNTIME',
        'platform.knowledge.query kbIds must be a subset of current turn knowledgeBases',
        { kbIds: outOfScope },
      );
    }

    try {
      const resp = await this.port.query(
        {
          tenant: ctx.auth.tenant,
          query: input.query,
          kbIds: requestedKbIds,
          topK: input.topK ?? 5,
          scoreThreshold: input.scoreThreshold ?? 0.3,
          traceId: ctx.traceId,
        },
        ctx.signal,
      );
      return { hits: resp.hits, truncated: resp.truncated };
    } catch (e) {
      const code = (e as { code?: string } | null)?.code ?? 'UPSTREAM_TOOL_HTTP_FAILED';
      const msg = e instanceof Error ? e.message : String(e);
      const mapped =
        code === 'RESOURCE_NOT_FOUND_REMOTE'
          ? 'RESOURCE_NOT_FOUND_DESCRIPTOR'
          : code === 'UPSTREAM_NETWORK_TIMEOUT' ||
              code === 'UPSTREAM_AUTH_FAILED' ||
              code === 'UPSTREAM_TOOL_HTTP_FAILED' ||
              code === 'INVALID_ARGUMENT_SCHEMA_VIOLATION'
            ? code
            : 'UPSTREAM_TOOL_HTTP_FAILED';
      throw AgenticEngineError.fromCode(
        mapped as Parameters<typeof AgenticEngineError.fromCode>[0],
        `platform.knowledge.query failed: ${msg}`,
      );
    }
  }
}
