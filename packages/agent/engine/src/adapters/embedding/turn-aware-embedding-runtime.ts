import type {
  AdapterCallContext,
  EmbeddingRuntime,
  EmbeddingRuntimeProfile,
  SemanticEmbeddingRequest,
  SemanticEmbeddingResponse,
} from '@tachu/core';
import type { EmbeddingPort, EmbeddingPurpose } from '@cube-ai/contracts/platform';

export interface TurnAwareEmbeddingRuntimeOptions {
  embeddingPort: EmbeddingPort;
  /** Fallback when resolveModelCode() returns undefined (profile metadata only). */
  defaultModel: string;
  getTurnContext: () => AdapterCallContext | undefined;
  resolveModelCode: () => string | undefined;
  dimensions?: number | undefined;
  maxBatchSize?: number | undefined;
  maxInputTokens?: number | undefined;
  normalized?: boolean | undefined;
}

function resolvePurpose(req: SemanticEmbeddingRequest): EmbeddingPurpose {
  const task = req.taskType?.toLowerCase() ?? '';
  if (task.includes('query')) {
    return 'query';
  }
  return 'document';
}

/**
 * Per-turn {@link EmbeddingRuntime} delegating to contracts {@link EmbeddingPort}
 * (ADR-0005: engine memory uses @cube-ai/embedding, not LlmProviderPort.embed directly).
 */
export class TurnAwareEmbeddingRuntime implements EmbeddingRuntime {
  constructor(private readonly options: TurnAwareEmbeddingRuntimeOptions) {}

  describe(): EmbeddingRuntimeProfile {
    const model =
      this.options.resolveModelCode()?.trim() || this.options.defaultModel;
    return {
      providerId: 'cube-ai-embedding-port',
      model,
      ...(this.options.dimensions !== undefined
        ? { dimensions: this.options.dimensions }
        : { dimensions: this.options.embeddingPort.dimension }),
      ...(this.options.maxBatchSize !== undefined
        ? { maxBatchSize: this.options.maxBatchSize }
        : {}),
      ...(this.options.maxInputTokens !== undefined
        ? { maxInputTokens: this.options.maxInputTokens }
        : {}),
      ...(this.options.normalized !== undefined
        ? { normalized: this.options.normalized }
        : {}),
    };
  }

  async embed(
    req: SemanticEmbeddingRequest,
    _ctx: AdapterCallContext,
    signal?: AbortSignal,
  ): Promise<SemanticEmbeddingResponse> {
    const resolvedModel =
      req.model?.trim() ||
      this.options.resolveModelCode()?.trim() ||
      this.options.defaultModel;
    if (!resolvedModel) {
      return { embeddings: req.inputs.map(() => []) };
    }

    const turnCtx = this.options.getTurnContext();
    if (turnCtx === undefined) {
      throw new Error('TurnAwareEmbeddingRuntime: turn AdapterCallContext is not set');
    }

    const inputs = req.inputs.map((item) =>
      typeof item === 'string' ? item : JSON.stringify(item),
    );
    const vectors = await this.options.embeddingPort.embed(
      inputs,
      resolvePurpose(req),
      [],
      signal,
    );
    return {
      embeddings: vectors.map((row) => row.dense),
    };
  }
}
