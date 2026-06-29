import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmEmbedRequest,
  LlmEmbedResult,
  LlmMessage,
  LlmProviderPort,
  LlmStreamChunk,
  LlmToolCall,
} from "@cube-ai/contracts";

import { LlmProviderError } from "./openai-compat-provider";

export interface AnthropicProviderConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicProvider implements LlmProviderPort {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AnthropicProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  async chat(req: LlmChatRequest, signal?: AbortSignal): Promise<LlmChatResponse> {
    const url = `${normalizeBaseUrl(this.config.baseURL)}/v1/messages`;
    const { system, messages } = messagesToAnthropic(req.messages);
    const tools = toolsToAnthropic(req.tools);
    const body: Record<string, unknown> = {
      max_tokens: req.maxTokens ?? 4096,
      messages,
      model: this.config.model,
      stream: false,
    };
    if (system) {
      body.system = system;
    }
    if (req.temperature !== undefined) {
      body.temperature = req.temperature;
    }
    if (tools?.length) {
      body.tools = tools;
    }

    const response = await this.fetchImpl(url, {
      body: JSON.stringify(body),
      headers: anthropicHeaders(this.config.apiKey),
      method: "POST",
      signal,
    });

    if (!response.ok) {
      throw mapHttpError(response.status, await response.text());
    }

    const raw = (await response.json()) as AnthropicMessagesResponse;
    return mapNonStreamResponse(raw);
  }

  async *chatStream(req: LlmChatRequest, signal?: AbortSignal): AsyncIterable<LlmStreamChunk> {
    const url = `${normalizeBaseUrl(this.config.baseURL)}/v1/messages`;
    const { system, messages } = messagesToAnthropic(req.messages);
    const tools = toolsToAnthropic(req.tools);
    const body: Record<string, unknown> = {
      max_tokens: req.maxTokens ?? 4096,
      messages,
      model: this.config.model,
      stream: true,
    };
    if (system) {
      body.system = system;
    }
    if (req.temperature !== undefined) {
      body.temperature = req.temperature;
    }
    if (tools?.length) {
      body.tools = tools;
    }

    const response = await this.fetchImpl(url, {
      body: JSON.stringify(body),
      headers: anthropicHeaders(this.config.apiKey),
      method: "POST",
      signal,
    });

    if (!response.ok) {
      throw mapHttpError(response.status, await response.text());
    }
    if (!response.body) {
      throw new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", "Missing stream body", true);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolBuf = new Map<number, { id: string; name: string; json: string }>();
    let finishReason: LlmChatResponse["finishReason"] = "stop";
    let usage: LlmChatResponse["usage"];

    while (true) {
      const { done, value } = await reader.read();
      let lines: string[];
      if (done) {
        // Flush any trailing partial line so a final SSE event that lacks a
        // terminating newline is not silently dropped on stream end.
        const tail = buffer.trim();
        if (!tail) {
          break;
        }
        lines = [buffer];
        buffer = "";
      } else {
        buffer += decoder.decode(value, { stream: true });
        lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
      }

      let currentEvent = "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("event:")) {
          currentEvent = trimmed.slice(6).trim();
          continue;
        }
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          continue;
        }

        let evt: AnthropicStreamEvent;
        try {
          evt = JSON.parse(payload) as AnthropicStreamEvent;
        } catch {
          continue;
        }

        const evtType = evt.type ?? currentEvent;

        if (evtType === "message_start") {
          const inputTokens = (evt as AnthropicMessageStart).message?.usage?.input_tokens ?? 0;
          const outputTokens = (evt as AnthropicMessageStart).message?.usage?.output_tokens ?? 0;
          if (inputTokens || outputTokens) {
            usage = {
              completionTokens: outputTokens,
              promptTokens: inputTokens,
              totalTokens: inputTokens + outputTokens,
            };
          }
        } else if (evtType === "content_block_start") {
          const block = (evt as AnthropicContentBlockStart).content_block;
          if (block?.type === "tool_use") {
            toolBuf.set((evt as AnthropicContentBlockStart).index, {
              id: block.id,
              json: "",
              name: block.name,
            });
          }
        } else if (evtType === "content_block_delta") {
          yield* emitAnthropicContentBlockDelta(evt as AnthropicContentBlockDelta, toolBuf);
        } else if (evtType === "content_block_stop") {
          yield* emitAnthropicContentBlockStop(evt as AnthropicContentBlockStop, toolBuf);
        } else if (evtType === "message_delta") {
          const d = (evt as AnthropicMessageDelta).delta;
          if (d?.stop_reason) {
            finishReason = mapStopReason(d.stop_reason);
          }
          const outputTokens = (evt as AnthropicMessageDelta).usage?.output_tokens;
          if (outputTokens !== undefined) {
            const promptTokens = usage?.promptTokens ?? 0;
            usage = {
              completionTokens: outputTokens,
              promptTokens,
              totalTokens: promptTokens + outputTokens,
            };
          }
        }
      }
    }

    yield { finishReason, type: "finish", usage };
  }

  async embed(_req: LlmEmbedRequest, _signal?: AbortSignal): Promise<LlmEmbedResult[]> {
    throw new LlmProviderError(
      "UPSTREAM_LLM_UNAVAILABLE",
      "Anthropic does not support embed; use a dedicated embedding model via LlmProviderPort",
    );
  }
}

