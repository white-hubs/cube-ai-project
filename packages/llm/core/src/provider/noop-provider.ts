import type { LlmChatRequest, LlmChatResponse, LlmEmbedRequest, LlmEmbedResult, LlmProviderPort, LlmStreamChunk } from "@cube-ai/contracts";

export class NoopLlmProvider implements LlmProviderPort {
  async chat(_req: LlmChatRequest): Promise<LlmChatResponse> {
    return { content: "[noop]", finishReason: "stop" };
  }

  async *chatStream(_req: LlmChatRequest): AsyncIterable<LlmStreamChunk> {
    yield { delta: "[noop]", type: "text-delta" };
    yield { finishReason: "stop", type: "finish" };
  }

  async embed(req: LlmEmbedRequest): Promise<LlmEmbedResult[]> {
    return req.input.map(() => ({ dense: [0], sparse: null }));
  }
}
