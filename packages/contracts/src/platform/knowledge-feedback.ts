import { z } from "zod";

/**
 * KnowledgeFeedbackPort — cross-domain seam for KB search feedback (W4.2 / F-08).
 *
 * Trace correlation contract (aligned with KnowledgeQueryRequest.traceId / W1.4 live):
 * - Clients pass the same `traceId` string used on the retrieval call
 *   (`KnowledgeQueryRequest.traceId`, or HTTP search `traceId` / `X-Trace-Id`).
 * - Feedback rows are keyed by `(tenantId, traceId)` for join/query.
 *
 * Write path and aggregation metrics stay decoupled; HTTP + agent event bypass
 * share the same repository behind this port.
 */

export const KnowledgeFeedbackTypeSchema = z.enum(["thumbs_up", "thumbs_down", "wrong_citation", "missed_source"]);
export type KnowledgeFeedbackType = z.infer<typeof KnowledgeFeedbackTypeSchema>;

export const KnowledgeFeedbackSubmitRequestSchema = z.object({
  comment: z.string().max(2000).optional(),
  hitChunkIds: z.array(z.string().min(1)).max(50).optional(),
  query: z.string().min(1).max(512),
  /** Must match the retrieval call's traceId (KnowledgeQueryRequest.traceId / search echo). */
  traceId: z.string().min(1).max(128),
  type: KnowledgeFeedbackTypeSchema,
});
export type KnowledgeFeedbackSubmitRequest = z.infer<typeof KnowledgeFeedbackSubmitRequestSchema>;

export const KnowledgeFeedbackRecordSchema = z.object({
  comment: z.string().optional(),
  createdAt: z.string().min(1),
  hitChunkIds: z.array(z.string()).default([]),
  id: z.string().min(1),
  query: z.string(),
  tenantId: z.string().min(1),
  traceId: z.string().min(1),
  type: KnowledgeFeedbackTypeSchema,
});
export type KnowledgeFeedbackRecord = z.infer<typeof KnowledgeFeedbackRecordSchema>;

export const KnowledgeFeedbackListByTraceResponseSchema = z.object({
  items: z.array(KnowledgeFeedbackRecordSchema),
});
export type KnowledgeFeedbackListByTraceResponse = z.infer<typeof KnowledgeFeedbackListByTraceResponseSchema>;

/** Auth context for feedback writes — anonymous / unscoped must be rejected. */
export interface KnowledgeFeedbackAuthContext {
  /** True when bearer / x-api-key / trusted agent subject is present. */
  authenticated: boolean;
  subjectId?: string;
  tenantId: string | null | undefined;
}

export interface KnowledgeFeedbackPort {
  listByTraceId(traceId: string, auth: KnowledgeFeedbackAuthContext): Promise<KnowledgeFeedbackRecord[]>;
  submit(req: KnowledgeFeedbackSubmitRequest, auth: KnowledgeFeedbackAuthContext): Promise<KnowledgeFeedbackRecord>;
}

export const AGENTIC_PLATFORM_KNOWLEDGE_FEEDBACK_TOKEN = Symbol.for("agentic.adapter.platform.knowledgeFeedback");
