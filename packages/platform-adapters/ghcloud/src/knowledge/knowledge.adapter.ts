import {
  type KnowledgeQueryPort,
  type KnowledgeQueryRequest,
  type KnowledgeQueryResponse,
  KnowledgeQueryResponseSchema,
} from "@cube-ai/contracts";

import { GhcloudPlatformError } from "../errors";
import { doFetchJson } from "../fetch-utils";

export interface GhcloudKnowledgeQueryAdapterOpts {
  baseUrl: string;
  tokenProvider: (tenant: number) => Promise<string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class GhcloudKnowledgeQueryAdapter implements KnowledgeQueryPort {
  constructor(private readonly opts: GhcloudKnowledgeQueryAdapterOpts) {}

  async query(req: KnowledgeQueryRequest, signal: AbortSignal): Promise<KnowledgeQueryResponse> {
    const token = req.userToken ?? (await this.opts.tokenProvider(req.tenant));
    const bodyJson: Record<string, unknown> = {
      query: req.query,
      scoreThreshold: req.scoreThreshold,
      topK: req.topK,
    };
    if (req.kbIds !== undefined) {
      bodyJson["kbIds"] = req.kbIds;
    }

    const { body } = await doFetchJson({
      bodyJson,
      fetchImpl: this.opts.fetchImpl,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Engine-Caller": "cube-agentic-engine",
        "X-Trace-Id": req.traceId,
        tenant: String(req.tenant),
        terminal: "bimops-manage-web",
      },
      method: "POST",
      signal,
      timeoutMs: this.opts.timeoutMs ?? 10_000,
      url: `${this.opts.baseUrl}/ai/knowledge/query`,
    });

    const parsed = KnowledgeQueryResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw GhcloudPlatformError.fromCode(
        "INVALID_ARGUMENT_SCHEMA_VIOLATION",
        "knowledge query remote response did not match KnowledgeQueryResponseSchema",
        { issues: parsed.error.issues },
      );
    }
    return parsed.data;
  }
}
