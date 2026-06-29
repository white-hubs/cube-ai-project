import type { RetrievalProfile } from "../../../common/document-types";

export type EmbeddingPurpose = "query" | "document";

export interface SparseVector {
  indices: number[];
  values: number[];
}

export interface EmbeddingVector {
  dense: number[];
  sparse: SparseVector | null;
}

export interface EmbeddingContext {
  retrievalProfile?: RetrievalProfile;
  sourceType?: string;
  chunkType?: string;
}

export interface EmbeddingProvider {
  readonly dimension?: number;
  embed(input: string[], purpose?: EmbeddingPurpose, contexts?: EmbeddingContext[]): Promise<EmbeddingVector[]>;
}

export const EmbeddingProvider = Symbol("EmbeddingProvider");
