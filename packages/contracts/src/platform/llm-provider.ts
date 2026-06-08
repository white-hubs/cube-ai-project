import { z } from 'zod';
import { TenantSchema, type TenantId } from '../common/tenant';

/**
 * LlmProviderPort — cross-domain seam for LLM invocation (chat/stream/embed).
 * Signatures align with tachu `ProviderAdapter` for engine bridging; embed
 * returns G3 `{dense, sparse?}` for hybrid retrieval (ADR-0003/0005).
 */

export const LlmMessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type LlmMessageRole = z.infer<typeof LlmMessageRoleSchema>;

export const LlmMessageSchema = z.object({
  role: LlmMessageRoleSchema,
  content: z.string(),
  toolCallId: z.string().optional(),
});
export type LlmMessage = z.infer<typeof LlmMessageSchema>;

export const LlmToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type LlmToolDefinition = z.infer<typeof LlmToolDefinitionSchema>;

export const LlmChatRequestSchema = z.object({
  tenant: TenantSchema,
  modelCode: z.string().min(1),
  messages: z.array(LlmMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  tools: z.array(LlmToolDefinitionSchema).optional(),
  /** Soft-transition override when legacy flow nodes still carry inline apiKey. */
  legacyApiKey: z.string().min(1).optional(),
  legacyApiBaseUrl: z.string().min(1).optional(),
});
export type LlmChatRequest = z.infer<typeof LlmChatRequestSchema>;

export const LlmToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});
export type LlmToolCall = z.infer<typeof LlmToolCallSchema>;

export const LlmUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type LlmUsage = z.infer<typeof LlmUsageSchema>;

export const LlmFinishReasonSchema = z.enum([
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'unknown',
]);
export type LlmFinishReason = z.infer<typeof LlmFinishReasonSchema>;

export const LlmChatResponseSchema = z.object({
  content: z.string(),
  reasoningContent: z.string().optional(),
  toolCalls: z.array(LlmToolCallSchema).optional(),
  finishReason: LlmFinishReasonSchema.default('stop'),
  usage: LlmUsageSchema.optional(),
});
export type LlmChatResponse = z.infer<typeof LlmChatResponseSchema>;

export const LlmStreamChunkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text-delta'), delta: z.string() }),
  z.object({ type: z.literal('reasoning-delta'), delta: z.string() }),
  z.object({
    type: z.literal('tool-call-delta'),
    index: z.number().int().nonnegative(),
    id: z.string().optional(),
    name: z.string().optional(),
    argumentsDelta: z.string().optional(),
  }),
  z.object({ type: z.literal('tool-call-complete'), call: LlmToolCallSchema }),
  z.object({
    type: z.literal('finish'),
    finishReason: LlmFinishReasonSchema,
    usage: LlmUsageSchema.optional(),
  }),
]);
export type LlmStreamChunk = z.infer<typeof LlmStreamChunkSchema>;

export const LlmEmbedPurposeSchema = z.enum(['query', 'document']);
export type LlmEmbedPurpose = z.infer<typeof LlmEmbedPurposeSchema>;

export const LlmEmbedContextSchema = z.object({
  retrievalProfile: z.string().min(1).optional(),
});
export type LlmEmbedContext = z.infer<typeof LlmEmbedContextSchema>;

export const LlmEmbedRequestSchema = z.object({
  tenant: TenantSchema,
  modelCode: z.string().min(1),
  input: z.array(z.string()).min(1),
  purpose: LlmEmbedPurposeSchema.optional(),
  contexts: z.array(LlmEmbedContextSchema).optional(),
  legacyApiKey: z.string().min(1).optional(),
  legacyApiBaseUrl: z.string().min(1).optional(),
});
export type LlmEmbedRequest = z.infer<typeof LlmEmbedRequestSchema>;

/** G3: sparse hybrid retrieval requires indices + values from vendor (e.g. doubao multimodal). */
export const LlmSparseVectorSchema = z
  .object({
    indices: z.array(z.number().int().nonnegative()),
    values: z.array(z.number()),
  })
  .nullable()
  .optional();

export const LlmEmbedResultSchema = z.object({
  dense: z.array(z.number()),
  sparse: LlmSparseVectorSchema,
});
export type LlmEmbedResult = z.infer<typeof LlmEmbedResultSchema>;

export interface LlmProviderPort {
  chat(req: LlmChatRequest, signal?: AbortSignal): Promise<LlmChatResponse>;
  chatStream(req: LlmChatRequest, signal?: AbortSignal): AsyncIterable<LlmStreamChunk>;
  embed(req: LlmEmbedRequest, signal?: AbortSignal): Promise<LlmEmbedResult[]>;
  listAvailableModels?(tenant: TenantId, signal?: AbortSignal): Promise<string[]>;
}
