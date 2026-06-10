import type {
  LlmChatRequest,
  LlmEmbedRequest,
  LlmProviderPort,
  LlmStreamChunk,
  LlmUsage,
} from '@cube-ai/contracts';
import type {
  AdapterCallContext,
  ChatFinishReason,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  ChatUsage,
  EmbeddingRequest,
  EmbeddingResponse,
  Message,
  ModelInfo,
  ProviderAdapter,
  ToolCallRequest,
} from '@tachu/core';

function tenantFromCtx(ctx: AdapterCallContext): number {
  if (typeof ctx.tenant === 'number' && Number.isFinite(ctx.tenant)) {
    return ctx.tenant;
  }
  const raw = ctx.subject?.tenant;
  const n = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function mapFinishReason(reason: string | undefined): ChatFinishReason {
  switch (reason) {
    case 'stop':
    case 'length':
    case 'tool_calls':
    case 'content_filter':
      return reason;
    default:
      return 'stop';
  }
}

function mapUsage(usage: LlmUsage | undefined): ChatUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  };
}

function mapMessages(messages: Message[]): LlmChatRequest['messages'] {
  return messages.map((m) => ({
    role: m.role as LlmChatRequest['messages'][number]['role'],
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
    ...(m.toolCalls?.length
      ? {
          toolCalls: m.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
        }
      : {}),
  }));
}

/**
 * Minimal pino-compatible logger contract — kept local to avoid importing pino
 * types into the adapter and to keep existing `new LlmProviderPortBridge(inner)`
 * call sites (tests) working without a logger.
 */
export interface BridgeLogger {
  debug(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

function mapStreamChunk(chunk: LlmStreamChunk): ChatStreamChunk {
  switch (chunk.type) {
    case 'text-delta':
      return { type: 'text-delta', delta: chunk.delta };
    case 'reasoning-delta':
      return { type: 'reasoning-delta', delta: chunk.delta };
    case 'tool-call-delta':
      return {
        type: 'tool-call-delta',
        index: chunk.index,
        ...(chunk.id !== undefined ? { id: chunk.id } : {}),
        ...(chunk.name !== undefined ? { name: chunk.name } : {}),
        ...(chunk.argumentsDelta !== undefined ? { argumentsDelta: chunk.argumentsDelta } : {}),
      };
    case 'tool-call-complete':
      return {
        type: 'tool-call-complete',
        call: {
          id: chunk.call.id,
          name: chunk.call.name,
          arguments: chunk.call.arguments,
        },
      };
    case 'finish':
      return {
        type: 'finish',
        finishReason: mapFinishReason(chunk.finishReason),
        ...(chunk.usage !== undefined ? { usage: mapUsage(chunk.usage) } : {}),
      };
    default: {
      const _exhaustive: never = chunk;
      return _exhaustive;
    }
  }
}

/**
 * Bridges contracts {@link LlmProviderPort} (llm-core) to tachu {@link ProviderAdapter}.
 */
export class LlmProviderPortBridge implements ProviderAdapter {
  readonly id = 'cube-ai-llm-provider-port-bridge';
  readonly name = 'LlmProviderPortBridge';

  constructor(
    private readonly inner: LlmProviderPort,
    private readonly logger?: BridgeLogger,
  ) {}

  getLlmProviderPort(): LlmProviderPort {
    return this.inner;
  }

  async listAvailableModels(): Promise<ModelInfo[]> {
    if (!this.inner.listAvailableModels) {
      return [{ modelName: 'noop', capabilities: defaultCapabilities() }];
    }
    const codes = await this.inner.listAvailableModels(0);
    return codes.map((modelName) => ({ modelName, capabilities: defaultCapabilities() }));
  }

  async chat(
    request: ChatRequest,
    ctx: AdapterCallContext,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const tenant = tenantFromCtx(ctx);
    const toolCount = request.tools?.length ?? 0;
    const startedAt = Date.now();
    this.logger?.debug(
      {
        tenant,
        model: request.model,
        mode: 'chat',
        msgCount: request.messages.length,
        toolCount,
      },
      'llm.bridge.chat.start',
    );
    let response: Awaited<ReturnType<LlmProviderPort['chat']>>;
    try {
      response = await this.inner.chat(
        {
          tenant,
          modelCode: request.model,
          messages: mapMessages(request.messages),
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          tools: request.tools?.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema as Record<string, unknown> | undefined,
          })),
        },
        signal,
      );
    } catch (err: unknown) {
      this.logger?.error(
        {
          tenant,
          model: request.model,
          mode: 'chat',
          elapsedMs: Date.now() - startedAt,
          err: err instanceof Error ? err.message : String(err),
        },
        'llm.bridge.chat.failed',
      );
      throw err;
    }

