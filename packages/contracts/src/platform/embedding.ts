import { z } from 'zod';

export const EmbeddingPurposeSchema = z.enum(['query', 'document']);
export type EmbeddingPurpose = z.infer<typeof EmbeddingPurposeSchema>;

export const EmbeddingContextSchema = z.object({
  retrievalProfile: z.string().min(1).optional(),
  sourceType: z.string().optional(),
  chunkType: z.string().optional(),
});
export type EmbeddingContext = z.infer<typeof EmbeddingContextSchema>;

export const SparseVectorSchema = z.object({
  indices: z.array(z.number().int().nonnegative()),
  values: z.array(z.number()),
});
export type SparseVector = z.infer<typeof SparseVectorSchema>;

export const EmbeddingVectorSchema = z.object({
  dense: z.array(z.number()),
  sparse: SparseVectorSchema.nullable(),
});
export type EmbeddingVector = z.infer<typeof EmbeddingVectorSchema>;

/** Capability port: text → {dense, sparse} via LlmProviderPort.embed (ADR-0005). */
export interface EmbeddingPort {
  readonly dimension: number;
  embed(
    input: string[],
    purpose?: EmbeddingPurpose,
    contexts?: EmbeddingContext[],
    signal?: AbortSignal,
  ): Promise<EmbeddingVector[]>;
}

export const EMBEDDING_PORT_TOKEN = Symbol.for('agentic.capability.embedding');
