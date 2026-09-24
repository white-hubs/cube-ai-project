import {
  DefaultRetrievalPolicyRegistry,
  createDefaultToolCandidateStrategies,
  DefaultSemanticRetrievalFacade,
  DescriptorRegistry,
  Engine,
  INTERNAL_SUBFLOW_NAMES,
  DEFAULT_ADAPTER_CALL_CONTEXT,
  type EngineConfig,
  type MemoryEntry,
  type MemorySystem,
  type ModelRoute,
  type ObservabilityEmitter,
  type ProviderAdapter,
  type TaskExecutor,
} from "@tachu/core";
import { projectMemoryRefs, type ProjectionWorker } from "@tachu/extensions/memory";
import { buildHostEngineDependencies, ENGINE_INIT_CORRELATION } from "@tachu/host-defaults";

import { createTurnAwareEmbeddingRuntime, TurnAwareEmbeddingRuntime } from "@cube-ai/agent-engine/adapters/embedding";
import { RedisProjectedMemorySystem } from "@cube-ai/agent-engine/adapters/memory";
import { LlmProviderPortBridge } from "@cube-ai/agent-engine/adapters/provider";
import { CubeQdrantMemoryIndex } from "@cube-ai/agent-engine/adapters/vector";
import { AGENTIC_ENGINE_MEMORY_COLLECTION } from "@cube-ai/agent-engine/adapters/vector";
import type { LlmProviderPort } from "@cube-ai/contracts/platform";

import type { ImageAssetReader } from "../files/image-asset-reader";
import { KeywordCandidateStrategy } from "../skill-activation/keyword-candidate.strategy";
import { resolveSkillEmbeddingModelCode } from "../skill-activation/skill-embedding-config";
import { KeywordToolStrategy, SemanticToolStrategy } from "../tool-activation";
import { DataChartGatingPolicyToolStrategy } from "../tool-activation/data-chart-gating-policy.strategy";
import {
  CUBE_TOOL_USE_SYSTEM_PROMPT_BASE,
  CUBE_TOOL_USE_SYSTEM_PROMPT_SUFFIX,
  CUBE_VALIDATION_SEMANTIC_JUDGE_SYSTEM_PROMPT_BASE,
} from "./cube-engine-prompt-overrides";
import { LocalFileMultimodalResolver } from "./local-file-multimodal-resolver";
import { createResourceDemandRouter } from "./resource-demand-router";
import { resolveNonEmptyModel, TACHU_INTERNAL_TOOL_NAMES } from "./tachu.tokens";
import type { TurnContextHolder } from "./turn-context-holder";

export interface AssembleTachuRuntimeInput {
  provider: ProviderAdapter;
  observability: ObservabilityEmitter;
  memorySystem: MemorySystem;
  turnContext: TurnContextHolder;
  taskExecutor: TaskExecutor;
  engineConfig?: EngineConfig | undefined;
  /** Resolves opaque file.uri to Provider base64. */
  imageAssetReader?: ImageAssetReader;
  /** Preferred embedding path via @cube-ai/embedding (ADR-0005). */
  llmProvider?: LlmProviderPort;
}

export interface AssembleTachuRuntimeResult {
  engine: Engine;
  registry: DescriptorRegistry;
  memorySystem: MemorySystem;
  embeddingRuntime?: TurnAwareEmbeddingRuntime | undefined;
  vectorIndex?: CubeQdrantMemoryIndex | undefined;
  projectionWorker?: ProjectionWorker | undefined;
  initWarnings: string[];
}

/**
 * 对外问数只暴露 ask_business_data。pin 这个工具时不再带上本体检索工具。
 */
const BIZ_ONTOLOGY_ASK_BUSINESS_DATA_TOOL = "mcp.biz-ontology.ask_business_data";
const BIZ_ONTOLOGY_DISCOVERY_SIBLINGS: readonly string[] = [];

