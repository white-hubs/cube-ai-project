import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmEmbedRequest,
  LlmEmbedResult,
  LlmMessage,
  LlmProviderPort,
  LlmStreamChunk,
  LlmToolCall,
} from '@cube-ai/contracts';
import { llmDebug } from './debug-log';

export class LlmProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

export interface OpenAiCompatConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class OpenAiCompatProvider implements LlmProviderPort {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OpenAiCompatConfig) {
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  async chat(req: LlmChatRequest, signal?: AbortSignal): Promise<LlmChatResponse> {
    const url = `${normalizeBaseUrl(this.config.baseURL)}/chat/completions`;
    const tools = toolsToOpenAI(req.tools);
    const startedAt = Date.now();
    llmDebug('openai.chat.request', {
      url,
      model: this.config.model,
      stream: false,
      msgCount: req.messages.length,
      toolCount: tools?.length ?? 0,
    });
    const response = await this.fetchImpl(
      url,
      {
        method: 'POST',
        headers: authHeaders(this.config.apiKey),
        body: JSON.stringify({
          model: this.config.model,
          messages: messagesToOpenAI(req.messages),
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: false,
          ...(tools?.length ? { tools, tool_choice: 'auto' as const } : {}),
        }),
        signal,
      },
    );
    llmDebug('openai.chat.response', {
      url,
      model: this.config.model,
      status: response.status,
      ok: response.ok,
      elapsedMs: Date.now() - startedAt,
    });
    if (!response.ok) throw mapHttpError(response.status, await response.text());
    const body = (await response.json()) as OpenAiChatCompletion;
    const choice = body.choices?.[0];
    const msg = choice?.message;
    const content = typeof msg?.content === 'string' ? msg.content : '';
    const reasoningContent =
      typeof msg?.reasoning_content === 'string' && msg.reasoning_content.length > 0
        ? msg.reasoning_content
        : undefined;
    const toolCalls = parseToolCalls(msg?.tool_calls);

    return {
      content,
      ...(reasoningContent ? { reasoningContent } : {}),
      ...(toolCalls?.length ? { toolCalls } : {}),
      finishReason: mapFinishReason(choice?.finish_reason),
      usage: body.usage
        ? {
            promptTokens: body.usage.prompt_tokens,
            completionTokens: body.usage.completion_tokens,
            totalTokens: body.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *chatStream(req: LlmChatRequest, signal?: AbortSignal): AsyncIterable<LlmStreamChunk> {
    const url = `${normalizeBaseUrl(this.config.baseURL)}/chat/completions`;
    const tools = toolsToOpenAI(req.tools);
    const startedAt = Date.now();
    llmDebug('openai.chatStream.request', {
      url,
      model: this.config.model,
      stream: true,
      msgCount: req.messages.length,
      toolCount: tools?.length ?? 0,
    });
    const response = await this.fetchImpl(
      url,
      {
        method: 'POST',
        headers: authHeaders(this.config.apiKey),
        body: JSON.stringify({
          model: this.config.model,
          messages: messagesToOpenAI(req.messages),
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
          ...(tools?.length ? { tools, tool_choice: 'auto' as const } : {}),
        }),
        signal,
      },
    );
    if (!response.ok) throw mapHttpError(response.status, await response.text());
    if (!response.body) throw new LlmProviderError('UPSTREAM_LLM_UNAVAILABLE', 'Missing stream body', true);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason: LlmChatResponse['finishReason'] = 'stop';
    let usage: LlmChatResponse['usage'];
    const toolAcc = new Map<number, { id?: string; name?: string; args: string }>();
    let sseChunks = 0;
    let textChunks = 0;
    let reasoningChunks = 0;
    let toolDeltaChunks = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        let chunk: OpenAiStreamChunk;
        try {
          chunk = JSON.parse(payload) as OpenAiStreamChunk;
        } catch {
          llmDebug('openai.chatStream.parse.skip', { model: this.config.model, payloadLen: payload.length });
          continue;
        }
        sseChunks += 1;
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) {
          textChunks += 1;
          yield { type: 'text-delta', delta: delta.content };
        }
        if (delta?.reasoning_content) {
          reasoningChunks += 1;
          yield { type: 'reasoning-delta', delta: delta.reasoning_content };
        }
        if (delta?.tool_calls) {
          for (const [i, tc] of delta.tool_calls.entries()) {
            toolDeltaChunks += 1;
            const idx = tc.index ?? i;
            let slot = toolAcc.get(idx);
            if (!slot) {
              slot = { args: '' };
              toolAcc.set(idx, slot);
            }
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name = tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
            yield {
              type: 'tool-call-delta',
              index: idx,
              id: tc.id ?? slot.id,
              name: tc.function?.name ?? slot.name,
              argumentsDelta: tc.function?.arguments,
            };
          }
        }
        // Some OpenAI-compatible gateways (e.g. geekai) emit complete tool_calls on `message`.
        const message = choice?.message;
        if (message?.content) {
          textChunks += 1;
          yield { type: 'text-delta', delta: message.content };
        }
        if (message?.reasoning_content) {
          reasoningChunks += 1;
          yield { type: 'reasoning-delta', delta: message.reasoning_content };
        }
        if (message?.tool_calls) {
          for (const [i, tc] of message.tool_calls.entries()) {
            if (tc.type !== 'function') continue;
            const idx = i;
            let slot = toolAcc.get(idx);
            if (!slot) {
              slot = { args: '' };
              toolAcc.set(idx, slot);
            }
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name = tc.function.name;
            if (tc.function?.arguments) slot.args = tc.function.arguments;
            toolDeltaChunks += 1;
          }
        }
        const finish = choice?.finish_reason;
        if (finish) finishReason = mapFinishReason(finish);
      }
    }

    llmDebug('openai.chatStream.done', {
      url,
      model: this.config.model,
      elapsedMs: Date.now() - startedAt,
      sseChunks,
      textChunks,
      reasoningChunks,
      toolDeltaChunks,
      toolAccSize: toolAcc.size,
      finishReason,
    });

    for (const [, slot] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
      if (!slot.name) continue;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(slot.args || '{}') as Record<string, unknown>;
      } catch {
        throw new LlmProviderError('UPSTREAM_LLM_INVALID_INPUT', '流式工具 arguments 拼接后非合法 JSON');
      }
      yield {
        type: 'tool-call-complete',
        call: {
          id: slot.id ?? `call-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: slot.name,
          arguments: args,
        },
      };
    }

    yield { type: 'finish', finishReason, usage };
  }

  async embed(req: LlmEmbedRequest, signal?: AbortSignal): Promise<LlmEmbedResult[]> {
    const url = `${normalizeBaseUrl(this.config.baseURL)}/embeddings`;
    const response = await this.fetchImpl(
      url,
      {
        method: 'POST',
        headers: authHeaders(this.config.apiKey),
        body: JSON.stringify({
          model: this.config.model,
          input: req.input,
          encoding_format: 'float',
        }),
        signal,
      },
    );
    if (!response.ok) throw mapHttpError(response.status, await response.text());
    const body = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    return (body.data ?? []).map((row) => ({ dense: row.embedding ?? [] }));
  }
}

// ── OpenAI message / tool mapping (aligned with cube-agentic-engine) ─────────

interface OpenAiChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAiChatCompletion {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface OpenAiStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    message?: {
      content?: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function toolsToOpenAI(
  tools: LlmChatRequest['tools'],
): Array<{ type: 'function'; function: { name: string; description?: string; parameters?: Record<string, unknown> } }> | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

function messagesToOpenAI(messages: LlmMessage[]): OpenAiChatMessage[] {
  const out: OpenAiChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'user') {
      out.push({ role: m.role, content: m.content });
    } else if (m.role === 'assistant') {
      const base: OpenAiChatMessage = {
        role: 'assistant',
        content: m.toolCalls?.length ? m.content || null : m.content,
      };
      if (m.toolCalls?.length) {
        base.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments ?? {}),
          },
        }));
      }
      out.push(base);
    } else if (m.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: m.toolCallId ?? '',
        content: m.content,
      });
    }
  }
  return out;
}

type OpenAiToolCall = NonNullable<
  NonNullable<NonNullable<OpenAiChatCompletion['choices']>[number]['message']>['tool_calls']
>[number];

function parseToolCalls(raw: OpenAiToolCall[] | undefined): LlmToolCall[] | undefined {
  if (!raw?.length) return undefined;
  const toolCalls: LlmToolCall[] = [];
  for (const tc of raw) {
    if (tc.type !== 'function') continue;
    const argStr = tc.function.arguments ?? '{}';
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argStr) as Record<string, unknown>;
    } catch {
      throw new LlmProviderError('UPSTREAM_LLM_INVALID_INPUT', '工具调用 arguments 非合法 JSON');
    }
    toolCalls.push({
      id: tc.id,
      name: tc.function.name,
      arguments: args,
    });
  }
  return toolCalls.length ? toolCalls : undefined;
}

function normalizeBaseUrl(baseURL: string): string {
  return baseURL.replace(/\/+$/, '');
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

function mapFinishReason(raw: string | null | undefined): LlmChatResponse['finishReason'] {
  switch (raw) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
      return 'tool_calls';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'unknown';
  }
}

function mapHttpError(status: number, body: string): LlmProviderError {
  if (status === 401 || status === 403) {
    return new LlmProviderError('UPSTREAM_LLM_AUTH_FAILED', body);
  }
  if (status === 429) {
    return new LlmProviderError('UPSTREAM_LLM_RATE_LIMITED', body, true);
  }
  if (status >= 500) {
    return new LlmProviderError('UPSTREAM_LLM_UNAVAILABLE', body, true);
  }
  return new LlmProviderError('UPSTREAM_LLM_INVALID_INPUT', body);
}
