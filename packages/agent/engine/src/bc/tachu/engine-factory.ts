import { Injectable } from "@dangao/bun-server";
import {
  Engine,
  adapterCallContextFromExecution,
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
} from "@tachu/core";

import { RuntimeRefsSchema, DEFAULT_USER_SESSION_SKILL_REFS } from "@cube-ai/contracts";
import type { GroundingPrefetchEntry, LlmProviderPort, RuntimeRefs } from "@cube-ai/contracts";
import type { ImageAttachment, MessageContentV1 } from "@cube-ai/contracts";

import { MemoryProjectionRelayService } from "../../infra/memory-projection/memory-projection-relay.service";
import { DescriptorRegistryService } from "../descriptor/descriptor-registry.service";
import { mergeTenantSkills } from "../descriptor/merge-tenant-registry";
import { buildShelfSkillDiscoveryProvider, type ShelfSkillLister } from "../descriptor/shelf-skill-discovery";
import { SkillRegistryService } from "../descriptor/skill-registry.service";
import type { TenantDescriptorResolver } from "../descriptor/tenant-descriptor-resolver";
import { LocalFileService } from "../files/local-file.service";
import { snapshotRulesToTachuDescriptors } from "../session/snapshot-rule-hydration";
import { snapshotSkillsToDescriptors, type SnapshotSkillEntry } from "../session/snapshot-skill-hydration";
import type { SkillRegistryResolveLike } from "../session/snapshot-skill-hydration";
import { appendSkillDiscoveryHint } from "../skill-activation/skill-discovery-hint";
import { type IntentRoutingBlock } from "../tool-activation";
import type { CallIdentity, ToolHandlerCtx } from "../tools/tool-context";
import { projectToolResultForModel } from "../tools/tool-result-visibility";
import { ToolService } from "../tools/tool.service";
import { assembleTachuRuntime, buildDefaultEngineConfig } from "./assemble-tachu-runtime";
import { mapContractToolToTachu } from "./contract-tool-to-tachu";
import { computeTachuToolMirrorNamesForPrompt } from "./engine-tool-mirror";
import { findExplicitRuleMentions } from "./explicit-rule-mention";
import { findExplicitSkillMentions } from "./explicit-skill-mention";
import { findExplicitToolMentions } from "./explicit-tool-mention";
import { applyHostGatingPolicyPreseed } from "./host-gating-policy";
import { emitHostEngineEvent } from "./host-observability";
import { resolveNonEmptyModel } from "./tachu.tokens";
import type { ToolProgressSinkEvent, TurnContextHolder } from "./turn-context-holder";

const RUNTIME_SKILL_REFS_TOOL_NAME = "runtime.skill.refs";
const RUNTIME_KNOWLEDGE_QUERY_TOOL_NAME = "platform.knowledge.query";
/** Session-default skills dropped from Active Skills when the user @-pins skills this turn. */
const DEFERRABLE_SESSION_SKILL_NAMES = new Set<string>(DEFAULT_USER_SESSION_SKILL_REFS);

type RuntimeKnowledgeRef = NonNullable<RuntimeRefs["knowledgeBases"]>[number];
type RuntimeSkillRef = NonNullable<RuntimeRefs["userSkills"]>[number];

interface KnowledgeHitView {
  docId?: string;
  kbId?: string;
  title?: string;
  snippet: string;
  score?: number;
  link?: string;
}

function appendRuntimeKnowledgeRefsHint(systemInstruction: string, runtimeRefs: RuntimeRefs | undefined): string {
  const refs = runtimeRefs?.knowledgeBases ?? [];
  if (refs.length === 0) return systemInstruction;

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const ref of refs) {
    const kbId = ref.kbId.trim();
    if (!kbId || seen.has(kbId)) continue;
    seen.add(kbId);
    const label = ref.displayName?.trim();
    lines.push(`- ${label && label !== kbId ? `${label} ` : ""}(kbId: ${kbId})`);
  }
  if (lines.length === 0) return systemInstruction;

  const hint = [
    "## Runtime Knowledge References",
    "The user attached these knowledge bases for this turn. Use `platform.knowledge.query` when external knowledge is needed. The tool is restricted to this list; do not request kbIds outside it.",
    ...lines,
  ].join("\n");
  return [systemInstruction.trim(), hint].filter((part) => part.length > 0).join("\n\n");
}

function appendRuntimeSkillRefsHint(systemInstruction: string, runtimeRefs: RuntimeRefs | undefined): string {
  const refs = runtimeRefs?.userSkills ?? [];
  if (refs.length === 0) return systemInstruction;

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const ref of refs) {
    const skillId = ref.skillId.trim();
    if (!skillId || seen.has(skillId)) continue;
    seen.add(skillId);
    const label = ref.displayName?.trim();
    lines.push(`- ${label && label !== skillId ? `${label} ` : ""}(skillId: ${skillId})`);
  }
  if (lines.length === 0) return systemInstruction;

  const hint = [
    "## Runtime Skill References",
    "The user explicitly @-attached these skills for this turn. Their full instructions appear under **User @-Pinned Skills** at the end of this system message and override agent role / default skills when they conflict.",
    ...lines,
  ].join("\n");
  return [systemInstruction.trim(), hint].filter((part) => part.length > 0).join("\n\n");
}

/** Inline @-pinned skill contracts at the end of systemInstruction (survives skill-budget trimming). */
function appendRuntimeSkillPriorityOverride(
  systemInstruction: string,
  runtimeRefs: RuntimeRefs | undefined,
  skillResolver: SkillRegistryResolveLike | undefined,
): string {
  if (!skillResolver) return systemInstruction;

  const sections: string[] = [];
  for (const ref of uniqueRuntimeSkillRefs(runtimeRefs)) {
    const skill = skillResolver.resolve(ref.skillId);
    const instructions = skill?.instructions?.trim();
    if (!skill || !instructions) continue;
    const title = ref.displayName?.trim() || skill.displayName?.trim() || skill.name;
    sections.push(`### ${title}\n${instructions}`);
  }
  if (sections.length === 0) return systemInstruction;

  const block = [
    "## User @-Pinned Skills (HIGHEST PRIORITY THIS TURN)",
    "The user explicitly @-attached these skills for this turn. When they conflict with agent role, default-reasoning, tool-loop drafts, honesty fallbacks, or other Active Skills, follow these instructions — including address, tone, and output constraints.",
    ...sections,
  ].join("\n\n");
  return [systemInstruction.trim(), block].filter((part) => part.length > 0).join("\n\n");
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
  const firstLine =
    description
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  return truncateText(firstLine, INTENT_TOOL_DESCRIPTION_MAX_CHARS);
}

