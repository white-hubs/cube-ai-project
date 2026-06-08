import { z } from 'zod';

/**
 * toolCallId: VARCHAR(64) — may carry LLM-provider prefix like `tcall_...`
 * (规范 §4.1 例外)
 */
export const toolCallIdSchema = z.string().min(1).max(64);
export type ToolCallId = z.infer<typeof toolCallIdSchema>;

/**
 * POST /v1/sessions/:sessionId/turns/:turnId/tool-acks
 * Ref: docs/detailed-design/08-sdk/contracts.md §4.6
 */
export const ToolAckSubmitRequestSchema = z.object({
  toolCallId: toolCallIdSchema,
  result: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true),  output: z.unknown() }),
    z.object({ ok: z.literal(false), error: z.object({
      code:      z.string(),
      message:   z.string(),
      retryable: z.boolean().optional(),
    }) }),
  ]),
}).strict();
export type ToolAckSubmitRequest = z.infer<typeof ToolAckSubmitRequestSchema>;
