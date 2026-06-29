import type { EmbeddingContext, EmbeddingPort, EmbeddingPurpose, EmbeddingVector } from "@cube-ai/contracts/platform";

import type { EmbeddingProvider as EmbeddingProviderContract } from "./embedding-provider";

/** Bridges contracts EmbeddingPort → kb EmbeddingProvider symbol. */
export class EmbeddingProviderAdapter implements EmbeddingProviderContract {
  constructor(private readonly embeddingPort: EmbeddingPort) {}

  get dimension(): number {
    return this.embeddingPort.dimension;
  }

  embed(input: string[], purpose?: EmbeddingPurpose, contexts?: EmbeddingContext[]): Promise<EmbeddingVector[]> {
    return this.embeddingPort.embed(input, purpose, contexts);
  }
}