    const toolCalls: ToolCallRequest[] | undefined = response.toolCalls?.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    }));

    const usage = mapUsage(response.usage) ?? {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    this.logger?.debug(
      {
        tenant,
        model: request.model,
        mode: 'chat',
        elapsedMs: Date.now() - startedAt,
        finishReason: mapFinishReason(response.finishReason),
        toolCallCount: toolCalls?.length ?? 0,
        usage,
      },
      'llm.bridge.chat.done',
    );

    return {
      content: response.content,
      ...(response.reasoningContent !== undefined
        ? { reasoningContent: response.reasoningContent }
        : {}),
      ...(toolCalls?.length ? { toolCalls } : {}),
      finishReason: mapFinishReason(response.finishReason),
      usage,
    };
  }

  async *chatStream(
    request: ChatRequest,
    ctx: AdapterCallContext,
    signal?: AbortSignal,
  ): AsyncIterable<ChatStreamChunk> {
    const tenant = tenantFromCtx(ctx);
    const toolCount = request.tools?.length ?? 0;
    const startedAt = Date.now();
    this.logger?.debug(
      {
        tenant,
        model: request.model,
        mode: 'chatStream',
        msgCount: request.messages.length,
        toolCount,
      },
      'llm.bridge.chatStream.start',
    );
    let chunkCount = 0;
    let toolCallChunks = 0;
    let finishReason: ChatFinishReason | undefined;
    let usage: ChatUsage | undefined;
    let firstChunkMs: number | undefined;
    try {
      for await (const chunk of this.inner.chatStream(
        {
          tenant,
          modelCode: request.model,
          messages: mapMessages(request.messages),
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          tools: request.tools?.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema as Record<string, unknown> | undefined,
          })),
        },
        signal,
      )) {
        chunkCount += 1;
        if (firstChunkMs === undefined) firstChunkMs = Date.now() - startedAt;
        if (chunk.type === 'tool-call-delta' || chunk.type === 'tool-call-complete') {
          toolCallChunks += 1;
        }
        if (chunk.type === 'finish') {
          finishReason = mapFinishReason(chunk.finishReason);
          usage = mapUsage(chunk.usage);
        }
        yield mapStreamChunk(chunk);
      }
    } catch (err: unknown) {
      this.logger?.error(
        {
          tenant,
          model: request.model,
          mode: 'chatStream',
          elapsedMs: Date.now() - startedAt,
          chunkCount,
          err: err instanceof Error ? err.message : String(err),
        },
        'llm.bridge.chatStream.failed',
      );
      throw err;
    }
    this.logger?.debug(
      {
        tenant,
        model: request.model,
        mode: 'chatStream',
        elapsedMs: Date.now() - startedAt,
        firstChunkMs: firstChunkMs ?? null,
        chunkCount,
        toolCallChunks,
        finishReason: finishReason ?? null,
        usage: usage ?? null,
      },
      'llm.bridge.chatStream.done',
    );
  }

  async embed(
    request: EmbeddingRequest,
    ctx: AdapterCallContext,
    signal?: AbortSignal,
  ): Promise<EmbeddingResponse> {
    const tenant = tenantFromCtx(ctx);
    const embedReq: LlmEmbedRequest = {
      tenant,
      modelCode: request.model,
      input: request.inputs.map((item) =>
        typeof item === 'string' ? item : JSON.stringify(item),
      ),
    };
    const rows = await this.inner.embed(embedReq, signal);
    return {
      embeddings: rows.map((row) => row.dense),
    };
  }

  async countTokens(messages: Message[], _model: string): Promise<number> {
    return messages.reduce((acc, m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return acc + Math.ceil(content.length / 4);
    }, 0);
  }
}

function defaultCapabilities(): ModelInfo['capabilities'] {
  return {
    supportedModalities: ['text'],
    maxContextTokens: 32_000,
    supportsStreaming: true,
    supportsFunctionCalling: true,
  };
}