// ── Anthropic message / tool mapping (aligned with cube-agentic-engine) ─────

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessageParam {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

function toolsToAnthropic(tools: LlmChatRequest["tools"]): AnthropicTool[] | undefined {
  if (!tools?.length) {
    return undefined;
  }
  return tools.map((t) => ({
    description: t.description,
    input_schema: normalizeInputSchema(t.inputSchema ?? {}),
    name: t.name,
  }));
}

function normalizeInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type === "object") {
    return schema;
  }
  return { type: "object", ...schema };
}

function messagesToAnthropic(messages: LlmMessage[]): {
  system: string | undefined;
  messages: AnthropicMessageParam[];
} {
  const sys: string[] = [];
  const out: AnthropicMessageParam[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      sys.push(m.content);
      continue;
    }
    if (m.role === "user") {
      out.push({ content: m.content, role: "user" });
    } else if (m.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (m.content) {
        blocks.push({ type: "text", text: m.content });
      }
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          blocks.push({
            id: tc.id,
            input: tc.arguments,
            name: tc.name,
            type: "tool_use",
          });
        }
      }
      const first = blocks[0];
      out.push({
        content: blocks.length === 1 && first?.type === "text" ? first.text : blocks,
        role: "assistant",
      });
    } else if (m.role === "tool") {
      out.push({
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId ?? "",
            content: m.content,
          },
        ],
        role: "user",
      });
    }
  }

  return { messages: out, system: sys.length > 0 ? sys.join("\n\n") : undefined };
}

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
    "x-api-key": apiKey,
  };
}

function normalizeBaseUrl(baseURL: string): string {
  return baseURL.replace(/\/+$/u, "");
}

// ── Response mapping ────────────────────────────────────────────────────────

