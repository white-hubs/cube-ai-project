import type { AdapterCallContext } from '@tachu/core';
import { LlmProviderEmbeddingPort } from '@cube-ai/embedding';
import type { LlmProviderPort } from '@cube-ai/contracts/platform';
import {
  TurnAwareEmbeddingRuntime,
  type TurnAwareEmbeddingRuntimeOptions,
} from './turn-aware-embedding-runtime';

export interface CreateTurnAwareEmbeddingRuntimeOptions {
  provider: LlmProviderPort;
  defaultModel: string;
  getTurnContext: () => AdapterCallContext | undefined;
  resolveModelCode: () => string | undefined;
  tenant: number;
  dimension: number;
}

export function createTurnAwareEmbeddingRuntime(
  options: CreateTurnAwareEmbeddingRuntimeOptions,
): TurnAwareEmbeddingRuntime {
  const embeddingPort = new LlmProviderEmbeddingPort({
    provider: options.provider,
    modelCode: options.defaultModel,
    tenant: options.tenant,
    dimension: options.dimension,
    resolveModelCode: options.resolveModelCode,
  });

  const runtimeOptions: TurnAwareEmbeddingRuntimeOptions = {
    embeddingPort,
    defaultModel: options.defaultModel,
    getTurnContext: options.getTurnContext,
    resolveModelCode: options.resolveModelCode,
    dimensions: options.dimension,
  };

  return new TurnAwareEmbeddingRuntime(runtimeOptions);
}
