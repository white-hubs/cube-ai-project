import { z } from "zod";

import { TenantSchema } from "../common/tenant";

/**
 * RerankPort — vendor-agnostic cross-domain seam for document reranking.
 * Wire DTO field names stay protocol-neutral (no Jina/Qwen/DashScope specifics).
 * HTTP adapter details live in llm-core.
 */

export const RerankRequestSchema = z.object({
  documents: z.array(z.string()).min(1),
  modelCode: z.string().min(1),
  query: z.string().min(1),
  tenant: TenantSchema,
  topN: z.number().int().positive().optional(),
});
export type RerankRequest = z.infer<typeof RerankRequestSchema>;

export const RerankResultItemSchema = z.object({
  /** Original index into `RerankRequest.documents`. */
  index: z.number().int().nonnegative(),
  /** Upstream relevance; typically in [0, 1] but not clamped here. */
  relevanceScore: z.number(),
});
export type RerankResultItem = z.infer<typeof RerankResultItemSchema>;

export interface RerankPort {
  rerank(req: RerankRequest, signal?: AbortSignal): Promise<RerankResultItem[]>;
}

export const AGENTIC_PLATFORM_RERANK_TOKEN = Symbol.for("agentic.adapter.platform.rerank");
