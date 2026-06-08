import type {
  EmbeddingContext,
  EmbeddingPort,
  EmbeddingPurpose,
  EmbeddingVector,
  LlmProviderPort,
} from '@cube-ai/contracts';

export interface LlmProviderEmbeddingPortConfig {
  provider: LlmProviderPort;
  modelCode: string;
  tenant: number;
  dimension: number;
  /** When set, overrides {@link modelCode} per embed call (e.g. per-turn skill model). */
  resolveModelCode?: () => string | undefined;
}

/** Thin EmbeddingPort delegating to LlmProviderPort.embed (G3 dense+sparse). */
export class LlmProviderEmbeddingPort implements EmbeddingPort {
  readonly dimension: number;

  constructor(private readonly config: LlmProviderEmbeddingPortConfig) {
    this.dimension = config.dimension;
  }

  async embed(
    input: string[],
    purpose: EmbeddingPurpose = 'document',
    contexts: EmbeddingContext[] = [],
    signal?: AbortSignal,
  ): Promise<EmbeddingVector[]> {
    if (input.length === 0) {
      return [];
    }

    const modelCode =
      this.config.resolveModelCode?.()?.trim() || this.config.modelCode;

    const rows = await this.config.provider.embed(
      {
        tenant: this.config.tenant,
        modelCode,
        input,
        purpose,
        contexts: contexts.map((ctx) => ({
          retrievalProfile: ctx.retrievalProfile,
        })),
      },
      signal,
    );

    return rows.map((row) => ({
      dense: row.dense,
      sparse: row.sparse ?? null,
    }));
  }
}