interface AnthropicMessagesResponse {
  content?: {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    thinking?: string;
  }[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function mapNonStreamResponse(raw: AnthropicMessagesResponse): LlmChatResponse {
  let text = "";
  let reasoningText = "";
  const toolCalls: LlmToolCall[] = [];

  for (const block of raw.content ?? []) {
    if (block.type === "text") {
      text += block.text ?? "";
    } else if (block.type === "thinking") {
      const t = block.thinking;
      if (typeof t === "string" && t.length > 0) {
        reasoningText += t;
      }
    } else if (block.type === "tool_use") {
      toolCalls.push({
        arguments: typeof block.input === "object" && block.input !== null && !Array.isArray(block.input) ? block.input : {},
        id: block.id ?? "",
        name: block.name ?? "",
      });
    }
  }

  return {
    content: text,
    ...(reasoningText.length > 0 ? { reasoningContent: reasoningText } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    finishReason: mapStopReason(raw.stop_reason),
    usage: raw.usage
      ? {
          completionTokens: raw.usage.output_tokens ?? 0,
          promptTokens: raw.usage.input_tokens ?? 0,
          totalTokens: (raw.usage.input_tokens ?? 0) + (raw.usage.output_tokens ?? 0),
        }
      : undefined,
  };
}

function mapStopReason(raw: string | null | undefined): LlmChatResponse["finishReason"] {
  switch (raw) {
    case "end_turn":
    case "stop_sequence": {
      return "stop";
    }
    case "max_tokens": {
      return "length";
    }
    case "tool_use": {
      return "tool_calls";
    }
    default: {
      return "unknown";
    }
  }
}

function* emitAnthropicContentBlockDelta(
  evt: AnthropicContentBlockDelta,
  toolBuf: Map<number, { id: string; name: string; json: string }>,
): Generator<LlmStreamChunk, void, void> {
  const delta = evt.delta;
  if (delta?.type === "text_delta" && delta.text) {
    yield { delta: delta.text, type: "text-delta" };
    return;
  }
  if (delta?.type === "input_json_delta" && delta.partial_json) {
    const slot = toolBuf.get(evt.index);
    if (slot) {
      slot.json += delta.partial_json;
    }
    yield {
      argumentsDelta: delta.partial_json,
      index: evt.index,
      type: "tool-call-delta",
    };
    return;
  }
  if (delta?.type === "thinking_delta") {
    const thinking = (delta as { thinking?: string }).thinking;
    if (typeof thinking === "string" && thinking.length > 0) {
      yield { delta: thinking, type: "reasoning-delta" };
    }
  }
}

function* emitAnthropicContentBlockStop(
  evt: AnthropicContentBlockStop,
  toolBuf: Map<number, { id: string; name: string; json: string }>,
): Generator<LlmStreamChunk, void, void> {
  const slot = toolBuf.get(evt.index);
  if (!slot?.name) {
    return;
  }
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(slot.json || "{}") as Record<string, unknown>;
  } catch {
    throw new LlmProviderError("UPSTREAM_LLM_INVALID_INPUT", "Anthropic tool input JSON 非法");
  }
  yield {
    call: { arguments: args, id: slot.id, name: slot.name },
    type: "tool-call-complete",
  };
}

// ── Stream event types ────────────────────────────────────────────────────────

interface AnthropicStreamEvent {
  type?: string;
}

interface AnthropicContentBlockStart extends AnthropicStreamEvent {
  type: "content_block_start";
  index: number;
  content_block?: { type: string; id: string; name: string };
}

interface AnthropicContentBlockDelta extends AnthropicStreamEvent {
  type: "content_block_delta";
  index: number;
  delta?: { type: string; text?: string; partial_json?: string };
}

interface AnthropicContentBlockStop extends AnthropicStreamEvent {
  type: "content_block_stop";
  index: number;
}

interface AnthropicMessageDelta extends AnthropicStreamEvent {
  type: "message_delta";
  delta?: { stop_reason?: string };
  usage?: { output_tokens?: number };
}

interface AnthropicMessageStart extends AnthropicStreamEvent {
  type: "message_start";
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
}

function mapHttpError(status: number, body: string): LlmProviderError {
  if (status === 401 || status === 403) {
    return new LlmProviderError("UPSTREAM_LLM_AUTH_FAILED", body);
  }
  if (status === 429) {
    return new LlmProviderError("UPSTREAM_LLM_RATE_LIMITED", body, true);
  }
  if (status >= 500) {
    return new LlmProviderError("UPSTREAM_LLM_UNAVAILABLE", body, true);
  }
  return new LlmProviderError("UPSTREAM_LLM_INVALID_INPUT", body);
}
