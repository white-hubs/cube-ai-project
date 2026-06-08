import type { LlmChatRequest, LlmChatResponse, LlmEmbedRequest, LlmEmbedResult, LlmProviderPort, LlmStreamChunk } from '@cube-ai/contracts';

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
    const response = await this.fetchImpl(
      url,
      {
        method: 'POST',
        headers: authHeaders(this.config.apiKey),
        body: JSON.stringify({
          model: this.config.model,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: false,
        }),
        signal,
      },
    );
    if (!response.ok) throw mapHttpError(response.status, await response.text());
    const body = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string | null; reasoning_content?: string | null };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    const choice = body.choices?.[0];
    const content = choice?.message?.content ?? '';
    const reasoningContent = choice?.message?.reasoning_content ?? undefined;
    return {
      content: typeof content === 'string' ? content : '',
      ...(reasoningContent ? { reasoningContent } : {}),
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
    const response = await this.fetchImpl(
      url,
      {
        method: 'POST',
        headers: authHeaders(this.config.apiKey),
        body: JSON.stringify({
          model: this.config.model,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          stream: true,
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
        const chunk = JSON.parse(payload) as {
          choices?: Array<{
            delta?: { content?: string; reasoning_content?: string };
            finish_reason?: string | null;
          }>;
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        };
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) yield { type: 'text-delta', delta: delta.content };
        if (delta?.reasoning_content) yield { type: 'reasoning-delta', delta: delta.reasoning_content };
        const finish = chunk.choices?.[0]?.finish_reason;
        if (finish) finishReason = mapFinishReason(finish);
      }
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