function hasImageInput(content: MessageContentV1 | undefined): boolean {
  return (content?.blocks ?? []).some((block) => block.type === "image_ref");
}

function readOptionalStringField(rec: Record<string, unknown>, key: string): string | undefined {
  const value = rec[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readKnowledgeHits(output: unknown): KnowledgeHitView[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  const hits = (output as { hits?: unknown }).hits;
  if (!Array.isArray(hits)) return [];

  const out: KnowledgeHitView[] = [];
  for (const item of hits) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const snippet =
      readOptionalStringField(rec, "snippet") ?? readOptionalStringField(rec, "content") ?? readOptionalStringField(rec, "text");
    if (!snippet) continue;
    const score = rec["score"];
    out.push({
      snippet,
      ...(readOptionalStringField(rec, "docId") !== undefined ? { docId: readOptionalStringField(rec, "docId") } : {}),
      ...(readOptionalStringField(rec, "kbId") !== undefined ? { kbId: readOptionalStringField(rec, "kbId") } : {}),
      ...(readOptionalStringField(rec, "title") !== undefined ? { title: readOptionalStringField(rec, "title") } : {}),
      ...(typeof score === "number" && Number.isFinite(score) ? { score } : {}),
      ...(readOptionalStringField(rec, "link") !== undefined ? { link: readOptionalStringField(rec, "link") } : {}),
    });
  }
  return out;
}

function readKnowledgeTruncated(output: unknown): boolean {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return false;
  }
  return (output as { truncated?: unknown }).truncated === true;
}

function summarizeKnowledgeHitsForObservability(
  hits: readonly KnowledgeHitView[],
  limit = 3,
): Array<{ docId?: string; kbId?: string; score?: number; title?: string }> {
  return hits.slice(0, limit).map((hit) => ({
    ...(hit.docId !== undefined ? { docId: hit.docId } : {}),
    ...(hit.kbId !== undefined ? { kbId: hit.kbId } : {}),
    ...(hit.title !== undefined ? { title: hit.title } : {}),
    ...(typeof hit.score === "number" ? { score: hit.score } : {}),
  }));
}

function formatRetrievedKnowledgeContext(output: unknown, refs: readonly RuntimeKnowledgeRef[]): string {
  const hitLines = readKnowledgeHits(output)
    .slice(0, 5)
    .map((hit, index) => {
      const title = hit.title ?? hit.docId ?? `Knowledge hit ${index + 1}`;
      const meta = [
        hit.kbId ? `kbId: ${hit.kbId}` : undefined,
        typeof hit.score === "number" ? `score: ${hit.score.toFixed(3)}` : undefined,
        hit.link ? `link: ${hit.link}` : undefined,
      ].filter((part): part is string => part !== undefined);
      return [`[${index + 1}] ${title}${meta.length > 0 ? ` (${meta.join(", ")})` : ""}`, truncateText(hit.snippet.trim(), 1200)].join(
        "\n",
      );
    });
  const refLines = refs.map((ref) => {
    const label = ref.displayName?.trim();
    return `- ${label && label !== ref.kbId ? `${label} ` : ""}(kbId: ${ref.kbId})`;
  });
  return [
    "## Retrieved Knowledge Context",
    "The engine has already queried the user-attached knowledge bases for this turn. Use these snippets as current business context. If the snippets do not answer the question, say that the attached knowledge base did not provide a matching answer.",
    "Attached knowledge bases:",
    ...refLines,
    "",
    hitLines.length > 0 ? hitLines.join("\n\n") : "No matching knowledge snippets were returned.",
  ].join("\n");
}

function renderPrefetchOutput(tool: string, output: unknown): string {
  if (output == null) return "";
  // prefetch 与主链路共用同一安全投影器：禁止对原始 object 直接 JSON.stringify，
  // 先经 projectToolResultForModel 剥离 SQL/connection/raw rows/tool args 等敏感字段。
  const projected = projectToolResultForModel(tool, output);
  if (projected == null) return "";
  if (typeof projected === "string") return truncateText(projected.trim(), 4000);
  try {
    return truncateText(JSON.stringify(projected), 4000);
  } catch {
    return "";
  }
}

/** Format one grounding-prefetch tool output into an Agent Context block. */
function formatGroundingPrefetchContext(tool: string, output: unknown): string {
  const body = renderPrefetchOutput(tool, output);
  if (!body) return "";
  return [`## 预取接地事实（来自 ${tool}，本轮已代为查询，请据此选用真实标识符，勿臆造）`, body].join("\n");
}

/** Join multiple prefetch context blocks; undefined when nothing to inject. */
function mergePrefetchContext(...parts: Array<string | undefined>): string | undefined {
  const kept = parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return kept.length > 0 ? kept.join("\n\n") : undefined;
}

function errorToToolError(error: unknown): { code: string; message: string; retryable: boolean } {
  const rec = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof rec["code"] === "string" ? rec["code"] : "TOOL_EXECUTION_FAILED";
  const retryable = typeof rec["retryable"] === "boolean" ? rec["retryable"] : false;
  const message = error instanceof Error ? error.message : String(error);
  return { code, message, retryable };
}

class ToolProgressQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters = new Set<() => void>();

  push(item: T): void {
    this.items.push(item);
    const waiter = this.waiters.values().next().value;
    if (waiter) waiter();
  }

  shift(): T | undefined {
    return this.items.shift();
  }

  waitForItem(): { cancel: () => void; promise: Promise<void> } {
    if (this.items.length > 0) return { cancel: () => {}, promise: Promise.resolve() };
    let waiter: (() => void) | undefined;
    const promise = new Promise<void>((resolve) => {
      waiter = () => {
        if (waiter) this.waiters.delete(waiter);
        resolve();
      };
      this.waiters.add(waiter);
    });
    return {
      cancel: () => {
        if (waiter) this.waiters.delete(waiter);
      },
      promise,
    };
  }
}

