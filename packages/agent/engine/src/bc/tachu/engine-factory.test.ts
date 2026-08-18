import type {
  AdapterCallContext,
  ChatRequest,
  ChatResponse,
  EngineConfig,
  ObservabilityEmitter,
  ProviderAdapter,
  StreamChunk,
} from "@tachu/core";
import { describe, expect, mock, test } from "bun:test";

import { InMemoryStore } from "@cube-ai/agent-engine/adapters/memory";
import { ToolDescriptor } from "@cube-ai/contracts";
import type { LlmProviderPort } from "@cube-ai/contracts";
import type { TenantDescriptorView } from "@cube-ai/contracts";

import type { DescriptorRegistryService } from "../descriptor/descriptor-registry.service";
import { SkillRegistryService } from "../descriptor/skill-registry.service";
import { TenantDescriptorResolver } from "../descriptor/tenant-descriptor-resolver";
import type { ToolService } from "../tools/tool.service";
import { EngineFactory } from "./engine-factory";
import { createTurnContextHolder } from "./turn-context-holder";

function testEngineFactory(
  provider: ProviderAdapter,
  observability?: ObservabilityEmitter,
  descriptorRegistry?: DescriptorRegistryService,
  toolService?: ToolService,
  skillRegistry?: SkillRegistryService,
  localFiles?: ConstructorParameters<typeof EngineFactory>[7],
  llmProvider?: LlmProviderPort,
  tenantResolver?: TenantDescriptorResolver,
  userShelf?: ConstructorParameters<typeof EngineFactory>[12],
): EngineFactory {
  const resolvedLlm = llmProvider ?? (provider as CaptureProvider).llmProvider;
  return new EngineFactory(
    provider,
    observability,
    new InMemoryStore(),
    createTurnContextHolder(),
    descriptorRegistry,
    toolService,
    skillRegistry,
    localFiles,
    undefined,
    resolvedLlm,
    undefined,
    tenantResolver,
    userShelf,
  );
}

/**
 * EngineFactory 单元测试 —— 验证它作为 tachu.Engine 的 session-aware 适配器，
 * 把 cube-agentic-engine 这边的 session 数据（snapshot、modelCode、principal）
 * 正确转译成 tachu 的 InputEnvelope/ExecutionContext/SessionScope。
 *
 * 这一系列测试只关注 EngineFactory 的"装配契约"，不依赖真实 LLM、不依赖
 * SSE 链路、不依赖 DI。
 */

interface CaptureProvider extends ProviderAdapter {
  capturedMessages: ReadonlyArray<ChatRequest["messages"]>;
  capturedModels: readonly string[];
  capturedEmbedModels: readonly string[];
  llmProvider: LlmProviderPort;
}

function createCaptureProvider(): CaptureProvider {
  const capturedMessages: ChatRequest["messages"][] = [];
  const capturedModels: string[] = [];
  const capturedEmbedModels: string[] = [];
  const llmProvider: LlmProviderPort = {
    async chat() {
      return {
        content: "ok",
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 3 },
      };
    },
    async *chatStream() {
      yield { type: "text-delta" as const, delta: "ok" };
      yield {
        type: "finish" as const,
        finishReason: "stop" as const,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 3 },
      };
    },
    async embed(request) {
      capturedEmbedModels.push(request.modelCode);
      return request.input.map((_input, index) => ({
        dense: index === 0 ? [1, 0, 0] : [0.95, 0.05, 0],
      }));
    },
  };
  const provider: ProviderAdapter = {
    id: "agentic-platform-llm-catalog",
    name: "CaptureProvider",
    async listAvailableModels() {
      return [];
    },
    async chat(request: ChatRequest, _ctx: AdapterCallContext): Promise<ChatResponse> {
      capturedMessages.push([...request.messages]);
      capturedModels.push(request.model);
      return {
        content: "ok",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    },
    async *chatStream(request: ChatRequest, _ctx: AdapterCallContext) {
      capturedMessages.push([...request.messages]);
      capturedModels.push(request.model);
      yield { type: "text-delta", delta: "ok" } as const;
      yield {
        type: "finish",
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      } as const;
    },
    async embed(request, _ctx) {
      capturedEmbedModels.push(request.model);
      return {
        embeddings: request.inputs.map((_input, index) => {
          const base = index === 0 ? [1, 0, 0] : [0.95, 0.05, 0];
          return base;
        }),
      };
    },
  };
  return Object.assign(provider, {
    llmProvider,
    get capturedMessages(): ReadonlyArray<ChatRequest["messages"]> {
      return capturedMessages;
    },
    get capturedModels(): readonly string[] {
      return capturedModels;
    },
    get capturedEmbedModels(): readonly string[] {
      return capturedEmbedModels;
    },
  }) as CaptureProvider;
}

