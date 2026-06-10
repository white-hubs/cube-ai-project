import { Injectable } from '@dangao/bun-server';
import { RuntimeRefsSchema } from '@cube-ai/contracts';
import type { LlmProviderPort, RuntimeRefs } from '@cube-ai/contracts';
import type { ImageAttachment, MessageContentV1 } from '@cube-ai/contracts';
import {
  Engine,
  adapterCallContextFromExecution,
  type AdapterCallContext,
  type EngineConfig,
  type ExecutionContext,
  type InputEnvelope,
  type ObservabilityEmitter,
  type ProviderAdapter,
  type SessionScope,
  type SkillDescriptor,
  type StreamChunk,
  type StreamChunkPayload,
  type TaskExecutor,
  type MemorySystem,
} from '@tachu/core';
import type { DescriptorRegistryService } from '../descriptor/descriptor-registry.service';
import type { SkillRegistryService } from '../descriptor/skill-registry.service';
import type { ToolHandlerCtx } from '../tools/tool-context';
import type { ToolService } from '../tools/tool.service';
import { mapContractToolToTachu } from './contract-tool-to-tachu';
import { computeTachuToolMirrorNamesForPrompt } from './engine-tool-mirror';
import { findExplicitSkillMentions } from './explicit-skill-mention';
import {
  applyHostTurnPolicyPreseed,
  TURN_POLICY_INTENT_ROUTING_APPENDIX,
} from './host-turn-policy';

import { appendSkillDiscoveryHint } from '../skill-activation/skill-activation-bridge';
import { findExplicitToolMentions } from './explicit-tool-mention';
import {
  KeywordToolStrategy,
  SemanticToolStrategy,
  type IntentRoutingBlock,
} from '../tool-activation';
import { assembleTachuRuntime, buildDefaultEngineConfig } from './assemble-tachu-runtime';
import type { TurnContextHolder } from './turn-context-holder';
import { resolveNonEmptyModel } from './tachu.tokens';
import type { MemoryProjectionRelayService } from '../../infra/memory-projection/memory-projection-relay.service';
import { LocalFileService } from '../files/local-file.service';
import {
  snapshotSkillsToDescriptors,
  type SnapshotSkillEntry,
} from '../session/snapshot-skill-hydration';

const RUNTIME_SKILL_REFS_TOOL_NAME = 'runtime.skill.refs';
const RUNTIME_KNOWLEDGE_QUERY_TOOL_NAME = 'platform.knowledge.query';

type RuntimeKnowledgeRef = NonNullable<RuntimeRefs['knowledgeBases']>[number];
type RuntimeSkillRef = NonNullable<RuntimeRefs['userSkills']>[number];

interface KnowledgeHitView {
  docId?: string;
  kbId?: string;
  title?: string;
  snippet: string;
  score?: number;
  link?: string;
}

function appendRuntimeKnowledgeRefsHint(
  systemInstruction: string,
  runtimeRefs: RuntimeRefs | undefined,
): string {
  const refs = runtimeRefs?.knowledgeBases ?? [];
  if (refs.length === 0) return systemInstruction;

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const ref of refs) {
    const kbId = ref.kbId.trim();
    if (!kbId || seen.has(kbId)) continue;
    seen.add(kbId);
    const label = ref.displayName?.trim();
    lines.push(`- ${label && label !== kbId ? `${label} ` : ''}(kbId: ${kbId})`);
  }
  if (lines.length === 0) return systemInstruction;

  const hint = [
    '## Runtime Knowledge References',
    'The user attached these knowledge bases for this turn. Use `platform.knowledge.query` when external knowledge is needed. The tool is restricted to this list; do not request kbIds outside it.',
    ...lines,
  ].join('\n');
  return [systemInstruction.trim(), hint].filter((part) => part.length > 0).join('\n\n');
}

function appendRuntimeSkillRefsHint(
  systemInstruction: string,
  runtimeRefs: RuntimeRefs | undefined,
): string {
  const refs = runtimeRefs?.userSkills ?? [];
  if (refs.length === 0) return systemInstruction;

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const ref of refs) {
    const skillId = ref.skillId.trim();
    if (!skillId || seen.has(skillId)) continue;
    seen.add(skillId);
    const label = ref.displayName?.trim();
    lines.push(`- ${label && label !== skillId ? `${label} ` : ''}(skillId: ${skillId})`);
  }
  if (lines.length === 0) return systemInstruction;

  const hint = [
    '## Runtime Skill References',
    'The user explicitly attached these skills for this turn. Treat them as pinned current-turn skills when their instructions are available.',
    ...lines,
  ].join('\n');
  return [systemInstruction.trim(), hint].filter((part) => part.length > 0).join('\n\n');
}