/**
 * tachu 内置「宿主 gating-policy」工具候选策略的运行时 `name`。
 *
 * 我们只从 tachu 默认策略集里复用这一条——它消费 `InputEnvelope.metadata.gatingPolicy`
 * 的 include/exclude（由 {@link applyHostGatingPolicyPreseed} 预置：data-chart 排除 image.qwen、
 * 生成图强制纳入 image.qwen），其余默认策略由本仓的 Keyword/Semantic/DataChart 策略取代。
 *
 * rc.12 把该策略 `IntentTurnPolicyToolStrategy` 重命名为 `HostPolicyToolStrategy`
 * （`name`：`"intent-turn-policy"` → `"host-policy"`）；rc.13 把 `TurnPolicy` 类型/字段
 * 统一改名到 `GatingPolicy`（`name` 不变，仍是 `"host-policy"`）。用具名常量 + 单测钉住
 * 这个字符串，让未来 tachu 再改名时测试**显式失败**，而不是 filter 静默返回空数组、导致 preseed 失效。
 */
export const HOST_POLICY_TOOL_STRATEGY_NAME = "host-policy";

/**
 * 单次 run（一个 turn）的 tachu 预算默认值。env 缺省时回退到这里。
 * `maxTokens` 跨本轮所有 tool-loop step 累计；大工具结果 + 每步重发全量历史易累计触顶。
 */
const DEFAULT_RUN_MAX_TOKENS = 500_000;
const DEFAULT_RUN_MAX_TOOL_CALLS = 500;
const DEFAULT_RUN_MAX_WALL_TIME_MS = 3_000_000;

/**
 * 解析正整数 env（run 预算旋钮）。缺省 / 空串 / 非法 / 非正 → 回退默认值
 * （fail-safe：绝不把预算降成 0 或 NaN 而误杀所有请求）。
 * 让 {@link buildDefaultEngineConfig} 的 `budget` 线上可调而不改码。
 */
function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

/**
 * 布尔 env 开关（"1"/"true"/"yes"/"on" → true）。
 *
 * `AGENTIC_ENGINE_SKILL_EMBEDDING_DISABLED` 用于运行期彻底关掉引擎内 embedding：
 * 不建 embeddingRuntime → semanticRetrievalFacade 回退到宿主无向量实现 →
 * 技能激活 activation-core 不再发 embedding HTTP（退化为 keyword/sticky/pinned）。
 * 仅清空 `AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL` 无效——模型会 fallback 到 text-embedding-3-small。
 */