function normalizeMcpProgress(progress: number | undefined, total: number | undefined): number | undefined {
  if (progress === undefined || !Number.isFinite(progress)) return undefined;
  if (total !== undefined && Number.isFinite(total) && total > 0) {
    const ratio = progress / total;
    return ratio >= 0 && ratio <= 1 ? ratio : undefined;
  }
  return progress;
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function toolProgressFallbackDisabled(): boolean {
  const raw = process.env["AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_ENABLED"]?.trim().toLowerCase();
  return raw === "0" || raw === "false" || raw === "off" || raw === "no";
}

function resolveToolProgressFallbackSchedule(): Array<{ delayMs: number; status: string; safeDisplayMessage: string }> {
  if (toolProgressFallbackDisabled()) return [];
  const initialMs = positiveIntEnv("AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_INITIAL_MS", 5_000);
  const extendedMs = positiveIntEnv("AGENTIC_ENGINE_TOOL_PROGRESS_FALLBACK_EXTENDED_MS", 15_000);
  const out = [
    {
      delayMs: initialMs,
      status: "tool.local.processing",
      safeDisplayMessage: "正在处理",
    },
  ];
  if (extendedMs > initialMs) {
    out.push({
      delayMs: extendedMs,
      status: "tool.local.querying",
      safeDisplayMessage: "正在查询并整理结果",
    });
  }
  return out;
}

/**
 * EngineFactory —— `cube-agentic-engine` 一侧对 `@tachu/core.Engine` 的会话适配层。
 *
 * 职责（最小化、不僭越 tachu 的深单 loop 主干）：
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
 *  - 不绕过深单 loop 主干（tachu rc.10：session → safety → tool-routing →
 *    execution → validation → output，路由 / 校验 / 终答全部由 tachu 保证）。
 *
 * **工具可见性（与 @tachu/core `tool-routing` 阶段）**：确定性 tool-routing 以
 * `registry.list("tool")`（叠加 `SessionScope` 的可见工具集）收窄本轮模型可见工具。
 * 因此必须把 Descriptor BC 中已注册的 Tool 镜像进本 Engine 专用的 `DescriptorRegistry`，
 * 否则 loop 首步就看不到该工具。
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
      groundingPrefetch?: ReadonlyArray<GroundingPrefetchEntry>;
    };
  };
  rules?: ReadonlyArray<unknown>;
  /** Frozen inline skill rows; drives SessionScope.additionalSkills. */
  skills?: ReadonlyArray<SnapshotSkillEntry | unknown>;
  tools?: ReadonlyArray<unknown>;
}

