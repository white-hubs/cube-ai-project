import { buildHostEngineDependencies, ENGINE_INIT_CORRELATION } from '@tachu/host-defaults';
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
} from '@tachu/core';
import { projectMemoryRefs, type ProjectionWorker } from '@tachu/extensions/memory';
import {
  createTurnAwareEmbeddingRuntime,
  TurnAwareEmbeddingRuntime,
} from '@cube-ai/agent-engine/adapters/embedding';
import { LlmProviderPortBridge } from '@cube-ai/agent-engine/adapters/provider';
import { CubeQdrantMemoryIndex } from '@cube-ai/agent-engine/adapters/vector';
import { AGENTIC_ENGINE_MEMORY_COLLECTION } from '@cube-ai/agent-engine/adapters/vector';
import type { LlmProviderPort } from '@cube-ai/contracts/platform';
import { RedisProjectedMemorySystem } from '@cube-ai/agent-engine/adapters/memory';
import type { ImageAssetReader } from '../files/image-asset-reader';
import { KeywordCandidateStrategy } from '../skill-activation/keyword-candidate.strategy';
import { LocalFileMultimodalResolver } from './local-file-multimodal-resolver';
import { createResourceDemandRouter } from './resource-demand-router';
import { resolveSkillEmbeddingModelCode } from '../skill-activation/skill-embedding-config';
import { DataChartTurnPolicyToolStrategy } from '../tool-activation/data-chart-turn-policy.strategy';
import { KeywordToolStrategy, SemanticToolStrategy } from '../tool-activation';
import type { TurnContextHolder } from './turn-context-holder';
import {
  CUBE_DIRECT_ANSWER_SYSTEM_PROMPT_BASE,
  CUBE_INTENT_FEW_SHOT_EXAMPLES,
  CUBE_INTENT_SYSTEM_PROMPT_BASE,
  CUBE_TOOL_USE_FINAL_ANSWER_SYSTEM_PROMPT_BASE,
  CUBE_TOOL_USE_SYSTEM_PROMPT_BASE,
  CUBE_TOOL_USE_SYSTEM_PROMPT_SUFFIX,
  CUBE_VALIDATION_SEMANTIC_JUDGE_SYSTEM_PROMPT_BASE,
} from './cube-engine-prompt-overrides';
import {
  resolveNonEmptyModel,
  TACHU_INTERNAL_TOOL_NAMES,
} from './tachu.tokens';

export interface AssembleTachuRuntimeInput {
  provider: ProviderAdapter;
  observability: ObservabilityEmitter;
  memorySystem: MemorySystem;
  turnContext: TurnContextHolder;
  taskExecutor: TaskExecutor;
  engineConfig?: EngineConfig | undefined;
  /** Resolves opaque file.uri to Provider base64 (ADR-0024). */
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

export function buildDefaultEngineConfig(
  providerId: string,
  defaultModel: string,
): EngineConfig {
  const route: ModelRoute = { provider: providerId, model: defaultModel };
  return {
    registry: { descriptorPaths: [], enableVectorIndexing: false },
    intent: {
      disableSimpleMarkers: true,
      systemPromptBase: CUBE_INTENT_SYSTEM_PROMPT_BASE,
      fewShotExamples: CUBE_INTENT_FEW_SHOT_EXAMPLES,
    },
    toolUse: {
      systemPromptBase: CUBE_TOOL_USE_SYSTEM_PROMPT_BASE,
      systemPromptSuffix: CUBE_TOOL_USE_SYSTEM_PROMPT_SUFFIX,
      finalAnswerSystemPromptBase: CUBE_TOOL_USE_FINAL_ANSWER_SYSTEM_PROMPT_BASE,
    },
    directAnswer: {
      systemPromptBase: CUBE_DIRECT_ANSWER_SYSTEM_PROMPT_BASE,
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
      skillActivationMode: 'activator',
      candidateTopK: 20,
      stickyTtlTurns: 8,
      stickyMaxSlots: 3,
      enableSearchSkillsTool: true,
    },
    memory: {
      contextTokenLimit: 8000,
      compressionThreshold: 0.8,
      headKeep: 4,
      tailKeep: 4,
      archivePath: '.tachu/archive/cube-agentic-engine.jsonl',
      vectorIndexLimit: 1000,
    },
    budget: { maxTokens: 500_000, maxToolCalls: 500, maxWallTimeMs: 3_000_000 },
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
        'fast-cheap': route,
        'high-reasoning': route,
      },
      providerFallbackOrder: [providerId],
    },
    providers: {
      qdrant: {
        baseURL: process.env['AGENTIC_ENGINE_QDRANT_URL'] ?? 'http://localhost:6333',
        extra: {
          vectorIndex: {
            url: process.env['AGENTIC_ENGINE_QDRANT_URL'] ?? 'http://localhost:6333',
            collectionName: AGENTIC_ENGINE_MEMORY_COLLECTION,
            vectorSize: Number(process.env['AGENTIC_ENGINE_MEMORY_VECTOR_SIZE'] ?? '1536'),
          },
        },
      },
    },
    observability: { enabled: true, maskSensitiveData: true },
    hooks: { writeHookTimeout: 1000, failureBehavior: 'continue' },
  };
}