function uniqueRuntimeKnowledgeRefs(runtimeRefs: RuntimeRefs | undefined): RuntimeKnowledgeRef[] {
  const out: RuntimeKnowledgeRef[] = [];
  const seen = new Set<string>();
  for (const ref of runtimeRefs?.knowledgeBases ?? []) {
    const kbId = ref.kbId.trim();
    if (!kbId || seen.has(kbId)) continue;
    seen.add(kbId);
    out.push({ kbId, ...(ref.displayName !== undefined ? { displayName: ref.displayName } : {}) });
  }
  return out;
}

function uniqueRuntimeSkillRefs(runtimeRefs: RuntimeRefs | undefined): RuntimeSkillRef[] {
  const out: RuntimeSkillRef[] = [];
  const seen = new Set<string>();
  for (const ref of runtimeRefs?.userSkills ?? []) {
    const skillId = ref.skillId.trim();
    if (!skillId || seen.has(skillId)) continue;
    seen.add(skillId);
    out.push({ skillId, ...(ref.displayName !== undefined ? { displayName: ref.displayName } : {}) });
  }
  return out;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * Intent 分类只需用工具名 + 一句话用途做 include/exclude 路由判断，不需要完整的
 * 工具说明（MCP 工具的中文描述往往很长）。压成首行 + 截断可显著降低 intent
 * promptTokens 与模型在 intent 上的思考/输出量。
 */
const INTENT_TOOL_DESCRIPTION_MAX_CHARS = 160;

function summarizeToolDescriptionForIntent(description: string): string {
  const firstLine = description.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return truncateText(firstLine, INTENT_TOOL_DESCRIPTION_MAX_CHARS);
}

function hasImageInput(content: MessageContentV1 | undefined): boolean {
  return (content?.blocks ?? []).some((block) => block.type === 'image_ref');
}

function readOptionalStringField(rec: Record<string, unknown>, key: string): string | undefined {
  const value = rec[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readKnowledgeHits(output: unknown): KnowledgeHitView[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const hits = (output as { hits?: unknown }).hits;
  if (!Array.isArray(hits)) return [];

  const out: KnowledgeHitView[] = [];
  for (const item of hits) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const snippet =
      readOptionalStringField(rec, 'snippet') ??
      readOptionalStringField(rec, 'content') ??
      readOptionalStringField(rec, 'text');
    if (!snippet) continue;
    const score = rec['score'];
    out.push({
      snippet,
      ...(readOptionalStringField(rec, 'docId') !== undefined
        ? { docId: readOptionalStringField(rec, 'docId') }
        : {}),
      ...(readOptionalStringField(rec, 'kbId') !== undefined
        ? { kbId: readOptionalStringField(rec, 'kbId') }
        : {}),
      ...(readOptionalStringField(rec, 'title') !== undefined
        ? { title: readOptionalStringField(rec, 'title') }
        : {}),
      ...(typeof score === 'number' && Number.isFinite(score) ? { score } : {}),
      ...(readOptionalStringField(rec, 'link') !== undefined
        ? { link: readOptionalStringField(rec, 'link') }
        : {}),
    });
  }
  return out;
}

function formatRetrievedKnowledgeContext(
  output: unknown,
  refs: readonly RuntimeKnowledgeRef[],
): string {
  const hitLines = readKnowledgeHits(output)
    .slice(0, 5)
    .map((hit, index) => {
      const title = hit.title ?? hit.docId ?? `Knowledge hit ${index + 1}`;
      const meta = [
        hit.kbId ? `kbId: ${hit.kbId}` : undefined,
        typeof hit.score === 'number' ? `score: ${hit.score.toFixed(3)}` : undefined,
        hit.link ? `link: ${hit.link}` : undefined,
      ].filter((part): part is string => part !== undefined);
      return [
        `[${index + 1}] ${title}${meta.length > 0 ? ` (${meta.join(', ')})` : ''}`,
        truncateText(hit.snippet.trim(), 1200),
      ].join('\n');
    });
  const refLines = refs.map((ref) => {
    const label = ref.displayName?.trim();
    return `- ${label && label !== ref.kbId ? `${label} ` : ''}(kbId: ${ref.kbId})`;
  });
  return [
    '## Retrieved Knowledge Context',
    'The engine has already queried the user-attached knowledge bases for this turn. Use these snippets as current business context. If the snippets do not answer the question, say that the attached knowledge base did not provide a matching answer.',
    'Attached knowledge bases:',
    ...refLines,
    '',
    hitLines.length > 0 ? hitLines.join('\n\n') : 'No matching knowledge snippets were returned.',
  ].join('\n');
}

function errorToToolError(error: unknown): { code: string; message: string; retryable: boolean } {
  const rec = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const code = typeof rec['code'] === 'string' ? rec['code'] : 'TOOL_EXECUTION_FAILED';
  const retryable = typeof rec['retryable'] === 'boolean' ? rec['retryable'] : false;
  const message = error instanceof Error ? error.message : String(error);
  return { code, message, retryable };
}

/**
 * EngineFactory —— `cube-agentic-engine` 一侧对 `@tachu/core.Engine` 的会话适配层。
 *
 * 职责（最小化、不僭越 tachu 的 9 阶段流水线）：
 *  1. 持有 tachu.Engine 单例。Engine 的默认配置（registry、memory、safety、capability
 *     mapping）由本类内部用合理的运行时默认装配；per-session 的差异通过 SessionScope
 *     在每次 runStream 调用时叠加，不污染单例状态。
 *  2. 把 cube-agentic-engine 的会话数据（snapshot、turn modelCode、principal）翻译成
 *     tachu 的 InputEnvelope / ExecutionContext / SessionScope。
 *  3. 把 tachu 的 StreamChunk 流原样上抛给调用方（TurnService），由调用方负责映射 SSE。
 *
 * 不在本类的职责（明确边界）：
 *  - 不负责 SSE 事件构造 → TurnService 持有 mapper；
 *  - 不负责 Outbox / 持久化 → TurnService 与各 Repository；
 *  - 不绕过 9 阶段流水线（intent → planning → validation → output 全部由 tachu 保证）。
 *
 * **工具可见性（与 @tachu/core Phase 5）**：`runPlanningPhase` 只认 `registry.list("tool")`，
 * 不会读取 `SessionScope.additionalTools`。因此必须把 Descriptor BC 中已注册的
 * Tool 镜像进本 Engine 专用的 `DescriptorRegistry`，否则永远走 direct-answer 兜底。
 */

export interface AgentSnapshotShape {
  agent?: {
    content?: {
      prompt?: string;
      modelConfig?: { model?: string } | undefined;
      toolRefs?: readonly string[];
      skillRefs?: readonly string[];
      intentRouting?: {
        enabled?: boolean;
        routeConfirm?: number;
        routeFallbackFloor?: number;
        fallbackTopK?: number;
        flows?: ReadonlyArray<{
          toolName: string;
          priority: number;
          keywords: readonly string[];
        }>;
      };
    };
  };
  rules?: ReadonlyArray<unknown>;
  /** Frozen inline skill rows (ADR-0023); drives SessionScope.additionalSkills. */
  skills?: ReadonlyArray<SnapshotSkillEntry | unknown>;
  tools?: ReadonlyArray<unknown>;
}

export interface TurnRunStreamInput {
  sessionId: string;
  turnId: string;
  tenant: number;
  userId?: string;
  scopes?: readonly string[];
  /** 用户本轮输入。 */
  prompt: string;
  content?: MessageContentV1;
  attachments?: ImageAttachment[];
  /** User-selected references scoped to this turn only. */
  runtimeRefs?: RuntimeRefs;
  /** turn body 里前端传的 modelCode，优先级最高（高于 snapshot 与 env）。 */
  turnModelCode?: string;
  /** 建会话时冻结的 agent snapshot；缺失时退化到全局默认 prompt + 默认 model。 */
  agentSnapshot?: AgentSnapshotShape;
  /** Run-scoped public id factory for tachu phase / sub-step / usage attribution ids. */
  nextStreamId?: () => string;
  /**
   * Per-turn embedding model override (reserved for frontend).
   * Falls back to `AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL`.
   */
  skillEmbeddingModelCode?: string;
}

@Injectable()
export class EngineFactory {
  private readonly engine: Engine;
  private readonly providerId: string;
  private readonly defaultModel: string;
  private readonly descriptorRegistry?: DescriptorRegistryService;
  private readonly skillRegistry?: SkillRegistryService;
  /** 与 DescriptorRegistryService 内容对齐的签名，变更时才重刷 Tachu 侧 tool 表。 */
  private toolsMirrorSig = '';
  /** 与 SkillRegistryService 内容对齐的签名，变更时才重刷 Tachu 侧 skill 表。 */
  private skillsMirrorSig = '';

  constructor(
    private readonly provider: ProviderAdapter,
    private readonly observability: ObservabilityEmitter | undefined,
    private readonly memorySystem: MemorySystem,
    private readonly turnContext: TurnContextHolder,
    descriptorRegistry?: DescriptorRegistryService,
    private readonly toolService?: ToolService,
    skillRegistry?: SkillRegistryService,
    private readonly localFiles?: LocalFileService,
    private readonly projectionRelay?: MemoryProjectionRelayService,
    private readonly llmProvider?: LlmProviderPort,
  ) {
    this.descriptorRegistry = descriptorRegistry;
    this.skillRegistry = skillRegistry;
    this.providerId = provider.id;
    this.defaultModel = resolveNonEmptyModel(process.env['AGENTIC_ENGINE_MODEL'], 'gpt-4o-mini');

    const assembled = assembleTachuRuntime({
      provider,
      observability: observability ?? {
        emit: () => {},
        on: () => () => {},
        off: () => {},
        setMasker: () => {},
      },
      memorySystem,
      turnContext,
      taskExecutor: this.buildToolTaskExecutor(),
      ...(localFiles !== undefined ? { imageAssetReader: localFiles } : {}),
      ...(llmProvider !== undefined ? { llmProvider } : {}),
    });
    this.engine = assembled.engine;
    if (assembled.projectionWorker && this.projectionRelay) {
      this.projectionRelay.attachWorker(assembled.projectionWorker);
    }
  }

  private get tachuRegistry() {
    return this.engine.registry;
  }

  /**
   * 运行一轮对话。返回 tachu 的 StreamChunk 流；调用方（TurnService）负责按需
   * 映射成本仓的 SSE 事件，并从 `done` chunk 提取 `output.content` / `output.metadata.tokenUsage`。
   */
  async *runStream(arg: TurnRunStreamInput): AsyncIterable<StreamChunk> {
    await this.mirrorDescriptorToolsToTachuIfNeeded(arg);
    await this.mirrorDescriptorSkillsToTachuIfNeeded();
    const ctx: ExecutionContext = {
      correlation: {
        traceId: arg.turnId,
        requestId: arg.turnId,
        sessionId: arg.sessionId,
        turnId: arg.turnId,
      },
      principal: {
        tenant: arg.tenant,
        turnId: arg.turnId,
        ...(arg.runtimeRefs !== undefined ? { runtimeRefs: arg.runtimeRefs } : {}),
        ...(arg.userId !== undefined ? { userId: arg.userId } : {}),
      },
      subject: {
        tenant: String(arg.tenant),
        ...(arg.userId !== undefined ? { userId: arg.userId } : {}),
      },
      budget: {},
      scopes: arg.scopes && arg.scopes.length > 0 ? [...arg.scopes] : ['*'],
    };
    for (const chunk of this.buildRuntimeSkillRefChunks(arg, ctx)) {
      yield chunk;
    }
    const knowledgePrefetch = await this.prefetchRuntimeKnowledge(arg, ctx);
    for (const chunk of knowledgePrefetch.chunks) {
      yield chunk;
    }
    const input = await this.buildInputEnvelope(arg);
    const scope = this.buildSessionScope(arg, knowledgePrefetch.promptContext);
    this.turnContext.embeddingModelCode = arg.skillEmbeddingModelCode;
    this.turnContext.intentRoutingBlock =
      (arg.agentSnapshot?.agent?.content?.intentRouting as IntentRoutingBlock | undefined) ??
      null;
    this.turnContext.callContext = adapterCallContextFromExecution(ctx);
    try {
      yield* this.engine.runStream(input, ctx, scope);
    } finally {
      this.turnContext.callContext = undefined;
      this.turnContext.embeddingModelCode = undefined;
      this.turnContext.intentRoutingBlock = undefined;
    }
  }

  async resolveEffectiveRoute(arg: Pick<TurnRunStreamInput, 'prompt' | 'content' | 'turnModelCode' | 'agentSnapshot'>): Promise<{
    requestedModelCode?: string;
    effectiveModelCode: string;
    effectiveProviderCode: string;
    reason: 'DIRECT' | 'IMAGE_CAPABILITY_REROUTE' | 'FALLBACK';
  }> {
    const requestedModelCode =
      arg.turnModelCode ??
      arg.agentSnapshot?.agent?.content?.modelConfig?.model ??
      this.defaultModel;
    if (!hasImageInput(arg.content)) {
      return {
        requestedModelCode: arg.turnModelCode,
        effectiveModelCode: requestedModelCode,
        effectiveProviderCode: this.providerId,
        reason: 'DIRECT',
      };
    }
    const models = await this.provider.listAvailableModels();
    const requested = models.find((model) => model.modelName === requestedModelCode);
    if (requested?.capabilities.supportedModalities.includes('image')) {
      return {
        requestedModelCode: arg.turnModelCode,
        effectiveModelCode: requestedModelCode,
        effectiveProviderCode: this.providerId,
        reason: 'DIRECT',
      };
    }
    const imageCapable = models.find((model) => model.capabilities.supportedModalities.includes('image'));
    if (imageCapable) {
      return {
        requestedModelCode: arg.turnModelCode,
        effectiveModelCode: imageCapable.modelName,
        effectiveProviderCode: this.providerId,
        reason: 'IMAGE_CAPABILITY_REROUTE',
      };
    }
    return {
      requestedModelCode: arg.turnModelCode,
      effectiveModelCode: requestedModelCode,
      effectiveProviderCode: this.providerId,
      reason: 'FALLBACK',
    };
  }

  private buildRuntimeSkillRefChunks(
    arg: TurnRunStreamInput,
    context: ExecutionContext,
  ): StreamChunk[] {
    const refs = uniqueRuntimeSkillRefs(arg.runtimeRefs);
    if (refs.length === 0) return [];

    const callId = arg.nextStreamId?.() ?? `runtime-skill-refs:${arg.turnId}`;
    const output = {
      skills: refs.map((ref) => ({
        skillId: ref.skillId,
        ...(ref.displayName !== undefined ? { displayName: ref.displayName } : {}),
      })),
    };
    const args = {
      skillIds: refs.map((ref) => ref.skillId),
    };
    return [
      this.withStreamEnvelope(
        {
          type: 'tool-call-start',
          callId,
          tool: RUNTIME_SKILL_REFS_TOOL_NAME,
          argumentsPreview: JSON.stringify(args),
        },
        context,
      ),
      this.withStreamEnvelope(
        {
          type: 'tool-call-end',
          callId,
          tool: RUNTIME_SKILL_REFS_TOOL_NAME,
          success: true,
          durationMs: 0,
          output,
        },
        context,
      ),
    ];
  }

  private async buildInputEnvelope(arg: TurnRunStreamInput): Promise<InputEnvelope> {
    const registeredToolNames = this.tachuRegistry.list('tool').map((t) => t.name);
    if (!hasImageInput(arg.content)) {
      return applyHostTurnPolicyPreseed(
        {
          content: arg.prompt,
          metadata: { modality: 'text', size: arg.prompt.length },
        },
        arg.prompt,
        registeredToolNames,
      );
    }
    const attachmentsById = new Map((arg.attachments ?? []).map((attachment) => [attachment.attachmentId, attachment]));
    const contentParts: Array<
      | { type: 'text'; text: string }
      | { type: 'file'; file: { mimeType: string; uri: string } }
    > = [];
    let size = 0;
    for (const block of arg.content?.blocks ?? []) {
      if (block.type === 'text') {
        const text = block.text.trim();
        if (!text) continue;
        size += text.length;
        contentParts.push({ type: 'text', text });
        continue;
      }
      const attachment = attachmentsById.get(block.attachmentId);
      if (!attachment) continue;
      size += attachment.size ?? 0;
      contentParts.push({
        type: 'file',
        file: {
          mimeType: attachment.mimeType,
          uri: attachment.fileId,
        },
      });
    }
    return applyHostTurnPolicyPreseed(
      {
        content: contentParts,
        metadata: {
          modality: 'image',
          size,
        },
      },
      arg.prompt,
      registeredToolNames,
    );
  }

  private async prefetchRuntimeKnowledge(
    arg: TurnRunStreamInput,
    context: ExecutionContext,
  ): Promise<{ chunks: StreamChunk[]; promptContext?: string }> {
    const refs = uniqueRuntimeKnowledgeRefs(arg.runtimeRefs);
    const query = truncateText(arg.prompt.trim(), 512);
    if (refs.length === 0 || !this.toolService || query.length < 2) {
      return { chunks: [] };
    }

    const callId = arg.nextStreamId?.() ?? `runtime-knowledge-query:${arg.turnId}`;
    const startedAt = Date.now();
    const input = { query, topK: 5 };
    const chunks: StreamChunk[] = [
      this.withStreamEnvelope(
        {
          type: 'tool-call-start',
          callId,
          tool: RUNTIME_KNOWLEDGE_QUERY_TOOL_NAME,
          argumentsPreview: JSON.stringify({
            ...input,
            kbIds: refs.map((ref) => ref.kbId),
          }),
        },
        context,
      ),
    ];

    try {
      const controller = new AbortController();
      const output = await this.toolService.invoke(
        RUNTIME_KNOWLEDGE_QUERY_TOOL_NAME,
        input,
        this.toToolHandlerCtx(context, controller.signal),
        { toolCallId: callId },
      );
      chunks.push(
        this.withStreamEnvelope(
          {
            type: 'tool-call-end',
            callId,
            tool: RUNTIME_KNOWLEDGE_QUERY_TOOL_NAME,
            success: true,
            durationMs: Date.now() - startedAt,
            output,
          },
          context,
        ),
      );
      return { chunks, promptContext: formatRetrievedKnowledgeContext(output, refs) };
    } catch (error) {
      chunks.push(
        this.withStreamEnvelope(
          {
            type: 'tool-call-end',
            callId,
            tool: RUNTIME_KNOWLEDGE_QUERY_TOOL_NAME,
            success: false,
            durationMs: Date.now() - startedAt,
            error: errorToToolError(error),
          },
          context,
        ),
      );
      return { chunks };
    }
  }

  private withStreamEnvelope(
    chunk: StreamChunkPayload,
    context: ExecutionContext,
  ): StreamChunk {
    return {
      ...chunk,
      correlation: context.correlation,
      ...(context.subject !== undefined ? { subject: context.subject } : {}),
    };
  }

  /**
   * 取消指定 sessionId 当前活跃 run。沿用 tachu.Engine.cancel 的语义，不在适配层
   * 再造一套 AbortController（旧实现的方式）。
   */
  cancel(sessionId: string, reason?: string): void {
    this.engine.cancel(sessionId, reason);
  }

  /**
   * 销毁底层 Engine，释放挂起的 run。用于测试 / 进程优雅关闭。
   */
  async dispose(): Promise<void> {
    await this.engine.dispose();
  }

  /**
   * 将 Descriptor BC 中的 Tool 同步到 Tachu 专用 Registry（见类注释）。
   *
   * - 若 `agentSnapshot.agent.content.toolRefs` 非空：只镜像其中在注册表里可解析的名称，
   *   并并集 `currentDate`（若注册表存在该内置工具）。
   * - 若 `toolRefs` 缺失或为空：镜像当前注册表中的全部 Tool（兼容占位 Agent / 测试）。
   */
  private async mirrorDescriptorToolsToTachuIfNeeded(arg: TurnRunStreamInput): Promise<void> {
    if (!this.descriptorRegistry) return;
    const namesList = computeTachuToolMirrorNamesForPrompt(
      arg.agentSnapshot?.agent?.content?.toolRefs,
      this.descriptorRegistry,
      arg.prompt,
      { hasImageInput: hasImageInput(arg.content) },
    );
    const parts: string[] = [];
    for (const name of namesList) {
      const d = this.descriptorRegistry.resolve(name);
      if (d) parts.push(`${d.name}@${d.version ?? '1.0.0'}`);
    }
    const sig = parts.join('|');
    if (sig === this.toolsMirrorSig) return;

    for (const name of this.tachuRegistry.list('tool').map((t) => t.name)) {
      await this.tachuRegistry.unregister('tool', name).catch(() => {});
    }
    for (const name of namesList) {
      const d = this.descriptorRegistry.resolve(name);
      if (!d) continue;
      await this.tachuRegistry.register(mapContractToolToTachu(d));
    }
    this.toolsMirrorSig = sig;
  }

  private async mirrorDescriptorSkillsToTachuIfNeeded(): Promise<void> {
    if (!this.skillRegistry) return;
    const sig = this.skillRegistry.signature();
    if (sig === this.skillsMirrorSig) return;

    for (const name of this.tachuRegistry.list('skill').map((s) => s.name)) {
      await this.tachuRegistry.unregister('skill', name).catch(() => {});
    }
    for (const skill of this.skillRegistry.list()) {
      await this.tachuRegistry.register(skill);
    }
    this.skillsMirrorSig = sig;
  }

  /**
   * 构造 SessionScope —— 本类的核心翻译逻辑。
   *
   * - systemInstruction：直接采用 snapshot `prompt`；UTC 时钟锚点已在 session 创建时
   *   由 `SessionService.buildSnapshots` 一次性冻结进 `prompt` 末尾，本层不再每轮重复
   *   注入。仅空白时不设置（由 tachu 走自身默认 system prompt）。
   * - modelOverride.all：优先级 turn body > snapshot.modelConfig > env > 默认；
   *   只要任一档命中，都用 `provider.id` + 该 model 写入 `all`，影响本轮全部 capability。
   * - additionalSkills：快照内联 skill 名称列表（ADR-0007：作为 snapshot-refs 输入，T0 pinned）。
   * - keyword 候选由 tachu `SkillActivator` + `KeywordCandidateStrategy` 处理。
   */
  private buildSessionScope(
    arg: TurnRunStreamInput,
    retrievedKnowledgeContext?: string,
  ): SessionScope {
    const rawPrompt = arg.agentSnapshot?.agent?.content?.prompt;
    const model =
      resolveNonEmptyModel(arg.turnModelCode) ||
      resolveNonEmptyModel(arg.agentSnapshot?.agent?.content?.modelConfig?.model) ||
      this.defaultModel;

    const intentRouting = arg.agentSnapshot?.agent?.content?.intentRouting as
      | IntentRoutingBlock
      | undefined;

    const scope: SessionScope = {
      modelOverride: { all: { provider: this.providerId, model } },
      additionalRules: [],
      additionalSkills: this.resolvePinnedSkillsForTurn(arg),
      additionalTools: [],
      ...(arg.nextStreamId !== undefined ? { idFactory: arg.nextStreamId } : {}),
      ...(intentRouting?.enabled === false ? { toolRoutingDisabled: true } : {}),
    };

    const basePrompt =
      typeof rawPrompt === 'string' && rawPrompt.trim().length > 0 ? rawPrompt.trim() : '';
    const withKnowledgeRefs = appendRuntimeKnowledgeRefsHint(basePrompt, arg.runtimeRefs);
    const withRetrievedKnowledge = [withKnowledgeRefs.trim(), retrievedKnowledgeContext?.trim()]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join('\n\n');
    const withRuntimeSkillRefs = appendRuntimeSkillRefsHint(withRetrievedKnowledge, arg.runtimeRefs);
    const withHint = appendSkillDiscoveryHint(withRuntimeSkillRefs);
    if (withHint.trim().length > 0) {
      scope.systemInstruction = withHint;
    }

    // Populate intentAgentContext so the intent LLM can make context-aware complexity
    // decisions without relying on hardcoded domain regex patterns.
    // tachuRegistry is already up-to-date: mirrorDescriptorToolsToTachuIfNeeded() runs
    // before buildSessionScope() in runStream().
    const registeredTools = this.tachuRegistry.list('tool') as Array<{
      name: string;
      description?: string;
    }>;
    const registeredSkills = this.tachuRegistry.list('skill') as Array<{
      name: string;
      description?: string;
      tags?: string[];
    }>;
    const intentTools = registeredTools
      .filter((t) => t.description)
      .map((t) => ({
        name: t.name,
        description: summarizeToolDescriptionForIntent(t.description as string),
      }));
    const intentSkills = registeredSkills
      .filter((s) => s.description)
      .map((s) => ({
        name: s.name,
        description: s.description as string,
        ...(s.tags && s.tags.length > 0 ? { tags: [...s.tags] } : {}),
      }));
    const intentInstructionParts = [
      basePrompt,
      TURN_POLICY_INTENT_ROUTING_APPENDIX,
    ].filter((part) => part.length > 0);
    const intentSystemInstruction =
      intentInstructionParts.length > 0 ? intentInstructionParts.join('\n\n') : undefined;
    if (intentSystemInstruction || intentTools.length > 0 || intentSkills.length > 0) {
      scope.intentAgentContext = {
        ...(intentSystemInstruction ? { systemInstruction: intentSystemInstruction } : {}),
        ...(intentTools.length > 0 ? { tools: intentTools } : {}),
        ...(intentSkills.length > 0 ? { skills: intentSkills } : {}),
      };
    }

    const registeredToolNames = registeredTools.map((tool) => tool.name);
    const registeredSkillNames = registeredSkills.map((skill) => skill.name);
    const explicitToolNames = new Set(
      findExplicitToolMentions(arg.prompt, registeredToolNames),
    );
    const explicitSkillNames = new Set(
      findExplicitSkillMentions(arg.prompt, registeredSkillNames),
    );
    for (const ref of uniqueRuntimeSkillRefs(arg.runtimeRefs)) {
      const resolved = this.skillRegistry?.resolve(ref.skillId);
      if (resolved?.name) explicitSkillNames.add(resolved.name);
    }
    if (explicitToolNames.size > 0) {
      scope.explicitToolNames = [...explicitToolNames];
    }
    if (explicitSkillNames.size > 0) {
      scope.explicitSkillNames = [...explicitSkillNames];
    }

    return scope;
  }

  /**
   * Snapshot skills[] first; legacy sessions with only skillRefs fall back to live registry.
   */
  private resolvePinnedSkillsForTurn(arg: TurnRunStreamInput): SkillDescriptor[] {
    const out: SkillDescriptor[] = [];
    const seen = new Set<string>();
    const push = (skill: SkillDescriptor | undefined): void => {
      if (!skill || seen.has(skill.name)) return;
      seen.add(skill.name);
      out.push(skill);
    };

    if (this.skillRegistry) {
      for (const ref of uniqueRuntimeSkillRefs(arg.runtimeRefs)) {
        push(this.skillRegistry.resolve(ref.skillId));
      }
    }

    const fromSnapshot = snapshotSkillsToDescriptors(arg.agentSnapshot?.skills);
    if (fromSnapshot.length > 0) {
      for (const skill of fromSnapshot) push(skill);
      return out;
    }

    const refs = arg.agentSnapshot?.agent?.content?.skillRefs;
    if (!refs || refs.length === 0 || !this.skillRegistry) {
      return out;
    }
    for (const name of refs) {
      push(this.skillRegistry.resolve(name));
    }
    return out;
  }

  /**
   * Tachu TaskExecutor adapter：tool-use 子流程选中 Tool 后，由这里回调到业务
   * ToolService，复用 DescriptorRegistry / AuthZ / Safety / Audit / MCP handler。
   */
  private buildToolTaskExecutor(): TaskExecutor {
    return async (task, context, signal) => {
      if (task.type !== 'tool' || !this.toolService) {
        return {
          ok: true,
          output: {
            ref: task.ref,
            input: task.input,
            output: `[executed:${task.type}] ${task.ref}`,
          },
        };
      }

      const handlerCtx = this.toToolHandlerCtx(context, signal);
      const toolCallId = task.id.startsWith('tool-use:')
        ? task.id.slice('tool-use:'.length)
        : task.id;

      const output = await this.toolService.invoke(task.ref, task.input, handlerCtx, { toolCallId });
      return { ok: true, output };
    };
  }

  private toToolHandlerCtx(context: ExecutionContext, signal: AbortSignal): ToolHandlerCtx {
    const tenant = this.readTenant(context.principal['tenant']);
    const userId = this.readOptionalString(context.principal['userId']);
    const runtimeRefs = this.readRuntimeRefs(context.principal['runtimeRefs']);
    const turnId =
      this.readOptionalString(context.principal['turnId']) ??
      context.correlation.turnId;

    return {
      traceId: context.correlation.traceId,
      signal,
      auth: {
        tenant,
        ...(userId
          ? { user: { userId, scopes: [...(context.scopes ?? [])] } }
          : {}),
      },
      session: {
        id: context.correlation.sessionId,
        turnId,
      },
      ...(runtimeRefs !== undefined ? { turn: { runtimeRefs } } : {}),
    };
  }

  private readTenant(raw: unknown): number {
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
    if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) {
      return Math.trunc(Number(raw.trim()));
    }
    throw new Error('Tachu Tool TaskExecutor requires numeric tenant in ExecutionContext.principal');
  }

  private readOptionalString(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const s = raw.trim();
    return s.length > 0 ? s : undefined;
  }

  private readRuntimeRefs(raw: unknown): RuntimeRefs | undefined {
    const parsed = RuntimeRefsSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  /**
   * 默认 EngineConfig：对单 provider 的简化装配。
   *
   * - capabilityMapping 所有 tag 都路由到唯一 provider；per-turn 仍可被
   *   `SessionScope.modelOverride` 覆盖。
   * - memory.archivePath 留空，使用 tachu 默认（不落盘归档）。
   * - safety.workspaceRoot 取当前进程 cwd（与 tachu 测试一致）。
   * - intent.disableSimpleMarkers=true：禁用 strong-simple-short fast-path，
   *   避免"列出流程"、"查询知识库"等短指令被启发式截断到 direct-answer，
   *   确保所有输入都经过 intent LLM 分类后再决定是否走工具调用路径。
   */
  buildEngineConfig(): EngineConfig {
    return buildDefaultEngineConfig(this.providerId, this.defaultModel);
  }
}
