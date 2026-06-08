import { BadRequestException, Body, Controller, Inject, POST } from '@dangao/bun-server';
import {
  AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN,
  type LlmProviderPort,
} from '@cube-ai/contracts/platform';
import type { LlmChatRequest, LlmEmbedRequest, LlmMessage } from '@cube-ai/contracts';
import { LlmHttpTenantResolverService } from './request-tenant';

interface OpenAiChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

interface OpenAiEmbeddingRequest {
  model: string;
  input: string | string[];
}

function mapOpenAiMessages(messages: OpenAiChatCompletionRequest['messages']): LlmMessage[] {
  return messages.map((m) => ({
    role: m.role as LlmMessage['role'],
    content: m.content,
  }));
}

function toOpenAiChatResponse(model: string, result: Awaited<ReturnType<LlmProviderPort['chat']>>) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: result.content },
        finish_reason: result.finishReason === 'unknown' ? 'stop' : result.finishReason,
      },
    ],
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
    object: 'list',
    model,
    data: vectors.map((embedding, index) => ({
      object: 'embedding',
      index,
      embedding,
    })),
  };
}

/**
 * OpenAI-compatible LLM gateway (ADR-0003 network face).
 * Routes: POST /v1/chat/completions · POST /v1/embeddings
 */
@Controller('/v1')
export class LlmGatewayController {
  public constructor(
    @Inject(AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN)
    private readonly provider: LlmProviderPort,
    private readonly tenantResolver: LlmHttpTenantResolverService,
  ) {}

  @POST('/chat/completions')
  public async chatCompletions(@Body() body: OpenAiChatCompletionRequest): Promise<unknown> {
    if (body.stream) {
      throw new BadRequestException('stream=true not supported on gateway yet');
    }

    const req: LlmChatRequest = {
      tenant: this.tenantResolver.require(),
      modelCode: body.model,
      messages: mapOpenAiMessages(body.messages ?? []),
      temperature: body.temperature,
      maxTokens: body.max_tokens,
    };

    const result = await this.provider.chat(req);
    return toOpenAiChatResponse(body.model, result);
  }

  @POST('/embeddings')
  public async embeddings(@Body() body: OpenAiEmbeddingRequest): Promise<unknown> {
    const input = Array.isArray(body.input) ? body.input : [body.input];
    const req: LlmEmbedRequest = {
      tenant: this.tenantResolver.require(),
      modelCode: body.model,
      input,
    };
    const results = await this.provider.embed(req);
    return toOpenAiEmbeddingResponse(
      body.model,
      results.map((r) => r.dense),
    );
  }
}
