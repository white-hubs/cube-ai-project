import { BadRequestException, Body, Controller, Inject, POST } from "@dangao/bun-server";

import { type LlmChatRequest, type LlmEmbedRequest, type LlmMessage } from "@cube-ai/contracts";
import { AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN, type LlmProviderPort } from "@cube-ai/contracts/platform";

import { LlmHttpTenantResolverService } from "./request-tenant";

interface OpenAiChatCompletionRequest {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

interface OpenAiEmbeddingRequest {
  model: string;
  input: string | string[];
}

function mapOpenAiMessages(messages: OpenAiChatCompletionRequest["messages"]): LlmMessage[] {
  return messages.map((m) => ({
    content: m.content,
    role: m.role as LlmMessage["role"],
  }));
}

function toOpenAiChatResponse(model: string, result: Awaited<ReturnType<LlmProviderPort["chat"]>>) {
  return {
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: result.content },
        finish_reason: result.finishReason === "unknown" ? "stop" : result.finishReason,
      },
    ],
    id: `chatcmpl-${Date.now()}`,
    model,
    object: "chat.completion",
    usage: result.usage
      ? {
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          total_tokens: result.usage.totalTokens,
        }
      : undefined,
  };
}

function toOpenAiEmbeddingResponse(model: string, vectors: number[][]) {
  return {
    data: vectors.map((embedding, index) => ({
      object: "embedding",
      index,
      embedding,
    })),
    model,
    object: "list",
  };
}

/**
 * OpenAI-compatible LLM gateway (ADR-0003 network face).
 * Routes: POST /v1/chat/completions · POST /v1/embeddings
 */
@Controller("/v1")
export class LlmGatewayController {
  public constructor(
    @Inject(AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN)
    private readonly provider: LlmProviderPort,
    private readonly tenantResolver: LlmHttpTenantResolverService,
  ) {}

  @POST("/chat/completions")
  public async chatCompletions(@Body() body: OpenAiChatCompletionRequest): Promise<unknown> {
    if (body.stream) {
      throw new BadRequestException("stream=true not supported on gateway yet");
    }

    const req: LlmChatRequest = {
      maxTokens: body.max_tokens,
      messages: mapOpenAiMessages(body.messages ?? []),
      modelCode: body.model,
      temperature: body.temperature,
      tenant: this.tenantResolver.require(),
    };

    const result = await this.provider.chat(req);
    return toOpenAiChatResponse(body.model, result);
  }

  @POST("/embeddings")
  public async embeddings(@Body() body: OpenAiEmbeddingRequest): Promise<unknown> {
    const input = Array.isArray(body.input) ? body.input : [body.input];
    const req: LlmEmbedRequest = {
      input,
      modelCode: body.model,
      tenant: this.tenantResolver.require(),
    };
    const results = await this.provider.embed(req);
    return toOpenAiEmbeddingResponse(
      body.model,
      results.map((r) => r.dense),
    );
  }
}
