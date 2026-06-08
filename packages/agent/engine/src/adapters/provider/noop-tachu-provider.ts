import {
  NoopProvider,
  type AdapterCallContext,
  type ChatRequest,
  type ChatResponse,
  type ChatStreamChunk,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type Message,
  type ModelInfo,
  type ProviderAdapter,
} from '@tachu/core';

/** Tachu-facing noop provider for handler unit tests and offline boot. */
export class NoopLLMProviderAdapter implements ProviderAdapter {
  readonly id = 'cube-ai-noop-provider';
  readonly name = 'CubeAI Noop Provider';
  private readonly delegate = new NoopProvider();

  listAvailableModels(): Promise<ModelInfo[]> {
    return this.delegate.listAvailableModels();
  }

  chat(
    request: ChatRequest,
    ctx: AdapterCallContext,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    return this.delegate.chat(request, ctx, signal);
  }

  chatStream(
    request: ChatRequest,
    ctx: AdapterCallContext,
    signal?: AbortSignal,
  ): AsyncIterable<ChatStreamChunk> {
    return this.delegate.chatStream(request, ctx, signal);
  }

  countTokens(messages: Message[], model: string): Promise<number> {
    return this.delegate.countTokens(messages, model);
  }
}