function truthyEnv(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function buildDefaultEngineConfig(providerId: string, defaultModel: string): EngineConfig {
  const route: ModelRoute = { provider: providerId, model: defaultModel };
  return {
    registry: { descriptorPaths: [], enableVectorIndexing: false },
    toolUse: {
      systemPromptBase: CUBE_TOOL_USE_SYSTEM_PROMPT_BASE,
      systemPromptSuffix: CUBE_TOOL_USE_SYSTEM_PROMPT_SUFFIX,
    },
    validation: {
      semanticJudgeSystemPromptBase: CUBE_VALIDATION_SEMANTIC_JUDGE_SYSTEM_PROMPT_BASE,
    },
    runtime: {
      planMode: false,
      maxConcurrency: 2,
      defaultTaskTimeoutMs: 600_000,
      failFast: false,
      streamingOutput: true,
      skillBudget: 0.8,
      skillActivationMode: "activator",
      candidateTopK: 20,
      stickyTtlTurns: 8,
      stickyMaxSlots: 3,
      enableSearchSkillsTool: true,
      // 弱模型工具调用鲁棒性（tachu rc.10，ADR-0031）——与 W1/W2 prompt、groundingPrefetch 纵深互补：
      // ① discoveryExpansion：pin 动作工具时把同域发现兄弟一并送入本轮（治 tool starvation）。
      // ② toolLoop.failureRecoveryRetries：查库失败且零成功时强制再走一步（框住「一次失败即放弃」，
      //    默认提示词英文、与 W1 同源，无需覆盖）。显式写 1 = 意图可读 + 防 tachu 默认漂移。
      toolActivation: {
        discoveryExpansion: {
          enabled: true,
          siblings: { [BIZ_ONTOLOGY_ASK_BUSINESS_DATA_TOOL]: [...BIZ_ONTOLOGY_DISCOVERY_SIBLINGS] },
        },
      },
      toolLoop: { failureRecoveryRetries: 1 },
    },
    memory: {
      contextTokenLimit: 8000,
      compressionThreshold: 0.8,
      headKeep: 4,
      tailKeep: 4,
      archivePath: ".tachu/archive/cube-agentic-engine.jsonl",
      vectorIndexLimit: 1000,
    },
    budget: {
      maxTokens: positiveIntEnv("AGENTIC_ENGINE_RUN_MAX_TOKENS", DEFAULT_RUN_MAX_TOKENS),
      maxToolCalls: positiveIntEnv("AGENTIC_ENGINE_RUN_MAX_TOOL_CALLS", DEFAULT_RUN_MAX_TOOL_CALLS),
      maxWallTimeMs: positiveIntEnv("AGENTIC_ENGINE_RUN_MAX_WALL_TIME_MS", DEFAULT_RUN_MAX_WALL_TIME_MS),
    },
    safety: {
      maxInputSizeBytes: 5 * 1024 * 1024,
      maxRecursionDepth: 8,
      workspaceRoot: process.cwd(),
      promptInjectionPatterns: [],
    },
    models: {
      capabilityMapping: {
        intent: route,
        planning: route,
        validation: route,
        "fast-cheap": route,
        "high-reasoning": route,
      },
      providerFallbackOrder: [providerId],
    },
    providers: {
      qdrant: {
        baseURL: process.env["AGENTIC_ENGINE_QDRANT_URL"] ?? "http://localhost:6333",
        extra: {
          vectorIndex: {
            url: process.env["AGENTIC_ENGINE_QDRANT_URL"] ?? "http://localhost:6333",
            collectionName: AGENTIC_ENGINE_MEMORY_COLLECTION,
            vectorSize: Number(process.env["AGENTIC_ENGINE_MEMORY_VECTOR_SIZE"] ?? "1536"),
          },
        },
      },
    },
    observability: { enabled: true, maskSensitiveData: true },
    hooks: { writeHookTimeout: 1000, failureBehavior: "continue" },
  };
}

function memoryEntryContentText(entry: MemoryEntry): string {
  if (typeof entry.content === "string") return entry.content;
  if (entry.content === null || entry.content === undefined) return "";
  try {
    return JSON.stringify(entry.content);
  } catch {
    return String(entry.content);
  }
}

function createLoadEntry(memory: RedisProjectedMemorySystem) {
  return async (sessionId: string, ref: string) => {
    const entries = await memory.loadFull(sessionId);
    const entry = entries.find((e: MemoryEntry) => e.id === ref);
    if (!entry) return null;
    return { entry, content: memoryEntryContentText(entry) };
  };
}

/**
 * Pure assembly for tachu {@link Engine} + cube projection stack.
 */
export function assembleTachuRuntime(input: AssembleTachuRuntimeInput): AssembleTachuRuntimeResult {
  const defaultModel = resolveNonEmptyModel(process.env["AGENTIC_ENGINE_MODEL"], "gpt-4o-mini");
  const defaultEmbeddingModel =
    resolveSkillEmbeddingModelCode() ?? resolveNonEmptyModel(process.env["AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL"], "text-embedding-3-small");

  const config = input.engineConfig ?? buildDefaultEngineConfig(input.provider.id, defaultModel);

  const hostResult = buildHostEngineDependencies(config, {
    observability: input.observability,
    providers: [input.provider],
  });

  const initWarnings: string[] = [];
  const registry = new DescriptorRegistry({
    reservedNames: [...INTERNAL_SUBFLOW_NAMES, ...TACHU_INTERNAL_TOOL_NAMES],
  });

  let embeddingRuntime: TurnAwareEmbeddingRuntime | undefined;
  let vectorIndex: CubeQdrantMemoryIndex | undefined;
  let projectionWorker: ProjectionWorker | undefined;

  const llmProvider =
    input.llmProvider ?? (input.provider instanceof LlmProviderPortBridge ? input.provider.getLlmProviderPort() : undefined);

  const skillEmbeddingDisabled = truthyEnv("AGENTIC_ENGINE_SKILL_EMBEDDING_DISABLED");

  if (!skillEmbeddingDisabled && llmProvider && typeof input.provider.embed === "function") {
    const memoryVectorSize = Number(process.env["AGENTIC_ENGINE_MEMORY_VECTOR_SIZE"] ?? "1536");
    const memoryTenant = Number(process.env["AGENTIC_ENGINE_MEMORY_TENANT_ID"] ?? "1");
    embeddingRuntime = createTurnAwareEmbeddingRuntime({
      provider: llmProvider,
      defaultModel: defaultEmbeddingModel,
      getTurnContext: () => input.turnContext.callContext,
      resolveModelCode: () =>
        resolveSkillEmbeddingModelCode({
          turnModelCode: input.turnContext.embeddingModelCode,
        }),
      tenant: memoryTenant,
      dimension: memoryVectorSize,
    });

    vectorIndex = new CubeQdrantMemoryIndex({
      url: process.env["AGENTIC_ENGINE_QDRANT_URL"] ?? "http://localhost:6333",
      apiKey: process.env["AGENTIC_ENGINE_QDRANT_API_KEY"],
      vectorSize: Number(process.env["AGENTIC_ENGINE_MEMORY_VECTOR_SIZE"] ?? "1536"),
      searchTenant: Number(process.env["AGENTIC_ENGINE_MEMORY_TENANT_ID"] ?? "1"),
    });

    if (input.memorySystem instanceof RedisProjectedMemorySystem) {
      const mem = input.memorySystem;
      const projectionCtx = {
        ...DEFAULT_ADAPTER_CALL_CONTEXT,
        tenant: Number(process.env["AGENTIC_ENGINE_MEMORY_TENANT_ID"] ?? "1"),
      };
      const loadEntry = createLoadEntry(mem);
      mem.bindProjectionProject((sessionId: string, refs: readonly string[], signal: AbortSignal) =>
        projectMemoryRefs(
          {
            embedding: embeddingRuntime!,
            vectorIndex: vectorIndex!,
            loadEntry,
          },
          sessionId,
          refs,
          projectionCtx,
          signal,
        ),
      );
      try {
        projectionWorker = mem.createProjectionWorker();
      } catch {
        /* outbox not wired — recall still works, archive enqueue may fail */
      }
    }

    input.observability.emit({
      timestamp: Date.now(),
      correlation: ENGINE_INIT_CORRELATION,
      phase: "init",
      type: "progress",
      payload: {
        status: "projection.available",
        providerId: input.provider.id,
        model: defaultEmbeddingModel,
        vectorIndexKind: "qdrant",
      },
    });
  } else {
    const status = skillEmbeddingDisabled ? "embedding.disabled.env" : "projection.disabled";
    const reason = skillEmbeddingDisabled
      ? "disabled_by_env: AGENTIC_ENGINE_SKILL_EMBEDDING_DISABLED"
      : "provider does not implement embed()";
    initWarnings.push(status);
    input.observability.emit({
      timestamp: Date.now(),
      correlation: ENGINE_INIT_CORRELATION,
      phase: "init",
      type: "warning",
      payload: { status, reason },
    });
  }

  const semanticRetrievalFacade = embeddingRuntime
    ? new DefaultSemanticRetrievalFacade({
        policy: new DefaultRetrievalPolicyRegistry(),
        embedding: embeddingRuntime,
      })
    : hostResult.engineDependencies.semanticRetrievalFacade;

  const multimodalResolver = input.imageAssetReader ? new LocalFileMultimodalResolver(input.imageAssetReader) : undefined;

  const resourceDemandRouter = createResourceDemandRouter();

  const engine = new Engine(config, {
    ...hostResult.engineDependencies,
    semanticRetrievalFacade,
    registry,
    memorySystem: input.memorySystem,
    taskExecutor: input.taskExecutor,
    ...(multimodalResolver !== undefined ? { multimodalResolver } : {}),
    resourceDemandRouter,
    candidateStrategies: [new KeywordCandidateStrategy()],
    toolStrategies: [
      ...createDefaultToolCandidateStrategies().filter((strategy) => strategy.name === HOST_POLICY_TOOL_STRATEGY_NAME),
      new DataChartGatingPolicyToolStrategy(),
      new KeywordToolStrategy(() => input.turnContext.intentRoutingBlock),
      new SemanticToolStrategy(() => input.turnContext.intentRoutingBlock),
    ],
    observability: input.observability,
  });

  return {
    engine,
    registry,
    memorySystem: input.memorySystem,
    embeddingRuntime,
    vectorIndex,
    projectionWorker,
    initWarnings,
  };
}
