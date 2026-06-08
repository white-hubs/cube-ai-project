/**
 * LlmHandler — ProviderAdapter.chat（非流式）。
 *
 * 权威来源：docs/detailed-design/03-core-adapters/provider.md
 */
import { Inject, Injectable } from '@dangao/bun-server';
import type { Message, ProviderAdapter } from '@tachu/core';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import { toAdapterCallContext, type ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';
import { AGENTIC_PROVIDER_TOKEN } from '@cube-ai/agent-engine/adapters/tokens';

export interface LlmHandlerInput {
  model?:       string;
  messages:     Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?:   number;
}

export interface LlmHandlerOutput {
  content: string;
  model:   string;
  usage?: {
    promptTokens:     number;
    completionTokens: number;
    totalTokens:      number;
  };
}

@Injectable()
export class LlmHandler implements ToolHandler<LlmHandlerInput, LlmHandlerOutput> {
  readonly kind = 'llm' as const;

  constructor(
    @Inject(AGENTIC_PROVIDER_TOKEN) private readonly provider: ProviderAdapter,
  ) {}

  async invoke(input: LlmHandlerInput, ctx: ToolHandlerCtx): Promise<LlmHandlerOutput> {
    if (!input.messages?.length) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'LlmHandler requires messages[]',
      );
    }

    const messages = input.messages as Message[];
    const model =
      input.model ??
      process.env['AGENTIC_ENGINE_TOOL_LLM_MODEL'] ??
      (await pickDefaultModel(this.provider));

    try {
      const response = await this.provider.chat(
        {
          model,
          messages,
          temperature: input.temperature,
          maxTokens:   input.maxTokens,
        },
        toAdapterCallContext(ctx),
        ctx.signal,
      );

      return {
        content: response.content,
        model,
        usage:   response.usage,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw AgenticEngineError.fromCode(
        'UPSTREAM_LLM_UNAVAILABLE',
        `LlmHandler: provider chat failed: ${msg}`,
      );
    }
  }
}

async function pickDefaultModel(p: ProviderAdapter): Promise<string> {
  try {
    const models = await p.listAvailableModels();
    const first = models[0]?.modelName;
    if (first) return first;
  } catch {
    /* fall through */
  }
  return 'noop';
}
