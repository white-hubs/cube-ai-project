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

import { isGeekaiHost } from "./catalog-provider-routing";
import { llmDebug } from "./debug-log";

export class LlmProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "LlmProviderError";
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
    const toolNames = OpenAiToolNameMap.fromRequest(req);
    const tools = toolsToOpenAI(req.tools, toolNames);
    const startedAt = Date.now();
    llmDebug("openai.chat.request", {
      model: this.config.model,
      msgCount: req.messages.length,
      stream: false,
      toolCount: tools?.length ?? 0,
      url,
    });
    const response = await this.fetchImpl(url, {
      body: JSON.stringify({
        model: this.config.model,
        messages: messagesToOpenAI(req.messages, toolNames),
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        stream: false,
        ...(tools?.length ? { tools, tool_choice: "auto" as const } : {}),
      }),
      headers: authHeaders(this.config.apiKey),
      method: "POST",
      signal,
    });
    llmDebug("openai.chat.response", {
      elapsedMs: Date.now() - startedAt,
      model: this.config.model,
      ok: response.ok,
      status: response.status,
      url,
    });
    if (!response.ok) {
      throw mapHttpError(response.status, await response.text());
    }
    const body = (await response.json()) as OpenAiChatCompletion;
    const choice = body.choices?.[0];
    const msg = choice?.message;
    const content = typeof msg?.content === "string" ? msg.content : "";
    const reasoningContent =
      typeof msg?.reasoning_content === "string" && msg.reasoning_content.length > 0 ? msg.reasoning_content : undefined;
    const toolCalls = parseToolCalls(msg?.tool_calls, toolNames);

    return {
      content,
      ...(reasoningContent ? { reasoningContent } : {}),
      ...(toolCalls?.length ? { toolCalls } : {}),
      finishReason: mapFinishReason(choice?.finish_reason),
      usage: body.usage
        ? {
            completionTokens: body.usage.completion_tokens,
            promptTokens: body.usage.prompt_tokens,
            totalTokens: body.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *chatStream(req: LlmChatRequest, signal?: AbortSignal): AsyncIterable<LlmStreamChunk> {
    const url = `${normalizeBaseUrl(this.config.baseURL)}/chat/completions`;
    const toolNames = OpenAiToolNameMap.fromRequest(req);
    const tools = toolsToOpenAI(req.tools, toolNames);
    const geekaiHost = isGeekaiHost(this.config.baseURL);
    const startedAt = Date.now();
    llmDebug("openai.chatStream.request", {
      model: this.config.model,
      msgCount: req.messages.length,
      stream: true,
      toolCount: tools?.length ?? 0,
      url,
    });
    const response = await this.fetchImpl(url, {
      body: JSON.stringify({
        model: this.config.model,
        messages: messagesToOpenAI(req.messages, toolNames),
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        stream: true,
        // geekai and some aggregators reject or mishandle stream_options → empty body.
        ...(geekaiHost ? {} : { stream_options: { include_usage: true } }),
        ...(tools?.length ? { tools, tool_choice: "auto" as const } : {}),
      }),
      headers: authHeaders(this.config.apiKey),
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
    let rawBody = "";
    let finishReason: LlmChatResponse["finishReason"] = "stop";
    let usage: LlmChatResponse["usage"];
    const toolAcc = new Map<number, { id?: string; name?: string; args: string }>();
    let sseChunks = 0;
    let textChunks = 0;
    let reasoningChunks = 0;
    let toolDeltaChunks = 0;
    let streamFallback: "none" | "json" | "chat" = "none";

    while (true) {
      const { done, value } = await reader.read();
      let lines: string[];
      if (done) {
        // Flush any trailing partial line. Some OpenAI-compatible gateways
        // (e.g. geekai) consolidate the turn into a single SSE frame and omit
        // the terminating newline on the final `data:` line; without this flush
        // that line stays in `buffer` and is silently dropped → empty terminal.
        const tail = buffer.trim();
        if (!tail) {
          break;
        }
        lines = [buffer];
        buffer = "";
      } else {
        const piece = decoder.decode(value, { stream: true });
        rawBody += piece;
        buffer += piece;
        lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
      }
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          continue;
        }
        let chunk: OpenAiStreamChunk;
        try {
          chunk = JSON.parse(payload) as OpenAiStreamChunk;
        } catch {
          llmDebug("openai.chatStream.parse.skip", { model: this.config.model, payloadLen: payload.length });
          continue;
        }
        sseChunks += 1;
        const applied = applyOpenAiStreamChoice(
          chunk,
          toolAcc,
          {
            reasoningChunks,
            textChunks,
            toolDeltaChunks,
          },
          toolNames,
        );
        textChunks = applied.textChunks;
        reasoningChunks = applied.reasoningChunks;
        toolDeltaChunks = applied.toolDeltaChunks;
        if (chunk.usage) {
          usage = {
            completionTokens: chunk.usage.completion_tokens,
            promptTokens: chunk.usage.prompt_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
        if (applied.finishReason) {
          finishReason = applied.finishReason;
        }
        for (const out of applied.yields) {
          yield out;
        }
      }
    }

    // Some gateways answer stream=true with a single application/json body (no SSE framing).
    if (sseChunks === 0 && rawBody.trim()) {
      try {
        const body = JSON.parse(rawBody.trim()) as OpenAiChatCompletion;
        const choice = body.choices?.[0];
        if (choice) {
          streamFallback = "json";
          sseChunks = 1;
          llmDebug("openai.chatStream.fallback.json", {
            model: this.config.model,
            rawBodyLen: rawBody.length,
          });
          const applied = applyOpenAiCompletionChoice(
            choice,
            toolAcc,
            {
              reasoningChunks,
              textChunks,
              toolDeltaChunks,
            },
            toolNames,
          );
          textChunks = applied.textChunks;
          reasoningChunks = applied.reasoningChunks;
          toolDeltaChunks = applied.toolDeltaChunks;
          if (body.usage) {
            usage = {
              completionTokens: body.usage.completion_tokens,
              promptTokens: body.usage.prompt_tokens,
              totalTokens: body.usage.total_tokens,
            };
          }
          if (applied.finishReason) {
            finishReason = applied.finishReason;
          }
          for (const out of applied.yields) {
            yield out;
          }
        }
      } catch {
        // not a JSON completion body
      }
    }

    // Last resort: non-stream chat works on geekai even when stream body is empty/malformed.
    if (sseChunks === 0 && textChunks === 0 && toolAcc.size === 0) {
      streamFallback = "chat";
      llmDebug("openai.chatStream.fallback.chat", {
        contentType: response.headers.get("content-type"),
        model: this.config.model,
        rawBodyLen: rawBody.length,
      });
      const chatResp = await this.chat(req, signal);
      if (chatResp.content) {
        textChunks += 1;
        yield { delta: chatResp.content, type: "text-delta" };
      }
      if (chatResp.reasoningContent) {
        reasoningChunks += 1;
        yield { delta: chatResp.reasoningContent, type: "reasoning-delta" };
      }
      if (chatResp.toolCalls?.length) {
        for (const tc of chatResp.toolCalls) {
          toolDeltaChunks += 1;
          yield { call: tc, type: "tool-call-complete" };
        }
      }
      finishReason = chatResp.finishReason ?? "stop";
      usage = chatResp.usage;
      sseChunks = Math.max(sseChunks, 1);
    }

    llmDebug("openai.chatStream.done", {
      elapsedMs: Date.now() - startedAt,
      finishReason,
      model: this.config.model,
      rawBodyLen: rawBody.length,
      reasoningChunks,
      sseChunks,
      streamFallback,
      textChunks,
      toolAccSize: toolAcc.size,
      toolDeltaChunks,
      url,
    });

    for (const [, slot] of [...toolAcc.entries()].toSorted((a, b) => a[0] - b[0])) {
      if (!slot.name) {
        continue;
      }
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(slot.args || "{}") as Record<string, unknown>;
      } catch {
        throw new LlmProviderError("UPSTREAM_LLM_INVALID_INPUT", "流式工具 arguments 拼接后非合法 JSON");
      }
      yield {
        call: {
          arguments: args,
          id: slot.id ?? `call-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: toolNames.decode(slot.name),
        },
        type: "tool-call-complete",
      };
    }

    yield { finishReason, type: "finish", usage };
  }

  async embed(req: LlmEmbedRequest, signal?: AbortSignal): Promise<LlmEmbedResult[]> {
    const url = `${normalizeBaseUrl(this.config.baseURL)}/embeddings`;
    const response = await this.fetchImpl(url, {
      body: JSON.stringify({
        model: this.config.model,
        input: req.input,
        encoding_format: "float",
      }),
      headers: authHeaders(this.config.apiKey),
      method: "POST",
      signal,
    });
    if (!response.ok) {
      throw mapHttpError(response.status, await response.text());
    }
    const body = (await response.json()) as {
      data?: { embedding?: number[] }[];
    };
    return (body.data ?? []).map((row) => ({ dense: row.embedding ?? [] }));
  }
}

// ── OpenAI message / tool mapping (aligned with cube-agentic-engine) ─────────

interface OpenAiChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

interface OpenAiChatCompletion {
  choices?: {
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: {
        id: string;
        type: string;
        function: { name: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface OpenAiStreamChunk {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string;
      tool_calls?: {
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    message?: {
      content?: string | null;
      reasoning_content?: string;
      tool_calls?: {
        id: string;
        type: string;
        function: { name: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

type ToolAcc = Map<number, { id?: string; name?: string; args: string }>;

interface ChoiceApplyCounters {
  textChunks: number;
  reasoningChunks: number;
  toolDeltaChunks: number;
}

interface ChoiceApplyResult extends ChoiceApplyCounters {
  yields: LlmStreamChunk[];
  finishReason?: LlmChatResponse["finishReason"];
}

function applyOpenAiStreamChoice(
  chunk: OpenAiStreamChunk,
  toolAcc: ToolAcc,
  counters: ChoiceApplyCounters,
  toolNames: OpenAiToolNameMap,
): ChoiceApplyResult {
  const yields: LlmStreamChunk[] = [];
  let finishReason: LlmChatResponse["finishReason"] | undefined;
  const choice = chunk.choices?.[0];
  const delta = choice?.delta;
  if (delta?.content) {
    counters.textChunks += 1;
    yields.push({ delta: delta.content, type: "text-delta" });
  }
  if (delta?.reasoning_content) {
    counters.reasoningChunks += 1;
    yields.push({ delta: delta.reasoning_content, type: "reasoning-delta" });
  }
  if (delta?.tool_calls) {
    for (const [i, tc] of delta.tool_calls.entries()) {
      counters.toolDeltaChunks += 1;
      const idx = tc.index ?? i;
      let slot = toolAcc.get(idx);
      if (!slot) {
        slot = { args: "" };
        toolAcc.set(idx, slot);
      }
      if (tc.id) {
        slot.id = tc.id;
      }
      if (tc.function?.name) {
        slot.name = tc.function.name;
      }
      if (tc.function?.arguments) {
        slot.args += tc.function.arguments;
      }
      yields.push({
        argumentsDelta: tc.function?.arguments,
        id: tc.id ?? slot.id,
        index: idx,
        name: tc.function?.name ? toolNames.decode(tc.function.name) : slot.name ? toolNames.decode(slot.name) : undefined,
        type: "tool-call-delta",
      });
    }
  }
  const message = choice?.message;
  if (message?.content) {
    counters.textChunks += 1;
    yields.push({ delta: message.content, type: "text-delta" });
  }
  if (message?.reasoning_content) {
    counters.reasoningChunks += 1;
    yields.push({ delta: message.reasoning_content, type: "reasoning-delta" });
  }
  if (message?.tool_calls) {
    for (const [i, tc] of message.tool_calls.entries()) {
      if (tc.type !== "function") {
        continue;
      }
      const idx = i;
      let slot = toolAcc.get(idx);
      if (!slot) {
        slot = { args: "" };
        toolAcc.set(idx, slot);
      }
      if (tc.id) {
        slot.id = tc.id;
      }
      if (tc.function?.name) {
        slot.name = tc.function.name;
      }
      if (tc.function?.arguments) {
        slot.args = tc.function.arguments;
      }
      counters.toolDeltaChunks += 1;
    }
  }
  if (choice?.finish_reason) {
    finishReason = mapFinishReason(choice.finish_reason);
  }
  return { ...counters, finishReason, yields };
}

function applyOpenAiCompletionChoice(
  choice: NonNullable<OpenAiChatCompletion["choices"]>[number],
  toolAcc: ToolAcc,
  counters: ChoiceApplyCounters,
  toolNames: OpenAiToolNameMap,
): ChoiceApplyResult {
  const message = choice.message;
  if (!message) {
    return { ...counters, finishReason: mapFinishReason(choice.finish_reason), yields: [] };
  }
  return applyOpenAiStreamChoice(
    {
      choices: [
        {
          finish_reason: choice.finish_reason,
          message: {
            content: message.content,
            reasoning_content: message.reasoning_content ?? undefined,
            tool_calls: message.tool_calls,
          },
        },
      ],
    },
    toolAcc,
    counters,
    toolNames,
  );
}

const OPENAI_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/u;

/** Maps canonical tool ids (may contain dots) to OpenAI wire names. */
class OpenAiToolNameMap {
  private readonly toWire = new Map<string, string>();
  private readonly fromWire = new Map<string, string>();

  static fromRequest(req: LlmChatRequest): OpenAiToolNameMap {
    const map = new OpenAiToolNameMap();
    for (const tool of req.tools ?? []) {
      map.encode(tool.name);
    }
    for (const message of req.messages) {
      if (message.role !== "assistant") {
        continue;
      }
      for (const call of message.toolCalls ?? []) {
        map.encode(call.name);
      }
    }
    return map;
  }

  encode(canonical: string): string {
    const cached = this.toWire.get(canonical);
    if (cached) {
      return cached;
    }
    if (OPENAI_TOOL_NAME_PATTERN.test(canonical)) {
      this.toWire.set(canonical, canonical);
      this.fromWire.set(canonical, canonical);
      return canonical;
    }
    const base = canonical.replace(/[^a-zA-Z0-9_-]/gu, "_") || "tool";
    let wire = base;
    let suffix = 0;
    while (this.fromWire.has(wire) && this.fromWire.get(wire) !== canonical) {
      suffix += 1;
      wire = `${base}_${suffix}`;
    }
    this.toWire.set(canonical, wire);
    this.fromWire.set(wire, canonical);
    return wire;
  }

  decode(wire: string): string {
    return this.fromWire.get(wire) ?? wire;
  }
}

function toolsToOpenAI(
  tools: LlmChatRequest["tools"],
  toolNames: OpenAiToolNameMap,
): { type: "function"; function: { name: string; description?: string; parameters?: Record<string, unknown> } }[] | undefined {
  if (!tools?.length) {
    return undefined;
  }
  return tools.map((t) => ({
    function: {
      description: t.description,
      name: toolNames.encode(t.name),
      parameters: t.inputSchema,
    },
    type: "function" as const,
  }));
}

function messagesToOpenAI(messages: LlmMessage[], toolNames: OpenAiToolNameMap): OpenAiChatMessage[] {
  const out: OpenAiChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "user") {
      out.push({ content: m.content, role: m.role });
    } else if (m.role === "assistant") {
      const base: OpenAiChatMessage = {
        content: m.toolCalls?.length ? m.content || null : m.content,
        role: "assistant",
      };
      if (m.toolCalls?.length) {
        base.tool_calls = m.toolCalls.map((tc) => ({
          function: {
            arguments: JSON.stringify(tc.arguments ?? {}),
            name: toolNames.encode(tc.name),
          },
          id: tc.id,
          type: "function" as const,
        }));
      }
      out.push(base);
    } else if (m.role === "tool") {
      out.push({
        content: m.content,
        role: "tool",
        tool_call_id: m.toolCallId ?? "",
      });
    }
  }
  return out;
}

type OpenAiToolCall = NonNullable<NonNullable<NonNullable<OpenAiChatCompletion["choices"]>[number]["message"]>["tool_calls"]>[number];

function parseToolCalls(raw: OpenAiToolCall[] | undefined, toolNames: OpenAiToolNameMap): LlmToolCall[] | undefined {
  if (!raw?.length) {
    return undefined;
  }
  const toolCalls: LlmToolCall[] = [];
  for (const tc of raw) {
    if (tc.type !== "function") {
      continue;
    }
    const argStr = tc.function.arguments ?? "{}";
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argStr) as Record<string, unknown>;
    } catch {
      throw new LlmProviderError("UPSTREAM_LLM_INVALID_INPUT", "工具调用 arguments 非合法 JSON");
    }
    toolCalls.push({
      arguments: args,
      id: tc.id,
      name: toolNames.decode(tc.function.name),
    });
  }
  return toolCalls.length > 0 ? toolCalls : undefined;
}

function normalizeBaseUrl(baseURL: string): string {
  return baseURL.replace(/\/+$/u, "");
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function mapFinishReason(raw: string | null | undefined): LlmChatResponse["finishReason"] {
  switch (raw) {
    case "stop": {
      return "stop";
    }
    case "length": {
      return "length";
    }
    case "tool_calls": {
      return "tool_calls";
    }
    case "content_filter": {
      return "content_filter";
    }
    default: {
      return "unknown";
    }
  }
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