function memoryEntryContentText(entry: MemoryEntry): string {
  if (typeof entry.content === 'string') return entry.content;
  if (entry.content === null || entry.content === undefined) return '';
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
 * Pure assembly for tachu {@link Engine} + cube projection stack (ADR-0021).
 */
export function assembleTachuRuntime(
  input: AssembleTachuRuntimeInput,
): AssembleTachuRuntimeResult {
  const defaultModel = resolveNonEmptyModel(
    process.env['AGENTIC_ENGINE_MODEL'],
    'gpt-4o-mini',
  );
  const defaultEmbeddingModel =
    resolveSkillEmbeddingModelCode() ??
    resolveNonEmptyModel(process.env['AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL'], 'text-embedding-3-small');

  const config =
    input.engineConfig ?? buildDefaultEngineConfig(input.provider.id, defaultModel);

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
    input.llmProvider ??
    (input.provider instanceof LlmProviderPortBridge ? input.provider.getLlmProviderPort() : undefined);

  if (llmProvider && typeof input.provider.embed === 'function') {
    const memoryVectorSize = Number(process.env['AGENTIC_ENGINE_MEMORY_VECTOR_SIZE'] ?? '1536');
    const memoryTenant = Number(process.env['AGENTIC_ENGINE_MEMORY_TENANT_ID'] ?? '1');
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
      url: process.env['AGENTIC_ENGINE_QDRANT_URL'] ?? 'http://localhost:6333',
      apiKey: process.env['AGENTIC_ENGINE_QDRANT_API_KEY'],
      vectorSize: Number(process.env['AGENTIC_ENGINE_MEMORY_VECTOR_SIZE'] ?? '1536'),
      searchTenant: Number(process.env['AGENTIC_ENGINE_MEMORY_TENANT_ID'] ?? '1'),
    });

    if (input.memorySystem instanceof RedisProjectedMemorySystem) {
      const mem = input.memorySystem;
      const projectionCtx = {
        ...DEFAULT_ADAPTER_CALL_CONTEXT,
        tenant: Number(process.env['AGENTIC_ENGINE_MEMORY_TENANT_ID'] ?? '1'),
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
      phase: 'init',
      type: 'progress',
      payload: {
        status: 'projection.available',
        providerId: input.provider.id,
        model: defaultEmbeddingModel,
        vectorIndexKind: 'qdrant',
      },
    });
  } else {
    initWarnings.push('projection.disabled');
    input.observability.emit({
      timestamp: Date.now(),
      correlation: ENGINE_INIT_CORRELATION,
      phase: 'init',
      type: 'warning',
      payload: {
        status: 'projection.disabled',
        reason: 'provider does not implement embed()',
      },
    });
  }

  const semanticRetrievalFacade = embeddingRuntime
    ? new DefaultSemanticRetrievalFacade({
        policy: new DefaultRetrievalPolicyRegistry(),
        embedding: embeddingRuntime,
      })
    : hostResult.engineDependencies.semanticRetrievalFacade;

  const multimodalResolver = input.imageAssetReader
    ? new LocalFileMultimodalResolver(input.imageAssetReader)
    : undefined;

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
      ...createDefaultToolCandidateStrategies().filter(
        (strategy) => strategy.name === 'intent-turn-policy',
      ),
      new DataChartTurnPolicyToolStrategy(),
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