export interface TurnRunStreamInput {
  sessionId: string;
  turnId: string;
  tenant: number;
  userId?: string;
  scopes?: readonly string[];
  /**
   * 调用方用户原始身份三元组（出站 MCP 身份透传）；由 turn 控制器在请求上下文尚存时捕获。
   * 仅 `authPassthrough: 'user'` 的 MCP server 消费；不进 ExecutionContext.principal。
   */
  callIdentity?: CallIdentity;
  /** 用户本轮输入。 */
  prompt: string;
  content?: MessageContentV1;
  attachments?: ImageAttachment[];
  /**
   * 调用方显式点名的 `manual` 规则（与 prompt 内 `@rule`/`/rule` 取并集）。
   * 命中 snapshot 里的 manual 规则时，其正文作为 User Message 上下文块注入本轮（ADR-0032）。
   */
  explicitRuleNames?: readonly string[];
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
  private readonly tenantResolver?: TenantDescriptorResolver;
  /** 「我的技能」发现数据源（渐进式披露 L2/L3）。缺省时不注入 skillDiscovery。 */
  private readonly userShelf?: ShelfSkillLister;
  /** 与 DescriptorRegistryService 内容对齐的签名，变更时才重刷 Tachu 侧 tool 表。 */
  private toolsMirrorSig = "";
  /** 与 SkillRegistryService 内容对齐的签名，变更时才重刷 Tachu 侧 skill 表。 */
  private skillsMirrorSig = "";
  /** Lazily-resolved ToolService cache (see {@link getToolService}). */
  private lazyToolService?: ToolService;
  /** True once the lazy provider has thrown, so we don't spam the error log each call. */
  private toolServiceResolveFailed = false;

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
    /**
     * 惰性解析 ToolService 的回调（DI 注入时由 SessionModule 传入
     * `() => container.resolve(ToolService)`）。
     *
     * 为什么需要它：EngineFactory 是 SessionModule 容器里的 singleton，若在装配
     * 早期（某些 ToolService 依赖尚不可解析的时机）被首次解析，旧实现会把
     * `c.resolve(ToolService)` 的异常静默吞成 `undefined` 并永久缓存，导致后续
     * 真正的工具调用全部降级成 `[executed:tool] <ref>` 桩输出。改为惰性解析后，
     * ToolService 只在真正执行工具（请求期、容器已完整装配）时才解析，彻底规避
     * 该时机陷阱；解析失败也会显式抛错而非伪造成功。
     */
    private readonly toolServiceProvider?: () => ToolService | undefined,
    tenantResolver?: TenantDescriptorResolver,
    userShelf?: ShelfSkillLister,
  ) {
    this.descriptorRegistry = descriptorRegistry;
    this.skillRegistry = skillRegistry;
    this.tenantResolver = tenantResolver;
    this.userShelf = userShelf;
    this.providerId = provider.id;
    this.defaultModel = resolveNonEmptyModel(process.env["AGENTIC_ENGINE_MODEL"], "gpt-4o-mini");

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
      scopes: arg.scopes && arg.scopes.length > 0 ? [...arg.scopes] : ["*"],
    };
    for (const chunk of this.buildRuntimeSkillRefChunks(arg, ctx)) {
      yield chunk;
    }
    const knowledgePrefetch = await this.prefetchRuntimeKnowledge(arg, ctx);
    for (const chunk of knowledgePrefetch.chunks) {
      yield chunk;
    }
    const groundingPrefetch = await this.prefetchAgentGrounding(arg, ctx);
    for (const chunk of groundingPrefetch.chunks) {
      yield chunk;
    }
    const input = await this.buildInputEnvelope(arg);
    const runtimeSkillIds = uniqueRuntimeSkillRefs(arg.runtimeRefs).map((ref) => ref.skillId);
    const runtimeSkillResolver = await mergeTenantSkills(runtimeSkillIds, this.skillRegistry, this.tenantResolver, arg.tenant, arg.userId);
    await this.mirrorRuntimeSkillsToTachuIfNeeded(runtimeSkillResolver, arg.runtimeRefs);
    this.emitUnresolvedRuntimeSkillPins(arg, ctx, runtimeSkillResolver);
    const scope = this.buildSessionScope(
      arg,
      ctx,
      mergePrefetchContext(knowledgePrefetch.promptContext, groundingPrefetch.promptContext),
      runtimeSkillResolver,
    );
    this.turnContext.embeddingModelCode = arg.skillEmbeddingModelCode;
    this.turnContext.intentRoutingBlock = (arg.agentSnapshot?.agent?.content?.intentRouting as IntentRoutingBlock | undefined) ?? null;
    this.turnContext.callContext = adapterCallContextFromExecution(ctx);
    // 出站 MCP 身份透传窄 carrier：随 per-turn holder 携带，不落进 ExecutionContext.principal。
    this.turnContext.callIdentity = arg.callIdentity;
    const toolProgressQueue = new ToolProgressQueue<StreamChunk>();
    this.turnContext.toolProgressSink = (event: ToolProgressSinkEvent) => {
      toolProgressQueue.push(
        this.withStreamEnvelope(
          {
            type: "progress",
            phase: event.status,
            message: event.status,
            payload: {
              status: event.status,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              ...(event.progress !== undefined ? { progress: event.progress } : {}),
              ...(event.message !== undefined ? { message: event.message } : {}),
              ...(event.safeDisplayMessage !== undefined ? { safeDisplayMessage: event.safeDisplayMessage } : {}),
            },
          } as unknown as StreamChunkPayload,
          ctx,
        ),
      );
    };
    try {
      const engineStream = this.engine.runStream(input, ctx, scope)[Symbol.asyncIterator]();
      let engineNext = engineStream.next();
      while (true) {
        const queued = toolProgressQueue.shift();
        if (queued) {
          yield queued;
          continue;
        }
        const progressWait = toolProgressQueue.waitForItem();
        const winner = await Promise.race([
          engineNext.then((result) => ({ kind: "engine" as const, result })),
          progressWait.promise.then(() => ({ kind: "progress" as const })),
        ]);
        if (winner.kind === "engine") progressWait.cancel();
        if (winner.kind === "progress") continue;
        if (winner.result.done) break;
        yield winner.result.value;
        engineNext = engineStream.next();
      }
      for (let queued = toolProgressQueue.shift(); queued !== undefined; queued = toolProgressQueue.shift()) {
        yield queued;
      }
    } finally {
      this.turnContext.callContext = undefined;
      this.turnContext.callIdentity = undefined;
      this.turnContext.embeddingModelCode = undefined;
      this.turnContext.intentRoutingBlock = undefined;
      this.turnContext.toolProgressSink = undefined;
    }
  }

  async resolveEffectiveRoute(arg: Pick<TurnRunStreamInput, "prompt" | "content" | "turnModelCode" | "agentSnapshot">): Promise<{
    requestedModelCode?: string;
    effectiveModelCode: string;
    effectiveProviderCode: string;
    reason: "DIRECT" | "IMAGE_CAPABILITY_REROUTE" | "FALLBACK";
  }> {
    const requestedModelCode = arg.turnModelCode ?? arg.agentSnapshot?.agent?.content?.modelConfig?.model ?? this.defaultModel;
    if (!hasImageInput(arg.content)) {
      return {
        requestedModelCode: arg.turnModelCode,
        effectiveModelCode: requestedModelCode,
        effectiveProviderCode: this.providerId,
        reason: "DIRECT",
      };
    }
    const models = await this.provider.listAvailableModels();
    const requested = models.find((model) => model.modelName === requestedModelCode);
    if (requested?.capabilities.supportedModalities.includes("image")) {
      return {
        requestedModelCode: arg.turnModelCode,
        effectiveModelCode: requestedModelCode,
        effectiveProviderCode: this.providerId,
        reason: "DIRECT",
      };
    }
    const imageCapable = models.find((model) => model.capabilities.supportedModalities.includes("image"));
    if (imageCapable) {
      return {
        requestedModelCode: arg.turnModelCode,
        effectiveModelCode: imageCapable.modelName,
        effectiveProviderCode: this.providerId,
        reason: "IMAGE_CAPABILITY_REROUTE",
      };
    }
    return {
      requestedModelCode: arg.turnModelCode,
      effectiveModelCode: requestedModelCode,
      effectiveProviderCode: this.providerId,
      reason: "FALLBACK",
    };
  }

  private buildRuntimeSkillRefChunks(arg: TurnRunStreamInput, context: ExecutionContext): StreamChunk[] {
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
          type: "tool-call-start",
          callId,
          tool: RUNTIME_SKILL_REFS_TOOL_NAME,
          argumentsPreview: JSON.stringify(args),
        },
        context,
      ),
      this.withStreamEnvelope(
        {
          type: "tool-call-end",
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
    const registeredToolNames = this.tachuRegistry.list("tool").map((t) => t.name);
    if (!hasImageInput(arg.content)) {
      return applyHostGatingPolicyPreseed(
        {
          content: arg.prompt,
          metadata: { modality: "text", size: arg.prompt.length },
        },
        arg.prompt,
        registeredToolNames,
      );
    }
    const attachmentsById = new Map((arg.attachments ?? []).map((attachment) => [attachment.attachmentId, attachment]));
    const contentParts: Array<{ type: "text"; text: string } | { type: "file"; file: { mimeType: string; uri: string } }> = [];
    let size = 0;
    for (const block of arg.content?.blocks ?? []) {
      if (block.type === "text") {
        const text = block.text.trim();
        if (!text) continue;
        size += text.length;
        contentParts.push({ type: "text", text });
        continue;
      }
      const attachment = attachmentsById.get(block.attachmentId);
      if (!attachment) continue;
      size += attachment.size ?? 0;
      contentParts.push({
        type: "file",
        file: {
          mimeType: attachment.mimeType,
          uri: attachment.fileId,
        },
      });
    }
    return applyHostGatingPolicyPreseed(
      {
        content: contentParts,
        metadata: {
          modality: "image",
          size,
        },
      },
      arg.prompt,
      registeredToolNames,
    );
  }

  /**
   * Shared scaffolding for every host-side {@link 接地预取 | grounding prefetch}:
   * emit tool-call-start → invoke the tool → emit tool-call-end (success/error) →
   * hand back the raw output/error + duration. Callers own the skip-guards, the
   * domain-specific observability events, and how the output is formatted into
   * Agent Context. Keeps the guard/callId/chunk/error mechanics in ONE place so a
   * new prefetch adapter (knowledge, ontology, …) only writes "what to call + how
   * to format", not another copy of the chunk plumbing.
   */
  private async runContextPrefetch(
    run: { toolName: string; input: unknown; callId: string; argumentsPreview?: string },
    context: ExecutionContext,
  ): Promise<{
    chunks: StreamChunk[];
    output?: unknown;
    error?: ReturnType<typeof errorToToolError>;
    durationMs: number;
    success: boolean;
  }> {
    const toolService = this.getToolService();
    const startedAt = Date.now();
    if (!toolService) {
      return { chunks: [], durationMs: 0, success: false, error: errorToToolError(new Error("ToolService unavailable")) };
    }
    const chunks: StreamChunk[] = [
      this.withStreamEnvelope(
        {
          type: "tool-call-start",
          callId: run.callId,
          tool: run.toolName,
          argumentsPreview: run.argumentsPreview ?? JSON.stringify(run.input),
        },
        context,
      ),
    ];
    try {
      const controller = new AbortController();
      const rawOutput = await toolService.invoke(run.toolName, run.input, this.toToolHandlerCtx(context, controller.signal), {
        toolCallId: run.callId,
      });
      const output = projectToolResultForModel(run.toolName, rawOutput);
      chunks.push(
        this.withStreamEnvelope(
          {
            type: "tool-call-end",
            callId: run.callId,
            tool: run.toolName,
            success: true,
            durationMs: Date.now() - startedAt,
            output,
          },
          context,
        ),
      );
      return { chunks, output, durationMs: Date.now() - startedAt, success: true };
    } catch (error) {
      const toolError = errorToToolError(error);
      chunks.push(
        this.withStreamEnvelope(
          {
            type: "tool-call-end",
            callId: run.callId,
            tool: run.toolName,
            success: false,
            durationMs: Date.now() - startedAt,
            error: toolError,
          },
          context,
        ),
      );
      return { chunks, error: toolError, durationMs: Date.now() - startedAt, success: false };
    }
  }

  private async prefetchRuntimeKnowledge(
    arg: TurnRunStreamInput,
    context: ExecutionContext,
  ): Promise<{ chunks: StreamChunk[]; promptContext?: string }> {
    const refs = uniqueRuntimeKnowledgeRefs(arg.runtimeRefs);
    const query = truncateText(arg.prompt.trim(), 512);
    const toolService = this.getToolService();
    const kbIds = refs.map((ref) => ref.kbId);

    if (refs.length === 0) {
      emitHostEngineEvent(this.observability, context, {
        timestamp: Date.now(),
        type: "knowledge_prefetch_skipped",
        phase: "prefetch",
        payload: {
          reason: "no_refs",
          queryChars: query.length,
        },
      });
      return { chunks: [] };
    }
    if (!toolService) {
      emitHostEngineEvent(this.observability, context, {
        timestamp: Date.now(),
        type: "knowledge_prefetch_skipped",
        phase: "prefetch",
        payload: {
          reason: "no_tool_service",
          kbIds,
          queryChars: query.length,
        },
      });
      return { chunks: [] };
    }
    if (query.length < 2) {
      emitHostEngineEvent(this.observability, context, {
        timestamp: Date.now(),
        type: "knowledge_prefetch_skipped",
        phase: "prefetch",
        payload: {
          reason: "query_too_short",
          kbIds,
          queryChars: query.length,
        },
      });
      return { chunks: [] };
    }

    const callId = arg.nextStreamId?.() ?? `runtime-knowledge-query:${arg.turnId}`;
    const input = { query, topK: 5 };
    const result = await this.runContextPrefetch(
      {
        toolName: RUNTIME_KNOWLEDGE_QUERY_TOOL_NAME,
        input,
        callId,
        argumentsPreview: JSON.stringify({ ...input, kbIds }),
      },
      context,
    );
    if (result.success) {
      const promptContext = formatRetrievedKnowledgeContext(result.output, refs);
      const hits = readKnowledgeHits(result.output);
      emitHostEngineEvent(this.observability, context, {
        timestamp: Date.now(),
        type: "knowledge_prefetch_end",
        phase: "prefetch",
        payload: {
          hitCount: hits.length,
          truncated: readKnowledgeTruncated(result.output),
          kbIds,
          queryChars: query.length,
          durationMs: result.durationMs,
          injectedContextChars: promptContext.length,
          topHits: summarizeKnowledgeHitsForObservability(hits),
        },
      });
      return { chunks: result.chunks, promptContext };
    }
    const toolError = result.error ?? errorToToolError(new Error("knowledge prefetch failed"));
    emitHostEngineEvent(this.observability, context, {
      timestamp: Date.now(),
      type: "knowledge_prefetch_failed",
      phase: "prefetch",
      payload: {
        kbIds,
        queryChars: query.length,
        durationMs: result.durationMs,
        errorCode: toolError.code,
        errorMessage: toolError.message,
      },
    });
    return { chunks: result.chunks };
  }

  /**
   * 数据实体等「接地预取」执行者（见 CONTEXT.md「接地预取」）：读 agent 声明的
   * `groundingPrefetch`，逐项经 {@link runContextPrefetch} 预跑，把结果格式化注入本轮
   * 上下文。领域知识全在声明里，本方法保持通用、不认任何具体工具名。
   */
  private async prefetchAgentGrounding(
    arg: TurnRunStreamInput,
    context: ExecutionContext,
  ): Promise<{ chunks: StreamChunk[]; promptContext?: string }> {
    const entries = arg.agentSnapshot?.agent?.content?.groundingPrefetch ?? [];
    if (entries.length === 0) {
      return { chunks: [] };
    }
    const toolService = this.getToolService();
    if (!toolService) {
      emitHostEngineEvent(this.observability, context, {
        timestamp: Date.now(),
        type: "grounding_prefetch_skipped",
        phase: "prefetch",
        payload: { reason: "no_tool_service", entryCount: entries.length },
      });
      return { chunks: [] };
    }
    const registeredToolNames = new Set(this.tachuRegistry.list("tool").map((t) => t.name));
    const query = truncateText(arg.prompt.trim(), 512);
    const chunks: StreamChunk[] = [];
    const contextParts: string[] = [];
    let index = 0;
    for (const entry of entries) {
      const emitSkip = (reason: string): void =>
        emitHostEngineEvent(this.observability, context, {
          timestamp: Date.now(),
          type: "grounding_prefetch_skipped",
          phase: "prefetch",
          payload: { reason, tool: entry.tool },
        });
      if (!registeredToolNames.has(entry.tool)) {
        emitSkip("tool_not_registered");
        continue;
      }
      if (entry.queryFromPrompt && query.length < 2) {
        emitSkip("query_too_short");
        continue;
      }
      const input = {
        ...entry.args,
        ...(entry.queryFromPrompt ? { query, topK: entry.topK ?? 5 } : {}),
      };
      const callId = arg.nextStreamId?.() ?? `runtime-grounding-prefetch:${arg.turnId}:${index}`;
      index += 1;
      const result = await this.runContextPrefetch({ toolName: entry.tool, input, callId }, context);
      for (const chunk of result.chunks) chunks.push(chunk);
      if (result.success) {
        const part = formatGroundingPrefetchContext(entry.tool, result.output);
        if (part) contextParts.push(part);
        emitHostEngineEvent(this.observability, context, {
          timestamp: Date.now(),
          type: "grounding_prefetch_end",
          phase: "prefetch",
          payload: { tool: entry.tool, durationMs: result.durationMs, injectedContextChars: part.length },
        });
      } else {
        const toolError = result.error ?? errorToToolError(new Error("grounding prefetch failed"));
        emitHostEngineEvent(this.observability, context, {
          timestamp: Date.now(),
          type: "grounding_prefetch_failed",
          phase: "prefetch",
          payload: { tool: entry.tool, durationMs: result.durationMs, errorCode: toolError.code, errorMessage: toolError.message },
        });
      }
    }
    const promptContext = mergePrefetchContext(...contextParts);
    return promptContext !== undefined ? { chunks, promptContext } : { chunks };
  }

  private withStreamEnvelope(chunk: StreamChunkPayload, context: ExecutionContext): StreamChunk {
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
   *   并并集 `currentDate` / `session_recall`（若注册表存在该内置工具）。
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
      if (d) parts.push(`${d.name}@${d.version ?? "1.0.0"}`);
    }
    const sig = parts.join("|");
    if (sig === this.toolsMirrorSig) return;

    for (const name of this.tachuRegistry.list("tool").map((t) => t.name)) {
      await this.tachuRegistry.unregister("tool", name).catch(() => {});
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

    for (const name of this.tachuRegistry.list("skill").map((s) => s.name)) {
      await this.tachuRegistry.unregister("skill", name).catch(() => {});
    }
    for (const skill of this.skillRegistry.list()) {
      await this.tachuRegistry.register(skill);
    }
    this.skillsMirrorSig = sig;
  }

  /** Register per-turn @-mentioned skills (incl. tenant `skl_*`) so tachu can render Active Skills. */
  private async mirrorRuntimeSkillsToTachuIfNeeded(
    skillResolver: SkillRegistryResolveLike | undefined,
    runtimeRefs: RuntimeRefs | undefined,
  ): Promise<void> {
    if (!skillResolver) return;
    for (const ref of uniqueRuntimeSkillRefs(runtimeRefs)) {
      const skill = skillResolver.resolve(ref.skillId);
      if (!skill) continue;
      const existing = this.tachuRegistry.list("skill").some((entry) => entry.name === skill.name);
      if (existing) continue;
      await this.tachuRegistry.register(skill);
    }
  }

  /**
   * 运行时 @-pin 的技能若最终解析不到（owner 也拿不到 draft、非 owner 又未发布、或 id 不存在），
   * 发一个 host 观测事件——修掉「引用登记看似成功、正文却从未注入」的静默失败（见 CONTEXT.md「@-pin 技能解析」）。
   */
  private emitUnresolvedRuntimeSkillPins(
    arg: TurnRunStreamInput,
    context: ExecutionContext,
    skillResolver: SkillRegistryResolveLike | undefined,
  ): void {
    for (const ref of uniqueRuntimeSkillRefs(arg.runtimeRefs)) {
      if (skillResolver?.resolve(ref.skillId)) continue;
      emitHostEngineEvent(this.observability, context, {
        timestamp: Date.now(),
        type: "skill_pin_unresolved",
        phase: "prefetch",
        payload: {
          skillId: ref.skillId,
          ...(ref.displayName !== undefined ? { displayName: ref.displayName } : {}),
        },
      });
    }
  }

  /**
   * 构造 SessionScope —— 本类的核心翻译逻辑。
   *
   * - systemInstruction：直接采用 snapshot `prompt`；UTC 时钟锚点已在 session 创建时
   *   由 `SessionService.buildSnapshots` 一次性冻结进 `prompt` 末尾，本层不再每轮重复
   *   注入。仅空白时不设置（由 tachu 走自身默认 system prompt）。
   * - modelOverride.all：优先级 turn body > snapshot.modelConfig > env > 默认；
   *   只要任一档命中，都用 `provider.id` + 该 model 写入 `all`，影响本轮全部 capability。
   * - additionalSkills：快照内联 skill 名称列表（作为 snapshot-refs 输入，T0 pinned）。
   * - additionalRules / explicitRuleNames：把 snapshot 冻结的规则每轮投影给 tachu，交由
   *   `PromptAssembler` 按 `activation` 组装进 system 段（`always` 恒进、`manual` 命中
   *   `explicitRuleNames` 才进）——每轮重算、**不入 memory**（ADR-0032）。点名集 =
   *   prompt `@rule`/`/rule` ∪ 调用方 `explicitRuleNames`，与 snapshot 里的 manual 规则求交。
   * - keyword 候选由 tachu `SkillActivator` + `KeywordCandidateStrategy` 处理。
   */
  private buildSessionScope(
    arg: TurnRunStreamInput,
    context: ExecutionContext,
    retrievedKnowledgeContext?: string,
    skillResolver?: SkillRegistryResolveLike,
  ): SessionScope {
    const rawPrompt = arg.agentSnapshot?.agent?.content?.prompt;
    const model =
      resolveNonEmptyModel(arg.turnModelCode) ||
      resolveNonEmptyModel(arg.agentSnapshot?.agent?.content?.modelConfig?.model) ||
      this.defaultModel;

    const intentRouting = arg.agentSnapshot?.agent?.content?.intentRouting as IntentRoutingBlock | undefined;

    const scope: SessionScope = {
      modelOverride: { all: { provider: this.providerId, model } },
      additionalRules: snapshotRulesToTachuDescriptors(arg.agentSnapshot?.rules),
      additionalSkills: this.resolvePinnedSkillsForTurn(arg, skillResolver),
      additionalTools: [],
      ...(arg.nextStreamId !== undefined ? { idFactory: arg.nextStreamId } : {}),
      ...(intentRouting?.enabled === false ? { toolRoutingDisabled: true } : {}),
    };

    // 「我的技能」渐进式披露（L2/L3）：从当前 user 的 shelf（owner-aware）构造回合级、
    // 租户隔离的 skillDiscovery provider，喂给 tachu 原生 search_skills / load_skill /
    // "Available Skills"——不写进程级共享 registry，规避跨租户泄漏（AGENTS.md #3）。
    if (this.userShelf && this.tenantResolver && arg.userId) {
      scope.skillDiscovery = buildShelfSkillDiscoveryProvider({
        shelf: this.userShelf,
        resolver: this.tenantResolver,
        tenant: arg.tenant,
        userId: arg.userId,
      });
    }

    const basePrompt = typeof rawPrompt === "string" && rawPrompt.trim().length > 0 ? rawPrompt.trim() : "";
    const withKnowledgeRefs = appendRuntimeKnowledgeRefsHint(basePrompt, arg.runtimeRefs);
    const withRetrievedKnowledge = [withKnowledgeRefs.trim(), retrievedKnowledgeContext?.trim()]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join("\n\n");
    const withRuntimeSkillRefs = appendRuntimeSkillRefsHint(withRetrievedKnowledge, arg.runtimeRefs);
    const withPinnedOverride = appendRuntimeSkillPriorityOverride(withRuntimeSkillRefs, arg.runtimeRefs, skillResolver);
    const withHint = appendSkillDiscoveryHint(withPinnedOverride);
    if (withHint.trim().length > 0) {
      scope.systemInstruction = withHint;
    }

    // rc.10 深单 loop 无 intent 分类器：agent 可见 tools/skills 经 `activationHints`
    // （tachu rc.13 取代旧 `intentAgentContext`）被确定性 `tool-routing` 阶段消费
    // （并入本轮 agent 可见工具/技能名全集）；纯确定性 host gating 输入，无 intent-LLM。
    // tachuRegistry is already up-to-date: mirrorDescriptorToolsToTachuIfNeeded() runs
    // before buildSessionScope() in runStream().
    const registeredTools = this.tachuRegistry.list("tool") as Array<{
      name: string;
      description?: string;
    }>;
    const registeredSkills = this.tachuRegistry.list("skill") as Array<{
      name: string;
      description?: string;
      tags?: string[];
    }>;
    const agentVisibleTools = registeredTools
      .filter((t) => t.description)
      .map((t) => ({
        name: t.name,
        description: summarizeToolDescriptionForIntent(t.description as string),
      }));
    const agentVisibleSkills = registeredSkills
      .filter((s) => s.description)
      .map((s) => ({
        name: s.name,
        description: s.description as string,
        ...(s.tags && s.tags.length > 0 ? { tags: [...s.tags] } : {}),
      }));
    if (agentVisibleTools.length > 0 || agentVisibleSkills.length > 0) {
      scope.activationHints = {
        ...(agentVisibleTools.length > 0 ? { tools: agentVisibleTools } : {}),
        ...(agentVisibleSkills.length > 0 ? { skills: agentVisibleSkills } : {}),
      };
    }

    const registeredToolNames = registeredTools.map((tool) => tool.name);
    const registeredSkillNames = registeredSkills.map((skill) => skill.name);
    const explicitToolNames = new Set(findExplicitToolMentions(arg.prompt, registeredToolNames));
    const resolveSkill = skillResolver ?? this.skillRegistry;
    const explicitSkillNames = new Set(findExplicitSkillMentions(arg.prompt, registeredSkillNames));
    for (const ref of uniqueRuntimeSkillRefs(arg.runtimeRefs)) {
      const resolved = resolveSkill?.resolve(ref.skillId);
      if (resolved?.name) explicitSkillNames.add(resolved.name);
    }
    if (explicitToolNames.size > 0) {
      scope.explicitToolNames = [...explicitToolNames];
    }
    if (explicitSkillNames.size > 0) {
      scope.explicitSkillNames = [...explicitSkillNames];
    }

    // manual 规则激活集：本轮被显式点名（prompt `@rule`/`/rule` ∪ 调用方 explicitRuleNames）
    // 且在 snapshot 里确为 manual 的规则。tachu 只对 manual 规则消费 explicitRuleNames；
    // always 恒进、semantic/path 由各自输入门控，故此处只收 manual 命中名（可观测、语义清晰）。
    const manualRuleNames = new Set((scope.additionalRules ?? []).filter((r) => r.activation.mode === "manual").map((r) => r.name));
    if (manualRuleNames.size > 0) {
      const activated = new Set(findExplicitRuleMentions(arg.prompt, [...manualRuleNames]));
      for (const raw of arg.explicitRuleNames ?? []) {
        const name = raw.trim();
        if (manualRuleNames.has(name)) activated.add(name);
      }
      if (activated.size > 0) {
        scope.explicitRuleNames = [...activated];
        emitHostEngineEvent(this.observability, context, {
          timestamp: Date.now(),
          type: "manual_rule_injected",
          phase: "session",
          payload: { rules: [...activated] },
        });
      }
    }

    return scope;
  }

  /**
   * Snapshot skills[] first; legacy sessions with only skillRefs fall back to live registry.
   */
  private resolvePinnedSkillsForTurn(arg: TurnRunStreamInput, skillResolver?: SkillRegistryResolveLike): SkillDescriptor[] {
    const out: SkillDescriptor[] = [];
    const seen = new Set<string>();
    const push = (skill: SkillDescriptor | undefined): void => {
      if (!skill || seen.has(skill.name)) return;
      seen.add(skill.name);
      out.push(skill);
    };

    const resolveSkill = skillResolver ?? this.skillRegistry;
    const runtimeRefs = uniqueRuntimeSkillRefs(arg.runtimeRefs);
    const hasRuntimeUserSkills = runtimeRefs.length > 0;

    const pushSnapshotSkills = (skills: SkillDescriptor[]): void => {
      for (const skill of skills) {
        if (hasRuntimeUserSkills && DEFERRABLE_SESSION_SKILL_NAMES.has(skill.name)) continue;
        push(skill);
      }
    };

    const pushRuntimeSkills = (): void => {
      if (!resolveSkill) return;
      for (const ref of runtimeRefs) {
        push(resolveSkill.resolve(ref.skillId));
      }
    };

    const fromSnapshot = snapshotSkillsToDescriptors(arg.agentSnapshot?.skills);
    if (fromSnapshot.length > 0) {
      pushSnapshotSkills(fromSnapshot);
      pushRuntimeSkills();
      return out;
    }

    const refs = arg.agentSnapshot?.agent?.content?.skillRefs;
    if (refs && refs.length > 0 && this.skillRegistry) {
      for (const name of refs) {
        if (hasRuntimeUserSkills && DEFERRABLE_SESSION_SKILL_NAMES.has(name)) continue;
        push(this.skillRegistry.resolve(name));
      }
    }
    pushRuntimeSkills();
    return out;
  }

  /**
   * 惰性解析业务 ToolService。
   *
   * 解析顺序：构造期直传的实例 → 已缓存的惰性实例 → 惰性 provider（请求期解析）。
   * provider 抛错时只在首次记录一条 error 日志，返回 `undefined` 由调用方按
   * 各自语义降级（工具执行路径会显式失败，而不是伪造成功）。
   */
  private getToolService(): ToolService | undefined {
    if (this.toolService) return this.toolService;
    if (this.lazyToolService) return this.lazyToolService;
    if (!this.toolServiceProvider || this.toolServiceResolveFailed) return undefined;
    try {
      const resolved = this.toolServiceProvider();
      if (resolved) {
        this.lazyToolService = resolved;
        return resolved;
      }
      this.toolServiceResolveFailed = true;
      return undefined;
    } catch (error) {
      this.toolServiceResolveFailed = true;
      // EngineFactory 没有注入 logger；此路径属于"本不该发生"的装配级故障，
      // 用 console.error 显式喷出，避免再次被静默吞掉。
      console.error(
        "[EngineFactory] failed to resolve ToolService lazily; tool calls will fail:",
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      return undefined;
    }
  }

  /**
   * Tachu TaskExecutor adapter：tool-use 子流程选中 Tool 后，由这里回调到业务
   * ToolService，复用 DescriptorRegistry / AuthZ / Safety / Audit / MCP handler。
   */
  private buildToolTaskExecutor(): TaskExecutor {
    return async (task, context, signal) => {
      // 非 tool 任务（agent / sub-flow 占位）保持占位输出语义。
      if (task.type !== "tool") {
        return {
          ok: true,
          output: {
            ref: task.ref,
            input: task.input,
            output: `[executed:${task.type}] ${task.ref}`,
          },
        };
      }

      // 真正的工具调用：ToolService 不可用时必须显式失败，绝不伪造成功——
      // 否则 LLM 会拿到 `[executed:tool] <ref>` 这种假结果并据此作答，
      // 既统计不出真实数据，又把内部占位串泄露给用户。
      const toolService = this.getToolService();
      if (!toolService) {
        return {
          ok: false,
          error: {
            code: "TOOL_SERVICE_UNAVAILABLE",
            message: `Tool "${task.ref}" cannot run: ToolService is not available in the engine runtime.`,
            retryable: false,
            source: "engine",
          },
        };
      }

      const handlerCtx = this.toToolHandlerCtx(context, signal);
      const toolCallId = task.id.startsWith("tool-use:") ? task.id.slice("tool-use:".length) : task.id;

      const fallbackTimers: Array<ReturnType<typeof setTimeout>> = [];
      let completed = false;
      let mcpProgressSeen = false;
      const clearScheduledFallbackTimers = (): void => {
        for (const timer of fallbackTimers) clearTimeout(timer);
        fallbackTimers.length = 0;
      };
      const clearFallbackTimers = (): void => {
        completed = true;
        clearScheduledFallbackTimers();
      };
      const abortFallback = (): void => clearFallbackTimers();
      if (this.turnContext.toolProgressSink && !signal.aborted) {
        for (const step of resolveToolProgressFallbackSchedule()) {
          const timer = setTimeout(() => {
            if (completed || mcpProgressSeen || signal.aborted) return;
            this.turnContext.toolProgressSink?.({
              toolCallId,
              toolName: task.ref,
              status: step.status,
              safeDisplayMessage: step.safeDisplayMessage,
            });
          }, step.delayMs);
          fallbackTimers.push(timer);
        }
        signal.addEventListener("abort", abortFallback, { once: true });
      }

      try {
        const rawOutput = await toolService.invoke(task.ref, task.input, handlerCtx, {
          toolCallId,
          onProgress: (event) => {
            mcpProgressSeen = true;
            clearScheduledFallbackTimers();
            const progress = normalizeMcpProgress(event.progress, event.total);
            this.turnContext.toolProgressSink?.({
              toolCallId,
              toolName: task.ref,
              status: "mcp.progress",
              ...(progress !== undefined ? { progress } : {}),
              ...(event.message !== undefined ? { message: event.message } : {}),
            });
          },
        });
        const output = projectToolResultForModel(task.ref, rawOutput);
        return { ok: true, output };
      } finally {
        clearFallbackTimers();
        signal.removeEventListener("abort", abortFallback);
      }
    };
  }

  private toToolHandlerCtx(context: ExecutionContext, signal: AbortSignal): ToolHandlerCtx {
    const tenant = this.readTenant(context.principal["tenant"]);
    const userId = this.readOptionalString(context.principal["userId"]);
    const runtimeRefs = this.readRuntimeRefs(context.principal["runtimeRefs"]);
    const turnId = this.readOptionalString(context.principal["turnId"]) ?? context.correlation.turnId;

    return {
      traceId: context.correlation.traceId,
      signal,
      auth: {
        tenant,
        ...(userId ? { user: { userId, scopes: [...(context.scopes ?? [])] } } : {}),
      },
      session: {
        id: context.correlation.sessionId,
        turnId,
      },
      ...(runtimeRefs !== undefined ? { turn: { runtimeRefs } } : {}),
      // 出站 MCP 身份透传：从 per-turn holder 读取（不来自 principal），仅本轮有效。
      ...(this.turnContext.callIdentity !== undefined ? { callIdentity: this.turnContext.callIdentity } : {}),
    };
  }

  private readTenant(raw: unknown): number {
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
    if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) {
      return Math.trunc(Number(raw.trim()));
    }
    throw new Error("Tachu Tool TaskExecutor requires numeric tenant in ExecutionContext.principal");
  }

  private readOptionalString(raw: unknown): string | undefined {
    if (typeof raw !== "string") return undefined;
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
   * - rc.10 深单 loop 无 intent 分类 phase：所有输入直接进 loop，由 LLM 自决是否
   *   调工具；无工具轮由 loop step-1 承接（不再有 simple/complex 预分类）。
   */
  buildEngineConfig(): EngineConfig {
    return buildDefaultEngineConfig(this.providerId, this.defaultModel);
  }
}
