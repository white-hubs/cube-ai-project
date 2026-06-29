import { z } from "zod";

/**
 * KnowledgeQueryPort
 * Engine-side abstraction over the AI middle-platform Knowledge retrieval
 * endpoint. Handler `platform.knowledge.query` consumes this port via DI.
 *
 * Wire contract: see docs/technical-design/plans/integration/ai-application-endpoints.md §2.
 */

export const KnowledgeQueryRequestSchema = z.object({
  kbIds: z.array(z.string().min(1)).max(10).optional(),
  query: z.string().min(2).max(512),
  scoreThreshold: z.number().min(0).max(1).default(0.3),
  tenant: z.number().int().min(0).max(2_147_483_647),
  topK: z.number().int().min(1).max(20).default(5),
  traceId: z.string().min(1),
  userToken: z.string().min(1).optional(),
});
export type KnowledgeQueryRequest = z.infer<typeof KnowledgeQueryRequestSchema>;

export const KnowledgeHitSchema = z.object({
  docId: z.string().min(1),
  kbId: z.string().min(1).optional(),
  link: z.string().optional(),
  score: z.number().min(0).max(1),
  snippet: z.string(),
  title: z.string().optional(),
});
export type KnowledgeHit = z.infer<typeof KnowledgeHitSchema>;

export const KnowledgeQueryResponseSchema = z.object({
  hits: z.array(KnowledgeHitSchema),
  truncated: z.boolean().default(false),
});
export type KnowledgeQueryResponse = z.infer<typeof KnowledgeQueryResponseSchema>;

export interface KnowledgeQueryPort {
  query(req: KnowledgeQueryRequest, signal: AbortSignal): Promise<KnowledgeQueryResponse>;
}
