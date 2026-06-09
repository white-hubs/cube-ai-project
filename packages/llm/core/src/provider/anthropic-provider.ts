import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmEmbedRequest,
  LlmEmbedResult,
  LlmProviderPort,
  LlmStreamChunk,
} from '@cube-ai/contracts';
import { LlmProviderError } from './openai-compat-provider';

export interface AnthropicProviderConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicProvider implements LlmProviderPort {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AnthropicProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  async chat(req: LlmChatRequest, signal?: AbortSignal): Promise<LlmChatResponse> {
    const url = `${normalizeBaseUrl(this.config.baseURL)}/v1/messages`;
    const { system, messages } = splitSystemMessage(req.messages);
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: req.maxTokens ?? 4096,
      stream: false,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: anthropicHeaders(this.config.apiKey),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) throw mapHttpError(response.status, await response.text());

    const raw = (await response.json()) as AnthropicMessagesResponse;
    return mapNonStreamResponse(raw);
  }

  async *chatStream(req: LlmChatRequest, signal?: AbortSignal): AsyncIterable<LlmStreamChunk> {
    const url = `${normalizeBaseUrl(this.config.baseURL)}/v1/messages`;
    const { system, messages } = splitSystemMessage(req.messages);
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: anthropicHeaders(this.config.apiKey),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) throw mapHttpError(response.status, await response.text());
    if (!response.body) throw new LlmProviderError('UPSTREAM_LLM_UNAVAILABLE', 'Missing stream body', true);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason: LlmChatResponse['finishReason'] = 'stop';
    let outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      let currentEvent = '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim();
          continue;
        }
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let evt: AnthropicStreamEvent;
        try {
          evt = JSON.parse(payload) as AnthropicStreamEvent;
        } catch {
          continue;
        }

        const evtType = evt.type ?? currentEvent;

        if (evtType === 'content_block_delta') {
          const delta = (evt as AnthropicContentBlockDelta).delta;
          if (delta?.type === 'text_delta' && delta.text) {
            yield { type: 'text-delta', delta: delta.text };
          }
        } else if (evtType === 'message_delta') {
          const d = (evt as AnthropicMessageDelta).delta;
          if (d?.stop_reason) {
            finishReason = mapStopReason(d.stop_reason);
          }
          const usage = (evt as AnthropicMessageDelta).usage;
          if (usage?.output_tokens) outputTokens = usage.output_tokens;
        } else if (evtType === 'message_start') {
          const inputTokens = (evt as AnthropicMessageStart).message?.usage?.input_tokens ?? 0;
          if (inputTokens) outputTokens = inputTokens;
        }
      }
    }

    yield { type: 'finish', finishReason };
  }

  async embed(_req: LlmEmbedRequest, _signal?: AbortSignal): Promise<LlmEmbedResult[]> {
    throw new LlmProviderError(
      'UPSTREAM_LLM_UNAVAILABLE',
      'Anthropic does not support embed; use a dedicated embedding model via LlmProviderPort',
    );
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

function splitSystemMessage(messages: LlmChatRequest['messages']): {
  system: string | undefined;
  messages: AnthropicMessage[];
} {
  let system: string | undefined;
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system = system ? `${system}\n${m.content}` : m.content;
    } else if (m.role === 'user' || m.role === 'assistant') {
      out.push({ role: m.role, content: m.content });
    }
    // tool messages not mapped — Anthropic uses tool_result blocks; skip for now
  }
  return { system, messages: out };
}

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'Content-Type': 'application/json',
  };
}

function normalizeBaseUrl(baseURL: string): string {
  return baseURL.replace(/\/+$/, '');
}

// ── Response mapping ──────────────────────────────────────────────────────────

interface AnthropicMessagesResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function mapNonStreamResponse(raw: AnthropicMessagesResponse): LlmChatResponse {
  const textParts = (raw.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '');
  const content = textParts.join('');
  return {
    content,
    finishReason: mapStopReason(raw.stop_reason),
    usage: raw.usage
      ? {
          promptTokens: raw.usage.input_tokens ?? 0,
          completionTokens: raw.usage.output_tokens ?? 0,
          totalTokens: (raw.usage.input_tokens ?? 0) + (raw.usage.output_tokens ?? 0),
        }
      : undefined,
  };
}

function mapStopReason(raw: string | null | undefined): LlmChatResponse['finishReason'] {
  switch (raw) {
    case 'end_turn':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    default:
      return 'unknown';
  }
}

// ── Stream event types ────────────────────────────────────────────────────────

interface AnthropicStreamEvent {
  type?: string;
}

interface AnthropicContentBlockDelta extends AnthropicStreamEvent {
  type: 'content_block_delta';
  index: number;
  delta?: { type: string; text?: string };
}

interface AnthropicMessageDelta extends AnthropicStreamEvent {
  type: 'message_delta';
  delta?: { stop_reason?: string };
  usage?: { output_tokens?: number };
}

interface AnthropicMessageStart extends AnthropicStreamEvent {
  type: 'message_start';
  message?: { usage?: { input_tokens?: number } };
}

// ── Error mapping ─────────────────────────────────────────────────────────────

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
