import {
  KnowledgeQueryResponseSchema,
  type KnowledgeQueryPort,
  type KnowledgeQueryRequest,
  type KnowledgeQueryResponse,
} from '@cube-ai/contracts';
import { GhcloudPlatformError } from '../errors';
import { doFetchJson } from '../fetch-utils';

export interface GhcloudKnowledgeQueryAdapterOpts {
  baseUrl: string;
  tokenProvider: (tenant: number) => Promise<string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class GhcloudKnowledgeQueryAdapter implements KnowledgeQueryPort {
  constructor(private readonly opts: GhcloudKnowledgeQueryAdapterOpts) {}

  async query(
    req: KnowledgeQueryRequest,
    signal: AbortSignal,
  ): Promise<KnowledgeQueryResponse> {
    const token = req.userToken ?? (await this.opts.tokenProvider(req.tenant));
    const bodyJson: Record<string, unknown> = {
      query: req.query,
      topK: req.topK,
      scoreThreshold: req.scoreThreshold,
    };
    if (req.kbIds !== undefined) {
      bodyJson['kbIds'] = req.kbIds;
    }

    const { body } = await doFetchJson({
      url: `${this.opts.baseUrl}/ai/knowledge/query`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        tenant: String(req.tenant),
        terminal: 'bimops-manage-web',
        'X-Trace-Id': req.traceId,
        'X-Engine-Caller': 'cube-agentic-engine',
      },
      bodyJson,
      signal,
      timeoutMs: this.opts.timeoutMs ?? 10_000,
      fetchImpl: this.opts.fetchImpl,
    });

    const parsed = KnowledgeQueryResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw GhcloudPlatformError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'knowledge query remote response did not match KnowledgeQueryResponseSchema',
        { issues: parsed.error.issues },
      );
    }
    return parsed.data;
  }
}