async function drain(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of stream) {
    out.push(chunk);
    if (chunk.type === "error") throw chunk.error;
  }
  return out;
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("EngineFactory", () => {
  test("uses 600s as the default task timeout for long tool-use turns", () => {
    const provider = createCaptureProvider();
    const factory = testEngineFactory(provider, undefined, undefined, undefined, undefined, undefined, provider.llmProvider);
    const config = (factory as unknown as { buildEngineConfig(): EngineConfig }).buildEngineConfig();

    expect(config.runtime.defaultTaskTimeoutMs).toBe(600_000);
  });

  test("resolveEffectiveRoute reroutes image-bearing turns to an image-capable model", async () => {
    const provider = createCaptureProvider();
    provider.listAvailableModels = async () => [
      {
        modelName: "gpt-4o-mini",
        capabilities: {
          supportedModalities: ["text"],
          maxContextTokens: 32_000,
          supportsStreaming: true,
          supportsFunctionCalling: true,
        },
      },
      {
        modelName: "gpt-4.1-vision",
        capabilities: {
          supportedModalities: ["text", "image"],
          maxContextTokens: 32_000,
          supportsStreaming: true,
          supportsFunctionCalling: true,
        },
      },
    ];
    const factory = testEngineFactory(provider);
    const route = await factory.resolveEffectiveRoute({
      prompt: "compare",
      turnModelCode: "gpt-4o-mini",
      content: {
        schema: "message-content-v1",
        blocks: [{ type: "image_ref", attachmentId: "att_01" }],
      },
    });
    expect(route.effectiveModelCode).toBe("gpt-4.1-vision");
    expect(route.reason).toBe("IMAGE_CAPABILITY_REROUTE");
  });

  /** Provider-bound base64 expansion via LocalFileMultimodalResolver. */
  test("runStream builds multimodal input parts from local file assets", async () => {
    const provider = createCaptureProvider();
    provider.listAvailableModels = async () => [
      {
        modelName: "gpt-4.1-vision",
        capabilities: {
          supportedModalities: ["text", "image"],
          maxContextTokens: 32_000,
          supportsStreaming: true,
          supportsFunctionCalling: true,
        },
      },
    ];
    const localFiles = {
      readImageAsset: async () => ({
        fileId: "file_01",
        mimeType: "image/png",
        sizeBytes: 3,
        sha256: "a".repeat(64),
        bytes: new Uint8Array([1, 2, 3]),
      }),
    };
    const factory = testEngineFactory(provider, undefined, undefined, undefined, undefined, localFiles as never, provider.llmProvider);
    await drain(
      factory.runStream({
        sessionId: "2054102360564695080",
        turnId: "2054102360564695081",
        tenant: 42,
        userId: "u-42",
        prompt: "compare",
        turnModelCode: "gpt-4.1-vision",
        content: {
          schema: "message-content-v1",
          blocks: [
            { type: "text", text: "compare" },
            { type: "image_ref", attachmentId: "att_01" },
          ],
        },
        attachments: [{ attachmentId: "att_01", kind: "image", fileId: "file_01", mimeType: "image/png" }],
      }),
    );
    const firstUserMessage = provider.capturedMessages.at(-1)?.find((message) => message.role === "user");
    const content = firstUserMessage?.content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    // Body keeps the original prompt + an opaque resource token, with the
    // materialized carrier appended under a `--- References ---` block.
    const bodyText = parts.find((p) => p.type === "text" && p.text?.includes("compare"))?.text ?? "";
    expect(bodyText).toContain("compare");
    expect(bodyText).toMatch(/\[\[ref:image:[0-9a-f-]+\]\]/u);
    expect(bodyText).toContain("--- References ---");
    const imagePart = parts.find((p) => p.type === "image_url");
    expect(imagePart?.image_url?.url).toBe("data:image/png;base64,AQID");
  });

  test("enables tachu skill activator runtime defaults", () => {
    const provider = createCaptureProvider();
    const factory = testEngineFactory(provider, undefined, undefined, undefined, undefined, undefined, provider.llmProvider);
    const config = (factory as unknown as { buildEngineConfig(): EngineConfig }).buildEngineConfig();

    expect(config.registry.enableVectorIndexing).toBe(false);
    expect(config.runtime.skillBudget).toBe(0.8);
    expect(config.runtime.skillActivationMode).toBe("activator");
    expect(config.runtime.candidateTopK).toBe(20);
    expect(config.runtime.stickyTtlTurns).toBe(8);
    expect(config.runtime.stickyMaxSlots).toBe(3);
    expect(config.runtime.enableSearchSkillsTool).toBe(true);
  });

  test("runStream forwards agentSnapshot.agent.content.prompt as SessionScope.systemInstruction so the deep loop sees it in the system message", async () => {
    const provider = createCaptureProvider();
    const factory = testEngineFactory(provider);

    const SNAPSHOT_PROMPT_MARKER = "SNAPSHOT-SYS-C1-XYZ";
    const chunks = await drain(
      factory.runStream({
        sessionId: "2054102360564695040",
        turnId: "2054102360564695041",
        tenant: 58197260,
        prompt: "hello",
        agentSnapshot: {
          agent: {
            content: {
              prompt: SNAPSHOT_PROMPT_MARKER,
            },
          },
        },
      }),
    );

    // 至少要拿到 done chunk（说明深单 loop 跑完了）。
    expect(chunks.some((c) => c.type === "done")).toBe(true);

    // 应当至少有一次 provider 调用的 system 段包含 snapshot 的 prompt（loop 走 PromptAssembler）。
    const hasSnapshotInSystem = provider.capturedMessages.some((msgs) =>
      msgs.some((m) => m.role === "system" && typeof m.content === "string" && m.content.includes(SNAPSHOT_PROMPT_MARKER)),
    );
    // EngineFactory 不再每轮注入 UTC 时钟块；该责任已下沉到 SessionService.buildSnapshots
    // （session 创建时一次性冻结进 snapshot.prompt）。本测试用的 snapshot 不带 UTC 块，
    // 因此 provider 看到的 system 段也不应出现 "Session-start time (UTC)"。
    const hasUtcBlock = provider.capturedMessages.some((msgs) =>
      msgs.some((m) => m.role === "system" && typeof m.content === "string" && m.content.includes("Session-start time (UTC)")),
    );
    expect(hasSnapshotInSystem).toBe(true);
    expect(hasUtcBlock).toBe(false);

    // 深单 loop 预组装路径：Assembler 大段（含 snapshot systemInstruction）与 loop 自身
    // 的 tool-use system prompt（含打捞进来的 no-empty-promise 护栏）都送达 provider。
    const hasCombinedLoopPrompt = provider.capturedMessages.some((msgs) => {
      const systemContents = msgs.filter((m) => m.role === "system" && typeof m.content === "string").map((m) => m.content as string);
      return (
        systemContents.some((c) => c.includes(SNAPSHOT_PROMPT_MARKER)) &&
        systemContents.some((c) => c.includes("agentic tool-loop sub-flow"))
      );
    });
    expect(hasCombinedLoopPrompt).toBe(true);
  });

  test("runStream injects current turn knowledge refs into the system prompt", async () => {
    const provider = createCaptureProvider();
    const factory = testEngineFactory(provider);

    await drain(
      factory.runStream({
        sessionId: "2054102360564695040",
        turnId: "2054102360564695043",
        tenant: 58197260,
        prompt: "查一下发布规范",
        runtimeRefs: {
          knowledgeBases: [{ kbId: "kb-1", displayName: "产品知识库" }],
        },
        agentSnapshot: {
          agent: { content: { prompt: "BASE-PROMPT" } },
        },
      }),
    );

    const hasKnowledgeRefs = provider.capturedMessages.some((msgs) =>
      msgs.some(
        (m) =>
          m.role === "system" &&
          typeof m.content === "string" &&
          m.content.includes("## Runtime Knowledge References") &&
          m.content.includes("产品知识库") &&
          m.content.includes("kb-1") &&
          m.content.includes("platform.knowledge.query"),
      ),
    );
    expect(hasKnowledgeRefs).toBe(true);
  });

  test("runStream queries selected runtime knowledge before answering and injects hits into model context", async () => {
    const provider = createCaptureProvider();
    const invocations: Array<{
      toolName: string;
      input: unknown;
      tenant: number;
      sessionId: string;
      turnId: string;
      runtimeRefs?: unknown;
      toolCallId?: string;
    }> = [];
    const toolService = {
      invoke: async (toolName, input, ctx, options) => {
        invocations.push({
          toolName,
          input,
          tenant: ctx.auth.tenant,
          sessionId: ctx.session.id,
          turnId: ctx.session.turnId,
          runtimeRefs: ctx.turn?.runtimeRefs,
          toolCallId: options?.toolCallId,
        });
        return {
          hits: [
            {
              docId: "doc-1",
              kbId: "kb-1",
              title: "视角切换手册",
              snippet: "切换视角请点击右上角视角按钮。",
              score: 0.91,
            },
          ],
          truncated: false,
        };
      },
    } satisfies Pick<ToolService, "invoke">;
    const observabilityEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const observability: ObservabilityEmitter = {
      emit(ev) {
        observabilityEvents.push({ type: ev.type, payload: ev.payload ?? {} });
      },
      on: () => () => {},
      off: () => {},
      setMasker: () => {},
    };
    const factory = testEngineFactory(provider, observability, undefined, toolService as ToolService);

    const chunks = await drain(
      factory.runStream({
        sessionId: "SESSION-RUNTIME-KB-1",
        turnId: "TURN-RUNTIME-KB-1",
        tenant: 58197260,
        prompt: "如何切换视角？",
        runtimeRefs: {
          knowledgeBases: [{ kbId: "kb-1", displayName: "孪生平台知识库" }],
        },
        agentSnapshot: {
          agent: { content: { prompt: "BASE-PROMPT" } },
        },
        nextStreamId: (() => {
          let n = 0;
          return () => `stream-${++n}`;
        })(),
      }),
    );

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      toolName: "platform.knowledge.query",
      input: { query: "如何切换视角？", topK: 5 },
      tenant: 58197260,
      sessionId: "SESSION-RUNTIME-KB-1",
      turnId: "TURN-RUNTIME-KB-1",
      runtimeRefs: {
        knowledgeBases: [{ kbId: "kb-1", displayName: "孪生平台知识库" }],
      },
      toolCallId: "stream-1",
    });
    expect(
      chunks.some((c) => c.type === "tool-call-start" && c.tool === "platform.knowledge.query" && c.argumentsPreview.includes("kb-1")),
    ).toBe(true);
    expect(
      chunks.some(
        (c) =>
          c.type === "tool-call-end" &&
          c.tool === "platform.knowledge.query" &&
          c.success === true &&
          JSON.stringify(c.output).includes("切换视角请点击右上角视角按钮"),
      ),
    ).toBe(true);
    expect(
      provider.capturedMessages.some((msgs) =>
        msgs.some(
          (m) =>
            m.role === "system" &&
            typeof m.content === "string" &&
            m.content.includes("## Retrieved Knowledge Context") &&
            m.content.includes("切换视角请点击右上角视角按钮"),
        ),
      ),
    ).toBe(true);
    expect(
      observabilityEvents.some(
        (ev) =>
          ev.type === "knowledge_prefetch_end" &&
          ev.payload.hitCount === 1 &&
          ev.payload.truncated === false &&
          ev.payload.kbIds?.[0] === "kb-1" &&
          typeof ev.payload.injectedContextChars === "number" &&
          (ev.payload.injectedContextChars as number) > 0 &&
          Array.isArray(ev.payload.topHits) &&
          (ev.payload.topHits as Array<{ docId?: string }>)[0]?.docId === "doc-1",
      ),
    ).toBe(true);
  });

  test("runStream emits knowledge_prefetch_skipped when no knowledge bases are attached", async () => {
    const provider = createCaptureProvider();
    const observabilityEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const observability: ObservabilityEmitter = {
      emit(ev) {
        observabilityEvents.push({ type: ev.type, payload: ev.payload ?? {} });
      },
      on: () => () => {},
      off: () => {},
      setMasker: () => {},
    };
    const factory = testEngineFactory(provider, observability);

    await drain(
      factory.runStream({
        sessionId: "SESSION-RUNTIME-KB-SKIP",
        turnId: "TURN-RUNTIME-KB-SKIP",
        tenant: 1,
        prompt: "hello world",
        agentSnapshot: { agent: { content: { prompt: "BASE-PROMPT" } } },
      }),
    );

    expect(observabilityEvents.some((ev) => ev.type === "knowledge_prefetch_skipped" && ev.payload.reason === "no_refs")).toBe(true);
  });

  test("runStream emits knowledge_prefetch_failed when knowledge query throws", async () => {
    const provider = createCaptureProvider();
    const observabilityEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const observability: ObservabilityEmitter = {
      emit(ev) {
        observabilityEvents.push({ type: ev.type, payload: ev.payload ?? {} });
      },
      on: () => () => {},
      off: () => {},
      setMasker: () => {},
    };
    const toolService = {
      invoke: async () => {
        throw Object.assign(new Error("kb query failed"), { code: "UPSTREAM_TOOL_HTTP_FAILED" });
      },
    } satisfies Pick<ToolService, "invoke">;
    const factory = testEngineFactory(provider, observability, undefined, toolService as ToolService);

    await drain(
      factory.runStream({
        sessionId: "SESSION-RUNTIME-KB-FAIL",
        turnId: "TURN-RUNTIME-KB-FAIL",
        tenant: 1,
        prompt: "如何处理应急事故？",
        runtimeRefs: {
          knowledgeBases: [{ kbId: "kb-1", displayName: "应急知识库" }],
        },
        agentSnapshot: { agent: { content: { prompt: "BASE-PROMPT" } } },
      }),
    );

    expect(
      observabilityEvents.some(
        (ev) =>
          ev.type === "knowledge_prefetch_failed" && ev.payload.errorMessage === "kb query failed" && ev.payload.kbIds?.[0] === "kb-1",
      ),
    ).toBe(true);
  });

  test("runStream pre-invokes agent-declared groundingPrefetch tool and injects its output into model context", async () => {
    const provider = createCaptureProvider();
    // 接地预取工具必须先镜像进 tachuRegistry 才会被主机代跑。引擎对工具名不可知，
    // 这里复用一个普通已注册工具即可验证机制（领域名只住 descriptor 声明）。
    const groundingDesc = ToolDescriptor.parse({
      schemaVersion: 1,
      kind: "TOOL",
      name: "platform.flow.list",
      displayName: "List flows",
      isPreset: true,
      version: "1.0.0",
      meta: {
        execution: "LOCAL",
        consent: "NEVER",
        requiresPrincipal: "USER",
        timeoutMs: 15_000,
        idempotent: true,
        sideEffects: [],
      },
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      requires: { principal: "USER", oauthScope: [], obo: null },
      execute: "builtin:platform.flow.list",
    });
    const mockRegistry = {
      listAll: () => [groundingDesc],
      resolve: (name: string) => (name === "platform.flow.list" ? groundingDesc : undefined),
    } as unknown as DescriptorRegistryService;

    const invocations: Array<{ toolName: string; input: unknown; toolCallId?: string }> = [];
    const toolService = {
      invoke: async (toolName, input, _ctx, options) => {
        invocations.push({ toolName, input, toolCallId: options?.toolCallId });
        return { entities: ["alarm", "device"], marker: "GROUNDING-INDEX-MARKER" };
      },
    } satisfies Pick<ToolService, "invoke">;
    const observabilityEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const observability: ObservabilityEmitter = {
      emit(ev) {
        observabilityEvents.push({ type: ev.type, payload: ev.payload ?? {} });
      },
      on: () => () => {},
      off: () => {},
      setMasker: () => {},
    };
    const factory = testEngineFactory(provider, observability, mockRegistry, toolService as ToolService);

    const chunks = await drain(
      factory.runStream({
        sessionId: "SESSION-GROUNDING-1",
        turnId: "TURN-GROUNDING-1",
        tenant: 58197260,
        prompt: "统计各设备的告警数量",
        agentSnapshot: {
          agent: {
            content: {
              prompt: "BASE-PROMPT",
              groundingPrefetch: [{ tool: "platform.flow.list", args: { connection: "", entity: "_index" } }],
            },
          },
        },
        nextStreamId: (() => {
          let n = 0;
          return () => `stream-${++n}`;
        })(),
      }),
    );

    // 主机在 tool-loop 开始前代为预跑，且带上声明的静态参数。
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      toolName: "platform.flow.list",
      input: { connection: "", entity: "_index" },
    });
    // 预取以真实 tool-call 事件对形式流出（可观测、可回放）。
    expect(
      chunks.some(
        (c) =>
          c.type === "tool-call-end" &&
          c.tool === "platform.flow.list" &&
          c.success === true &&
          JSON.stringify(c.output).includes("GROUNDING-INDEX-MARKER"),
      ),
    ).toBe(true);
    // 预取结果被格式化注入 system prompt，供本轮 LLM 选用真实标识符。
    expect(
      provider.capturedMessages.some((msgs) =>
        msgs.some(
          (m) =>
            m.role === "system" &&
            typeof m.content === "string" &&
            m.content.includes("预取接地事实") &&
            m.content.includes("GROUNDING-INDEX-MARKER"),
        ),
      ),
    ).toBe(true);
    expect(
      observabilityEvents.some(
        (ev) =>
          ev.type === "grounding_prefetch_end" &&
          ev.payload.tool === "platform.flow.list" &&
          typeof ev.payload.injectedContextChars === "number" &&
          (ev.payload.injectedContextChars as number) > 0,
      ),
    ).toBe(true);
  });

  test("runStream skips a groundingPrefetch entry whose tool is not registered this turn (no invoke)", async () => {
    const provider = createCaptureProvider();
    const invocations: string[] = [];
    const toolService = {
      invoke: async (toolName) => {
        invocations.push(toolName);
        return {};
      },
    } satisfies Pick<ToolService, "invoke">;
    const observabilityEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const observability: ObservabilityEmitter = {
      emit(ev) {
        observabilityEvents.push({ type: ev.type, payload: ev.payload ?? {} });
      },
      on: () => () => {},
      off: () => {},
      setMasker: () => {},
    };
    // 不传 descriptorRegistry → 无工具被镜像进 tachuRegistry → 声明的接地工具本轮不可达。
    const factory = testEngineFactory(provider, observability, undefined, toolService as ToolService);

    await drain(
      factory.runStream({
        sessionId: "SESSION-GROUNDING-SKIP",
        turnId: "TURN-GROUNDING-SKIP",
        tenant: 1,
        prompt: "统计各设备的告警数量",
        agentSnapshot: {
          agent: {
            content: {
              prompt: "BASE-PROMPT",
              groundingPrefetch: [{ tool: "mcp.biz-ontology.read_ontology", args: { entity: "_index" } }],
            },
          },
        },
      }),
    );

    expect(invocations).toHaveLength(0);
    expect(
      observabilityEvents.some(
        (ev) =>
          ev.type === "grounding_prefetch_skipped" &&
          ev.payload.reason === "tool_not_registered" &&
          ev.payload.tool === "mcp.biz-ontology.read_ontology",
      ),
    ).toBe(true);
  });

  test("runStream pins current turn runtime user skill refs", async () => {
    const provider = createCaptureProvider();
    const skillRegistry = new SkillRegistryService();
    const SKILL_MARKER = "RUNTIME-SKILL-CHART-MARKER";
    skillRegistry.register({
      kind: "skill",
      name: "chart-output",
      version: "1.0.2",
      description: "charts",
      instructions: `Runtime selected skill:\n${SKILL_MARKER}`,
      activation: { mode: "semantic" },
    });
    const factory = testEngineFactory(provider, undefined, undefined, undefined, skillRegistry);

    const chunks = await drain(
      factory.runStream({
        sessionId: "SESSION-RUNTIME-SKILL-1",
        turnId: "TURN-RUNTIME-SKILL-1",
        tenant: 1,
        prompt: "生成一个图表",
        runtimeRefs: {
          userSkills: [{ skillId: "chart-output", displayName: "图表生成" }],
        },
        nextStreamId: (() => {
          let n = 0;
          return () => `skill-ref-${++n}`;
        })(),
      }),
    );

    const hasRuntimeSkillInSystem = provider.capturedMessages.some((msgs) =>
      msgs.some(
        (m) =>
          m.role === "system" &&
          typeof m.content === "string" &&
          m.content.includes(SKILL_MARKER) &&
          m.content.includes("## Runtime Skill References"),
      ),
    );
    expect(hasRuntimeSkillInSystem).toBe(true);
    expect(
      chunks.some(
        (c) =>
          c.type === "tool-call-end" &&
          c.tool === "runtime.skill.refs" &&
          c.success === true &&
          JSON.stringify(c.output).includes("chart-output"),
      ),
    ).toBe(true);
  });

  test("runStream resolves tenant skl_ runtime skill refs via TenantDescriptorResolver", async () => {
    const provider = createCaptureProvider();
    const TENANT_SKILL_MARKER = "TENANT-ONLY-REPLY-I-DONT-KNOW";
    const tenantSkillId = "skl_runtime_test";
    const repo = {
      resolvePublished: mock(async (_tenant: number, id: string): Promise<TenantDescriptorView | null> => {
        if (id !== tenantSkillId) return null;
        return {
          id: tenantSkillId,
          kind: "skill",
          name: "only-dont-know",
          status: "published",
          headVersionNo: 1,
          publishedVersionNo: 1,
          hasUnpublishedChanges: false,
          ownerUserId: "u-1",
          createTime: 1,
          updateTime: 1,
          content: {
            description: "Only reply I do not know",
            instructions: `You must only reply:\n${TENANT_SKILL_MARKER}`,
          },
        };
      }),
    };
    const tenantResolver = new TenantDescriptorResolver(repo as never);
    const factory = testEngineFactory(provider, undefined, undefined, undefined, undefined, undefined, undefined, tenantResolver);

    await drain(
      factory.runStream({
        sessionId: "SESSION-RUNTIME-TENANT-SKILL-1",
        turnId: "TURN-RUNTIME-TENANT-SKILL-1",
        tenant: 42,
        prompt: "随便问点什么",
        runtimeRefs: {
          userSkills: [{ skillId: tenantSkillId, displayName: "我不知道技能" }],
        },
      }),
    );

    expect(repo.resolvePublished).toHaveBeenCalledWith(42, tenantSkillId);

    const systems = provider.capturedMessages.flatMap((msgs) =>
      msgs.filter((m) => m.role === "system" && typeof m.content === "string").map((m) => m.content as string),
    );
    const hasTenantSkillInSystem = systems.some((content) => content.includes(TENANT_SKILL_MARKER));
    expect(hasTenantSkillInSystem).toBe(true);
  });

  test("runStream resolves an OWNER's own UNPUBLISHED (draft) @-pinned skill via actorUserId", async () => {
    const provider = createCaptureProvider();
    const MARKER = "OWNER-DRAFT-GREETING-主公-MARKER";
    const draftSkillId = "skl_owner_draft";
    const OWNER = "u-owner";
    const repo = {
      // 草稿从未发布：published 读路径拿不到
      resolvePublished: mock(async (): Promise<TenantDescriptorView | null> => null),
      // owner 读路径：findById 返回 draft/head（含 ownerUserId）
      findById: mock(async (_tenant: number, id: string): Promise<TenantDescriptorView | null> => {
        if (id !== draftSkillId) return null;
        return {
          id: draftSkillId,
          kind: "skill",
          name: "greeting-prefix",
          status: "draft",
          headVersionNo: 1,
          publishedVersionNo: null,
          hasUnpublishedChanges: true,
          ownerUserId: OWNER,
          createTime: 1,
          updateTime: 1,
          content: { description: "greet as 主公", instructions: `You must greet with:\n${MARKER}` },
        };
      }),
    };
    const tenantResolver = new TenantDescriptorResolver(repo as never);
    const factory = testEngineFactory(provider, undefined, undefined, undefined, undefined, undefined, undefined, tenantResolver);

    await drain(
      factory.runStream({
        sessionId: "SESSION-OWNER-DRAFT-SKILL-1",
        turnId: "TURN-OWNER-DRAFT-SKILL-1",
        tenant: 42,
        userId: OWNER,
        prompt: "你好",
        runtimeRefs: {
          userSkills: [{ skillId: draftSkillId, displayName: "主公问候前缀" }],
        },
      }),
    );

    const systems = provider.capturedMessages.flatMap((msgs) =>
      msgs.filter((m) => m.role === "system" && typeof m.content === "string").map((m) => m.content as string),
    );
    expect(systems.some((content) => content.includes(MARKER))).toBe(true);
  });

  test("runStream exposes the user's shelf skills under '## Available Skills' via skillDiscovery (progressive disclosure)", async () => {
    const provider = createCaptureProvider();
    const shelfSkillId = "skl_my_greeting";
    const OWNER = "u-owner";
    const SKILL_NAME = "主公问候前缀";
    const repo = {
      resolvePublished: mock(async (): Promise<TenantDescriptorView | null> => null),
      findById: mock(async (_tenant: number, id: string): Promise<TenantDescriptorView | null> => {
        if (id !== shelfSkillId) return null;
        return {
          id: shelfSkillId,
          kind: "skill",
          name: SKILL_NAME,
          status: "draft",
          headVersionNo: 1,
          publishedVersionNo: null,
          hasUnpublishedChanges: true,
          ownerUserId: OWNER,
          createTime: 1,
          updateTime: 1,
          content: { description: "以主公前缀问候", instructions: "greet as 主公" },
        };
      }),
    };
    const tenantResolver = new TenantDescriptorResolver(repo as never);
    const userShelf = {
      listByUser: async () => [
        {
          id: "she_1",
          targetKind: "skill" as const,
          targetId: shelfSkillId,
          source: "authored" as const,
          pinVersionNo: null,
          enabled: true,
          effectiveVersionNo: null,
          runnableStatus: "runnable" as const,
        },
      ],
    };
    const factory = testEngineFactory(
      provider,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      tenantResolver,
      userShelf,
    );

    await drain(
      factory.runStream({
        sessionId: "SESSION-SHELF-DISCOVERY-1",
        turnId: "TURN-SHELF-DISCOVERY-1",
        tenant: 42,
        userId: OWNER,
        prompt: "还有其它的技能吗？",
      }),
    );

    const systems = provider.capturedMessages.flatMap((msgs) =>
      msgs.filter((m) => m.role === "system" && typeof m.content === "string").map((m) => m.content as string),
    );
    expect(systems.some((content) => content.includes("## Available Skills") && content.includes(SKILL_NAME))).toBe(true);
  });

  test("runStream emits skill_pin_unresolved when an @-pinned skill cannot be resolved (owner-less draft / missing)", async () => {
    const provider = createCaptureProvider();
    const observabilityEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const observability: ObservabilityEmitter = {
      emit(ev) {
        observabilityEvents.push({ type: ev.type, payload: (ev.payload ?? {}) as Record<string, unknown> });
      },
      on: () => () => {},
      off: () => {},
      setMasker: () => {},
    };
    // resolver 什么都解析不到（草稿未发布且请求者非 owner，或 id 不存在）
    const repo = {
      resolvePublished: mock(async (): Promise<TenantDescriptorView | null> => null),
      findById: mock(async (): Promise<TenantDescriptorView | null> => null),
    };
    const tenantResolver = new TenantDescriptorResolver(repo as never);
    const factory = testEngineFactory(provider, observability, undefined, undefined, undefined, undefined, undefined, tenantResolver);

    await drain(
      factory.runStream({
        sessionId: "SESSION-PIN-UNRESOLVED-1",
        turnId: "TURN-PIN-UNRESOLVED-1",
        tenant: 42,
        userId: "u-x",
        prompt: "你好",
        runtimeRefs: {
          userSkills: [{ skillId: "skl_missing", displayName: "主公问候前缀" }],
        },
      }),
    );

    expect(observabilityEvents.some((ev) => ev.type === "skill_pin_unresolved" && ev.payload["skillId"] === "skl_missing")).toBe(true);
  });

  test("runStream injects inline snapshot skills into system prompt via additionalSkills", async () => {
    const provider = createCaptureProvider();
    const skillRegistry = new SkillRegistryService();
    const SKILL_MARKER = "ECHARTS-FENCE-CONTRACT-XYZ";
    skillRegistry.register({
      kind: "skill",
      name: "chart-output",
      version: "1.0.2",
      description: "charts",
      instructions: `Output charts using:\n${SKILL_MARKER}`,
      activation: { mode: "semantic" },
    });
    const factory = testEngineFactory(provider, undefined, undefined, undefined, skillRegistry);

    await drain(
      factory.runStream({
        sessionId: "SESSION-SKILL-SNAPSHOT-1",
        turnId: "2054102360564695100",
        tenant: 1,
        prompt: "随机生成几个图表",
        agentSnapshot: {
          agent: { content: { prompt: "BASE-PROMPT" } },
          skills: [
            {
              name: "chart-output",
              versionNo: 1,
              content: skillRegistry.resolve("chart-output")!,
            },
          ],
        },
      }),
    );

    const hasSkillInSystem = provider.capturedMessages.some((msgs) =>
      msgs.some(
        (m) =>
          m.role === "system" &&
          typeof m.content === "string" &&
          m.content.includes(SKILL_MARKER) &&
          m.content.includes("## Skill Discovery"),
      ),
    );
    expect(hasSkillInSystem).toBe(true);
  });

  test("runStream does not synthesize any session-start UTC block on its own — that responsibility lives in SessionService.buildSnapshots", async () => {
    const provider = createCaptureProvider();
    const factory = testEngineFactory(provider);
    await drain(
      factory.runStream({
        sessionId: "2054102360564695060",
        turnId: "2054102360564695061",
        tenant: 58197260,
        prompt: "hello",
        agentSnapshot: {
          agent: {
            content: {
              prompt: "  \n\t  ",
            },
          },
        },
      }),
    );
    const hasClock = provider.capturedMessages.some((msgs) =>
      msgs.some(
        (m) =>
          m.role === "system" &&
          typeof m.content === "string" &&
          (m.content.includes("Session-start time (UTC)") || m.content.includes("Engine-managed time (UTC)")),
      ),
    );
    expect(hasClock).toBe(false);
  });

  test("turn body modelCode wins over snapshot.modelConfig and is sent to provider as ChatRequest.model on every capability call", async () => {
    const provider = createCaptureProvider();
    const factory = testEngineFactory(provider);

    await drain(
      factory.runStream({
        sessionId: "2054102360564695040",
        turnId: "2054102360564695042",
        tenant: 58197260,
        prompt: "hi",
        // turn body 显式指定，必须覆盖 snapshot.modelConfig
        turnModelCode: "deepseek-v3-2-251201",
        agentSnapshot: {
          agent: {
            content: {
              prompt: "sys",
              modelConfig: { model: "snapshot-should-be-overridden" },
            },
          },
        },
      }),
    );

    expect(provider.capturedModels.length).toBeGreaterThan(0);
    expect(provider.capturedModels.every((m) => m === "deepseek-v3-2-251201")).toBe(true);
  });

  test("falls back to snapshot.modelConfig.model when turn body omits modelCode", async () => {
    const provider = createCaptureProvider();
    const factory = testEngineFactory(provider);

    await drain(
      factory.runStream({
        sessionId: "2054102360564695040",
        turnId: "2054102360564695043",
        tenant: 58197260,
        prompt: "hi",
        // 不传 turnModelCode；应该走第 2 档：snapshot
        agentSnapshot: {
          agent: {
            content: {
              prompt: "sys",
              modelConfig: { model: "snapshot-default-model" },
            },
          },
        },
      }),
    );

    expect(provider.capturedModels.every((m) => m === "snapshot-default-model")).toBe(true);
  });

  test("multi-turn: same sessionId across two runStream calls — turn 2 includes turn 1 assistant reply in the assembled prompt (Engine singleton + memory continuity)", async () => {
    const FIRST_TURN_ANSWER = "TURN-1-ASSISTANT-CONTENT-MARKER";
    const capturedMessages: { turn: number; msgs: { role: string; content: unknown }[] }[] = [];
    let currentTurn = 1;
    const provider: ProviderAdapter = {
      id: "agentic-platform-llm-catalog",
      name: "StatefulCaptureProvider",
      async listAvailableModels() {
        return [];
      },
      async chat(request: ChatRequest, _ctx: AdapterCallContext): Promise<ChatResponse> {
        capturedMessages.push({
          turn: currentTurn,
          msgs: request.messages.map((m) => ({ role: m.role, content: m.content })),
        });
        return {
          content: FIRST_TURN_ANSWER,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      },
      async *chatStream(request: ChatRequest, _ctx: AdapterCallContext) {
        capturedMessages.push({
          turn: currentTurn,
          msgs: request.messages.map((m) => ({ role: m.role, content: m.content })),
        });
        yield { type: "text-delta", delta: FIRST_TURN_ANSWER } as const;
        yield {
          type: "finish",
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        } as const;
      },
    };
    const factory = testEngineFactory(provider);

    // Turn 1
    await drain(
      factory.runStream({
        sessionId: "SESSION-MULTI-TURN-1",
        turnId: "2054102360564695050",
        tenant: 58197260,
        prompt: "first question",
      }),
    );

    // Turn 2 — same sessionId，新 turnId
    currentTurn = 2;
    await drain(
      factory.runStream({
        sessionId: "SESSION-MULTI-TURN-1",
        turnId: "2054102360564695051",
        tenant: 58197260,
        prompt: "follow up question",
      }),
    );

    // Turn 2 至少一次 provider 调用的 messages 里出现 assistant 角色 + 第一轮答案 marker
    const turn2 = capturedMessages.filter((c) => c.turn === 2);
    const hasFirstAnswerInTurn2 = turn2.some((c) =>
      c.msgs.some((m) => m.role === "assistant" && typeof m.content === "string" && m.content.includes(FIRST_TURN_ANSWER)),
    );
    expect(hasFirstAnswerInTurn2).toBe(true);
  });

  test("empty additionalRules/Skills/Tools path runs to done without errors (no snapshot inline parsing yet — TODO next-phase)", async () => {
    const provider = createCaptureProvider();
    const factory = testEngineFactory(provider);
    // 完全不传 agentSnapshot：systemInstruction、additionalRules/Skills/Tools 全部走默认
    // 空值路径。验证 tachu 不会因空数组而崩。
    const chunks = await drain(
      factory.runStream({
        sessionId: "2054102360564695060",
        turnId: "2054102360564695061",
        tenant: 58197260,
        prompt: "hi",
      }),
    );
    expect(chunks.some((c) => c.type === "done")).toBe(true);
  });

  test("falls back to AGENTIC_ENGINE_MODEL env (or hardcoded default) when both turn body and snapshot omit model", async () => {
    const prevEnv = process.env["AGENTIC_ENGINE_MODEL"];
    process.env["AGENTIC_ENGINE_MODEL"] = "env-fallback-model";
    try {
      const provider = createCaptureProvider();
      const factory = testEngineFactory(provider);
      await drain(
        factory.runStream({
          sessionId: "2054102360564695040",
          turnId: "2054102360564695044",
          tenant: 58197260,
          prompt: "hi",
          // 不传 turnModelCode；snapshot 也不带 modelConfig
          agentSnapshot: { agent: { content: { prompt: "sys" } } },
        }),
      );
      expect(provider.capturedModels.every((m) => m === "env-fallback-model")).toBe(true);
    } finally {
      if (prevEnv === undefined) delete process.env["AGENTIC_ENGINE_MODEL"];
      else process.env["AGENTIC_ENGINE_MODEL"] = prevEnv;
    }
  });

  test("mirrors DescriptorRegistry tools into tachu so the deep loop can see and call them (not empty-tool fallback)", async () => {
    const listDesc = ToolDescriptor.parse({
      schemaVersion: 1,
      kind: "TOOL",
      name: "platform.flow.list",
      displayName: "List flows",
      isPreset: true,
      version: "1.0.0",
      meta: {
        execution: "LOCAL",
        consent: "NEVER",
        requiresPrincipal: "USER",
        timeoutMs: 15_000,
        idempotent: true,
        sideEffects: [],
      },
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { flows: { type: "array" } } },
      requires: { principal: "USER", oauthScope: [], obo: null },
      execute: "builtin:platform.flow.list",
    });
    const mockRegistry = {
      listAll: () => [listDesc],
      resolve: (name: string) => (name === "platform.flow.list" ? listDesc : undefined),
    } as unknown as DescriptorRegistryService;

    // rc.10 深单 loop 无 intent 分类：验证镜像进 tachu 的工具对 loop 首步 LLM 可见
    // 且可真正调用（而非因空工具集走兜底）。
    const invocations: string[] = [];
    const toolService = {
      invoke: async (toolName: string) => {
        invocations.push(toolName);
        return { flows: [] };
      },
    } as unknown as ToolService;

    let toolCallIssued = false;
    const provider: ProviderAdapter = {
      id: "agentic-platform-llm-catalog",
      name: "ToolVisibilityProvider",
      async listAvailableModels() {
        return [];
      },
      async chat(request: ChatRequest, _ctx: AdapterCallContext): Promise<ChatResponse> {
        if (request.tools?.some((t) => t.name === "platform.flow.list") && !toolCallIssued) {
          toolCallIssued = true;
          return {
            content: "",
            finishReason: "tool_calls",
            toolCalls: [{ id: "call-flow-1", name: "platform.flow.list", arguments: {} }],
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        }
        return {
          content: "已为你列出配置好的流程。",
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      },
      async *chatStream(request: ChatRequest, ctx: AdapterCallContext) {
        const r = await provider.chat(request, ctx);
        if (typeof r.content === "string" && r.content.length > 0) {
          yield { type: "text-delta", delta: r.content } as const;
        }
        for (const call of r.toolCalls ?? []) {
          yield { type: "tool-call-complete", call } as const;
        }
        yield {
          type: "finish",
          finishReason: r.finishReason ?? "stop",
          usage: r.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        } as const;
      },
    };

    const factory = testEngineFactory(provider, undefined, mockRegistry, toolService);
    const chunks = await drain(
      factory.runStream({
        sessionId: "2054102360564695070",
        turnId: "2054102360564695071",
        tenant: 1,
        prompt: "当前有哪些配置好的流程？",
      }),
    );

    expect(chunks.some((c) => c.type === "done")).toBe(true);
    expect(invocations).toContain("platform.flow.list");
  });

  test("skillEmbeddingModelCode overrides env for provider.embed", async () => {
    const prev = process.env["AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL"];
    process.env["AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL"] = "env-embedding-model";

    const skillRegistry = new SkillRegistryService();
    skillRegistry.register({
      kind: "skill",
      name: "chart-output",
      version: "1.0.0",
      description: "charts echarts",
      instructions: "use echarts",
      activation: { mode: "semantic" },
    });

    const provider = createCaptureProvider();
    const factory = testEngineFactory(provider, undefined, undefined, undefined, skillRegistry, undefined, provider.llmProvider);
    await drain(
      factory.runStream({
        sessionId: "SESSION-EMBED-MODEL",
        turnId: "2054102360564695090",
        tenant: 1,
        prompt: "图表",
        skillEmbeddingModelCode: "turn-embedding-model",
      }),
    );

    expect(provider.capturedEmbedModels).toContain("turn-embedding-model");
    expect(provider.capturedEmbedModels).not.toContain("env-embedding-model");

    if (prev === undefined) {
      delete process.env["AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL"];
    } else {
      process.env["AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL"] = prev;
    }
  });

  test("mirrors SkillRegistry skills into tachu registry and skill_activation can surface chart-output", async () => {
    const skillRegistry = new SkillRegistryService();
    skillRegistry.register({
      kind: "skill",
      name: "chart-output",
      version: "1.0.0",
      description: "statistics visualization",
      instructions: "Use echarts fenced blocks for statistics visualization.",
      activation: { mode: "semantic" },
    });

    const activationEvents: unknown[] = [];
    const observability: ObservabilityEmitter = {
      on() {
        return () => {};
      },
      off() {},
      emit(ev) {
        if (ev.type === "skill_activation") activationEvents.push(ev);
      },
      setMasker() {},
    };
    const provider = createCaptureProvider();
    const factory = testEngineFactory(provider, observability, undefined, undefined, skillRegistry);

    await drain(
      factory.runStream({
        sessionId: "SESSION-SKILL-RECALL-1",
        turnId: "2054102360564695080",
        tenant: 1,
        prompt: "statistics visualization",
      }),
    );

    const tachuRegistry = (
      factory as unknown as {
        tachuRegistry: { get: (kind: "skill", name: string) => unknown };
      }
    ).tachuRegistry;
    expect(tachuRegistry.get("skill", "chart-output")).toBeDefined();
    const payload = (
      activationEvents[0] as {
        payload?: {
          pinned?: Array<{ name: string }>;
          candidates?: Array<{ name: string }>;
        };
      }
    )?.payload;
    const pinnedNames = (payload?.pinned ?? []).map((p) => p.name);
    const candidateNames = (payload?.candidates ?? []).map((c) => c.name);
    expect(pinnedNames.includes("chart-output") || candidateNames.includes("chart-output")).toBe(true);
  });

  test("refreshes mirrored tachu skills when SkillRegistry signature changes", async () => {
    const skillRegistry = new SkillRegistryService();
    skillRegistry.replaceAllFromSnapshot([
      {
        kind: "skill",
        name: "chart-output",
        version: "1.0.0",
        description: "statistics visualization",
        instructions: "first instructions",
        activation: { mode: "semantic" },
      },
    ]);
    const provider = createCaptureProvider();
    const factory = testEngineFactory(provider, undefined, undefined, undefined, skillRegistry);

    await drain(
      factory.runStream({
        sessionId: "SESSION-SKILL-MIRROR-1",
        turnId: "2054102360564695081",
        tenant: 1,
        prompt: "statistics visualization",
      }),
    );
    skillRegistry.replaceAllFromSnapshot([
      {
        kind: "skill",
        name: "chart-output",
        version: "1.0.0",
        description: "statistics visualization",
        instructions: "second instructions",
        activation: { mode: "semantic" },
      },
    ]);
    await drain(
      factory.runStream({
        sessionId: "SESSION-SKILL-MIRROR-2",
        turnId: "2054102360564695082",
        tenant: 1,
        prompt: "statistics visualization",
      }),
    );

    const skill = (
      factory as unknown as {
        tachuRegistry: {
          get: (kind: "skill", name: string) => { instructions?: string } | null;
        };
      }
    ).tachuRegistry.get("skill", "chart-output");
    expect(skill?.instructions).toBe("second instructions");
  });

  test("tool-use task is executed through engine ToolService with turn auth context", async () => {
    const searchDesc = ToolDescriptor.parse({
      schemaVersion: 1,
      kind: "TOOL",
      name: "mcp.web-search.search",
      displayName: "Web Search",
      isPreset: false,
      version: "1.0.0",
      meta: {
        execution: "REMOTE",
        consent: "NEVER",
        requiresPrincipal: "USER",
        timeoutMs: 120_000,
        idempotent: true,
        sideEffects: ["read:web.search"],
      },
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: { query: { type: "string", description: "Search query" } },
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", description: "Search results" } },
      },
      requires: { principal: "USER", oauthScope: [], obo: null },
      execute: "mcp:web-search:search",
      handler: { kind: "mcp", config: {} },
      category: "MCP",
      tags: ["web", "search"],
    });
    const mockRegistry = {
      listAll: () => [searchDesc],
      resolve: (name: string) => (name === "mcp.web-search.search" ? searchDesc : undefined),
    } as unknown as DescriptorRegistryService;

    const invocations: Array<{
      toolName: string;
      input: unknown;
      tenant: number;
      userId?: string;
      sessionId: string;
      turnId: string;
      toolCallId?: string;
    }> = [];
    const toolService = {
      invoke: async (toolName, input, ctx, options) => {
        invocations.push({
          toolName,
          input,
          tenant: ctx.auth.tenant,
          userId: ctx.auth.user?.userId,
          sessionId: ctx.session.id,
          turnId: ctx.session.turnId,
          toolCallId: options?.toolCallId,
        });
        await options?.onProgress?.({
          progressToken: options.toolCallId ?? "missing-tool-call-id",
          progress: 1,
          total: 2,
          message: "querying",
        });
        return { results: [{ title: "hit", url: "https://example.test" }] };
      },
    } satisfies Pick<ToolService, "invoke">;

    let toolCallIssued = false;
    const provider: ProviderAdapter = {
      id: "agentic-platform-llm-catalog",
      name: "ToolCallingProvider",
      async listAvailableModels() {
        return [];
      },
      async chat(request: ChatRequest, _ctx: AdapterCallContext): Promise<ChatResponse> {
        if (request.tools?.some((t) => t.name === "mcp.web-search.search") && !toolCallIssued) {
          toolCallIssued = true;
          return {
            content: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call-web-1",
                name: "mcp.web-search.search",
                arguments: { query: "cube ai" },
              },
            ],
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        }
        return {
          content: "Search complete.",
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      },
      async *chatStream(request: ChatRequest, ctx: AdapterCallContext) {
        const r = await provider.chat(request, ctx);
        if (typeof r.content === "string" && r.content.length > 0) {
          yield { type: "text-delta", delta: r.content } as const;
        }
        for (const call of r.toolCalls ?? []) {
          yield { type: "tool-call-complete", call } as const;
        }
        yield {
          type: "finish",
          finishReason: r.finishReason ?? "stop",
          usage: r.usage,
        } as const;
      },
    };

    const factory = testEngineFactory(provider, undefined, mockRegistry, toolService as ToolService);

    const chunks = await drain(
      factory.runStream({
        sessionId: "2054102360564695080",
        turnId: "2054102360564695081",
        tenant: 42,
        userId: "u-42",
        scopes: ["web.search"],
        prompt: "最新 cube ai 新闻是什么？",
      }),
    );

    expect(chunks.some((c) => c.type === "done")).toBe(true);
    const progressChunk = chunks.find((c) => c.type === "progress") as
      | (StreamChunk & { payload?: Record<string, unknown> })
      | undefined;
    expect(progressChunk?.payload).toMatchObject({
      message: "querying",
      progress: 0.5,
      status: "mcp.progress",
      toolCallId: "call-web-1",
      toolName: "mcp.web-search.search",
    });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      toolName: "mcp.web-search.search",
      input: { query: "cube ai" },
      tenant: 42,
      userId: "u-42",
      sessionId: "2054102360564695080",
      turnId: "2054102360564695081",
      toolCallId: "call-web-1",
    });
  });

  test("tool-use emits safe local progress while waiting when MCP sends no progress notification", async () => {
    const prevEnabled = process.env["AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_ENABLED"];
    const prevInitial = process.env["AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_INITIAL_MS"];
    const prevExtended = process.env["AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_EXTENDED_MS"];
    process.env["AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_ENABLED"] = "1";
    process.env["AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_INITIAL_MS"] = "1";
    process.env["AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_EXTENDED_MS"] = "5";
    try {
      const searchDesc = ToolDescriptor.parse({
        schemaVersion: 1,
        kind: "TOOL",
        name: "mcp.web-search.search",
        displayName: "Web Search",
        isPreset: false,
        version: "1.0.0",
        meta: {
          execution: "REMOTE",
          consent: "NEVER",
          requiresPrincipal: "USER",
          timeoutMs: 120_000,
          idempotent: true,
          sideEffects: ["read:web.search"],
        },
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: { query: { type: "string", description: "Search query" } },
        },
        outputSchema: {
          type: "object",
          properties: { results: { type: "array", description: "Search results" } },
        },
        requires: { principal: "USER", oauthScope: [], obo: null },
        execute: "mcp:web-search:search",
        handler: { kind: "mcp", config: {} },
        category: "MCP",
        tags: ["web", "search"],
      });
      const mockRegistry = {
        listAll: () => [searchDesc],
        resolve: (name: string) => (name === "mcp.web-search.search" ? searchDesc : undefined),
      } as unknown as DescriptorRegistryService;

      const toolService = {
        invoke: async () => {
          await delay(20);
          return { results: [{ title: "hit", url: "https://example.test" }] };
        },
      } satisfies Pick<ToolService, "invoke">;

      let toolCallIssued = false;
      const provider: ProviderAdapter = {
        id: "agentic-platform-llm-catalog",
        name: "ToolCallingProvider",
        async listAvailableModels() {
          return [];
        },
        async chat(request: ChatRequest, _ctx: AdapterCallContext): Promise<ChatResponse> {
          if (request.tools?.some((t) => t.name === "mcp.web-search.search") && !toolCallIssued) {
            toolCallIssued = true;
            return {
              content: "",
              finishReason: "tool_calls",
              toolCalls: [{ id: "call-web-1", name: "mcp.web-search.search", arguments: { query: "cube ai" } }],
              usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            };
          }
          return {
            content: "Search complete.",
            finishReason: "stop",
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        },
        async *chatStream(request: ChatRequest, ctx: AdapterCallContext) {
          const r = await provider.chat(request, ctx);
          if (typeof r.content === "string" && r.content.length > 0) {
            yield { type: "text-delta", delta: r.content } as const;
          }
          for (const call of r.toolCalls ?? []) {
            yield { type: "tool-call-complete", call } as const;
          }
          yield { type: "finish", finishReason: r.finishReason ?? "stop", usage: r.usage } as const;
        },
      };

      const factory = testEngineFactory(provider, undefined, mockRegistry, toolService as ToolService);
      const chunks = await drain(
        factory.runStream({
          sessionId: "2054102360564695080",
          turnId: "2054102360564695081",
          tenant: 42,
          userId: "u-42",
          scopes: ["web.search"],
          prompt: "最新 cube ai 新闻是什么？",
        }),
      );

      const progressChunks = chunks.filter((c) => c.type === "progress") as Array<StreamChunk & { payload?: Record<string, unknown> }>;
      const statuses = progressChunks.map((c) => c.payload?.["status"]);
      expect(statuses).toContain("tool.local.processing");
      expect(statuses).toContain("tool.local.querying");
      expect(progressChunks[0]?.payload).toMatchObject({
        safeDisplayMessage: "正在处理",
        toolCallId: "call-web-1",
        toolName: "mcp.web-search.search",
      });
      expect(JSON.stringify(progressChunks)).not.toContain("cube ai");
      expect(chunks.some((c) => c.type === "done")).toBe(true);
    } finally {
      if (prevEnabled === undefined) delete process.env["AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_ENABLED"];
      else process.env["AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_ENABLED"] = prevEnabled;
      if (prevInitial === undefined) delete process.env["AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_INITIAL_MS"];
      else process.env["AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_INITIAL_MS"] = prevInitial;
      if (prevExtended === undefined) delete process.env["AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_EXTENDED_MS"];
      else process.env["AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_EXTENDED_MS"] = prevExtended;
    }
  });

  test("tool-use resolves ToolService lazily via toolServiceProvider (no eager instance) so a slow/late DI binding never degrades to a stub", async () => {
    const searchDesc = ToolDescriptor.parse({
      schemaVersion: 1,
      kind: "TOOL",
      name: "mcp.web-search.search",
      displayName: "Web Search",
      isPreset: false,
      version: "1.0.0",
      meta: {
        execution: "REMOTE",
        consent: "NEVER",
        requiresPrincipal: "USER",
        timeoutMs: 120_000,
        idempotent: true,
        sideEffects: ["read:web.search"],
      },
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: { query: { type: "string", description: "Search query" } },
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", description: "Search results" } },
      },
      requires: { principal: "USER", oauthScope: [], obo: null },
      execute: "mcp:web-search:search",
      handler: { kind: "mcp", config: {} },
      category: "MCP",
      tags: ["web", "search"],
    });
    const mockRegistry = {
      listAll: () => [searchDesc],
      resolve: (name: string) => (name === "mcp.web-search.search" ? searchDesc : undefined),
    } as unknown as DescriptorRegistryService;

    let invokeCount = 0;
    let providerCalls = 0;
    const toolService = {
      invoke: async () => {
        invokeCount += 1;
        return { results: [{ title: "hit", url: "https://example.test" }] };
      },
    } satisfies Pick<ToolService, "invoke">;

    let toolCallIssued = false;
    const provider: ProviderAdapter = {
      id: "agentic-platform-llm-catalog",
      name: "ToolCallingProvider",
      async listAvailableModels() {
        return [];
      },
      async chat(request: ChatRequest, _ctx: AdapterCallContext): Promise<ChatResponse> {
        if (request.tools?.some((t) => t.name === "mcp.web-search.search") && !toolCallIssued) {
          toolCallIssued = true;
          return {
            content: "",
            finishReason: "tool_calls",
            toolCalls: [{ id: "call-web-1", name: "mcp.web-search.search", arguments: { query: "cube ai" } }],
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        }
        return {
          content: "Search complete.",
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      },
      async *chatStream(request: ChatRequest, ctx: AdapterCallContext) {
        const r = await provider.chat(request, ctx);
        if (typeof r.content === "string" && r.content.length > 0) {
          yield { type: "text-delta", delta: r.content } as const;
        }
        for (const call of r.toolCalls ?? []) {
          yield { type: "tool-call-complete", call } as const;
        }
        yield { type: "finish", finishReason: r.finishReason ?? "stop", usage: r.usage } as const;
      },
    };

    // Eager ToolService slot is intentionally `undefined`; ToolService is only
    // reachable through the lazy provider (mirrors SessionModule wiring).
    const factory = new EngineFactory(
      provider,
      undefined,
      new InMemoryStore(),
      createTurnContextHolder(),
      mockRegistry,
      undefined,
      undefined,
      undefined,
      undefined,
      (provider as CaptureProvider).llmProvider,
      () => {
        providerCalls += 1;
        return toolService as ToolService;
      },
    );

    const chunks = await drain(
      factory.runStream({
        sessionId: "2054102360564695080",
        turnId: "2054102360564695081",
        tenant: 42,
        userId: "u-42",
        scopes: ["web.search"],
        prompt: "最新 cube ai 新闻是什么？",
      }),
    );

    expect(chunks.some((c) => c.type === "done")).toBe(true);
    // The lazy provider was consulted and the real ToolService actually ran —
    // i.e. the call did NOT degrade to a `[executed:tool] <ref>` stub.
    expect(providerCalls).toBeGreaterThan(0);
    expect(invokeCount).toBe(1);
  });

  test("runStream injects an explicitly @mentioned manual rule into the SYSTEM prompt via tachu additionalRules (not the user message, not memory)", async () => {
    const provider = createCaptureProvider();
    const observabilityEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const observability: ObservabilityEmitter = {
      emit(ev) {
        observabilityEvents.push({ type: ev.type, payload: ev.payload ?? {} });
      },
      on: () => () => {},
      off: () => {},
      setMasker: () => {},
    };
    const factory = testEngineFactory(provider, observability);
    const MANUAL_RULE_MARKER = "MANUAL-RULE-SQL-STYLE-MARKER";

    await drain(
      factory.runStream({
        sessionId: "SESSION-MANUAL-RULE-1",
        turnId: "TURN-MANUAL-RULE-1",
        tenant: 1,
        prompt: "请遵守 @sql-style 帮我写查询",
        agentSnapshot: {
          agent: { content: { prompt: "BASE-PROMPT" } },
          rules: [
            {
              name: "sql-style",
              versionNo: 1,
              content: { kind: "rule", name: "sql-style", content: MANUAL_RULE_MARKER, activation: { mode: "manual" } },
            },
          ],
        },
      }),
    );

    const flat = (c: unknown): string =>
      typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c.map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text?: unknown }).text ?? "") : "")).join("\n")
          : "";
    const lastMsgs = provider.capturedMessages.at(-1) ?? [];
    // tachu 把命中的 manual 规则渲染进 system 段的 `## Hard Rules`；用户话轮不含规则正文（→ 不入 memory）。
    const inSystem = lastMsgs.some((m) => m.role === "system" && flat(m.content).includes(MANUAL_RULE_MARKER));
    const inUser = lastMsgs.some((m) => m.role === "user" && flat(m.content).includes(MANUAL_RULE_MARKER));
    expect(inSystem).toBe(true);
    expect(inUser).toBe(false);
    expect(
      observabilityEvents.some((ev) => ev.type === "manual_rule_injected" && (ev.payload.rules as string[])?.includes("sql-style")),
    ).toBe(true);
  });

  test("runStream does NOT inject a manual rule that was not mentioned this turn", async () => {
    const provider = createCaptureProvider();
    const factory = testEngineFactory(provider);
    const MARKER = "MANUAL-RULE-UNMENTIONED-MARKER";

    await drain(
      factory.runStream({
        sessionId: "SESSION-MANUAL-RULE-2",
        turnId: "TURN-MANUAL-RULE-2",
        tenant: 1,
        prompt: "帮我写个查询",
        agentSnapshot: {
          agent: { content: { prompt: "BASE-PROMPT" } },
          rules: [
            {
              name: "sql-style",
              versionNo: 1,
              content: { kind: "rule", name: "sql-style", content: MARKER, activation: { mode: "manual" } },
            },
          ],
        },
      }),
    );

    const flat = (c: unknown): string =>
      typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c.map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text?: unknown }).text ?? "") : "")).join("\n")
          : "";
    const anyHas = provider.capturedMessages.some((msgs) => msgs.some((m) => flat(m.content).includes(MARKER)));
    expect(anyHas).toBe(false);
  });

  test("runStream always-activation snapshot rule is injected into the SYSTEM prompt every turn without any mention", async () => {
    const provider = createCaptureProvider();
    const factory = testEngineFactory(provider);
    const ALWAYS_RULE_MARKER = "ALWAYS-RULE-SAFETY-MARKER";

    await drain(
      factory.runStream({
        sessionId: "SESSION-ALWAYS-RULE-1",
        turnId: "TURN-ALWAYS-RULE-1",
        tenant: 1,
        prompt: "hello",
        agentSnapshot: {
          agent: { content: { prompt: "BASE-PROMPT" } },
          rules: [
            {
              name: "safety-baseline",
              versionNo: 1,
              content: { kind: "rule", name: "safety-baseline", content: ALWAYS_RULE_MARKER, activation: { mode: "always" } },
            },
          ],
        },
      }),
    );

    const inSystem = provider.capturedMessages.some((msgs) =>
      msgs.some((m) => m.role === "system" && typeof m.content === "string" && m.content.includes(ALWAYS_RULE_MARKER)),
    );
    expect(inSystem).toBe(true);
  });
});
