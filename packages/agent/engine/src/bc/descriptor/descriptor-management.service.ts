/**
 * DescriptorManagementService —— 租户 descriptor 管理面用例编排（ADR-0016 §1/§4/§6, ADR-0018）。
 *
 * 薄编排层：内容按 kind schema 校验 → 委托 {@link TenantDescriptorRepository} 落库（draft）。
 * `:fromDocument` 走 DescriptorDocumentParser（ADR-0018 §5）再 upsert。
 * tenant 始终由 controller 从请求上下文显式传入（不嵌 id，ADR-0012 addendum）。
 */
import { Injectable } from "@dangao/bun-server";
import type { ZodType } from "zod";

import type { OutboxWriter, TransactionContext } from "@cube-ai/bun-server-ext-outbox";
import {
  TenantAgentContentSchema,
  TenantRuleContentSchema,
  TenantSkillContentSchema,
  type DescriptorVersion,
  type TenantDescriptorKind,
  type TenantDescriptorView,
  type FromDocumentResult,
  type LlmProviderPort,
  type LlmMessage,
  type ProposeRequest,
  type ProposeResult,
  type ProposeSuggestion,
} from "@cube-ai/contracts";

import { AgenticEngineError } from "../../infra/errors/agentic-error";
import { parseAgentDocument, parseRuleDocument, parseSkillDocument } from "./descriptor-document-parser";
import { assertDescriptorOwner, assertDescriptorOwnerOrAdmin } from "./descriptor-owner";
import type { ShelfService } from "./shelf.service";
import type { TenantDescriptorRepository, UpsertDescriptorResult } from "./tenant-descriptor.repository";

const CONTENT_SCHEMA: Record<TenantDescriptorKind, ZodType> = {
  agent: TenantAgentContentSchema,
  skill: TenantSkillContentSchema,
  rule: TenantRuleContentSchema,
};

const NULL_TX = null as unknown as TransactionContext;

/** propose ref 候选的 kind 全集（含运行时 tool / sub-agent，ADR-0027 §6）。 */
export type ProposeRefKind = ProposeSuggestion["kind"];

/**
 * 两阶段流式事件（ADR-0027 §5）：先若干 `delta`（prose token）、末尾一个 `proposal`（终态信封）。
 * controller 直接映射为 SSE：`delta` → `event: delta`，`proposal` → `event: proposal`。
 */
export type ProposeStreamEvent = { type: "delta"; delta: string } | { type: "proposal"; result: ProposeResult };

/** 单个候选 ref（系统级 registry 或租户已发布 descriptor 投影）。 */
export interface ProposeCandidate {
  kind: ProposeRefKind;
  /** 系统级 = 裸 name；租户级 = 前缀 id（`skl_`/`rul_`/`agt_`）。 */
  ref: string;
  description?: string;
}

/**
 * 系统级候选 ref 来源（skill/rule/tool registry 投影，ADR-0027 §6）。
 * 由 http module 经现有 registry 适配；离线/缺失时返回空数组即可降级（无候选 = 不接地）。
 */
export interface ProposeCandidateSource {
  systemSkills(): ProposeCandidate[];
  systemRules(): ProposeCandidate[];
  systemTools(): ProposeCandidate[];
}

/** 缺省「创作模型」env（ADR-0027 §10）；`req.modelCode` 优先。 */
const DEFAULT_AUTHORING_MODEL_CODE = "gpt-4o-mini";

function authoringModelCode(req: ProposeRequest): string {
  const override = req.modelCode?.trim();
  if (override) return override;
  const fromEnv = process.env["AGENTIC_AUTHORING_MODEL_CODE"]?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_AUTHORING_MODEL_CODE;
}

/** agent content 上每个 ref 数组字段对应的候选 kind。 */
const AGENT_REF_FIELDS: ReadonlyArray<{ field: string; kind: ProposeRefKind }> = [
  { field: "skillRefs", kind: "skill" },
  { field: "ruleRefs", kind: "rule" },
  { field: "availableTools", kind: "tool" },
  { field: "subAgentRefs", kind: "agent" },
];

function tolerantJsonParse(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const candidates: string[] = [];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  candidates.push(trimmed);
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return v as Record<string, unknown>;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v === "string" && v.trim() && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** kind content 中承载人类可读 prose 的字段（phase-1 真流式的产物落点，ADR-0027 §5）。 */
const PROSE_FIELD: Record<TenantDescriptorKind, "prompt" | "instructions" | "content"> = {
  agent: "prompt",
  skill: "instructions",
  rule: "content",
};

function proseFieldOf(content: unknown, field: string): string {
  if (!content || typeof content !== "object") return "";
  const v = (content as Record<string, unknown>)[field];
  return typeof v === "string" ? v : "";
}

/**
 * Phase 1（ADR-0027 §5）：只生成人类可读 prose 正文（prompt/instructions/content），
 * 纯文本输出 → 可经 `chatStream` 逐 token 真流式给前端。
 */
function buildProseMessages(kind: TenantDescriptorKind, req: ProposeRequest): LlmMessage[] {
  const mode = req.base !== undefined ? "optimize" : "generate";
  const field = PROSE_FIELD[kind];
  const system = [
    `You are an authoring assistant for ${kind} descriptors in an AI middleware platform.`,
    `Write ONLY the ${field} body text for the ${kind} — plain text / markdown, NO JSON, NO preamble, NO code fences.`,
    mode === "optimize" ? `Improve the provided current ${field}, preserving its intent.` : `Write it to satisfy the user's intent.`,
  ].join("\n");

  const userParts: string[] = [];
  if (mode === "optimize") {
    const baseProse = proseFieldOf(req.base, field) || JSON.stringify(req.base);
    userParts.push(`Current ${field}:\n${baseProse}`);
    if (req.focus?.trim()) userParts.push(`Focus of the change: ${req.focus.trim()}`);
  } else {
    userParts.push(`Intent: ${req.intent?.trim() ?? ""}`);
    if (req.focus?.trim()) userParts.push(`Focus: ${req.focus.trim()}`);
  }

  return [
    { role: "system", content: system },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Phase 2（ADR-0027 §5/§6）：给定已草拟的 prose 正文，产出结构化 refs 建议 + 元数据 JSON。
 * refs 仍只能从候选清单选（硬接地在 {@link groundAndInline} 收口）。
 */
function buildStructuredMessages(
  kind: TenantDescriptorKind,
  req: ProposeRequest,
  prose: string,
  candidates: ProposeCandidate[],
): LlmMessage[] {
  const candidateLines =
    candidates.length > 0
      ? candidates.map((c) => `- [${c.kind}] ${c.ref}${c.description ? `: ${c.description}` : ""}`).join("\n")
      : "(none available)";

  const system = [
    `You are an authoring assistant for ${kind} descriptors in an AI middleware platform.`,
    `Given the drafted ${kind} body below, return ONLY a single JSON object with this exact shape:`,
    `{"suggestions":[{"kind":"skill|rule|tool|agent","ref":"<exact ref from the candidate list>","rationale":"<why>","confidence":<0..1 optional>}],"meta":{"displayName":"<optional>","tags":["..."],"description":"<optional>","trigger":"<optional, skill only>"}}`,
    `You MUST only reference refs that appear verbatim in the candidate list below. Never invent refs.`,
    kind === "agent"
      ? `Recommend the skills/rules/tools/sub-agents most relevant to this agent.`
      : `"suggestions" may be empty for ${kind}.`,
  ].join("\n");

  const userParts = [
    `Drafted ${PROSE_FIELD[kind]}:\n${prose}`,
    req.intent?.trim() ? `Original intent: ${req.intent.trim()}` : "",
    `Candidate refs (choose ONLY from these):\n${candidateLines}`,
  ].filter((s) => s.length > 0);

  return [
    { role: "system", content: system },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/** 把 phase-1 prose + phase-2 meta 组装为 kind content（refs 由 groundAndInline 后续注入）。 */
function assembleContent(
  kind: TenantDescriptorKind,
  req: ProposeRequest,
  prose: string,
  meta: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    req.base !== undefined && typeof req.base === "object" && req.base !== null ? { ...(req.base as Record<string, unknown>) } : {};
  const content: Record<string, unknown> = { ...base };
  content[PROSE_FIELD[kind]] = prose;

  if (typeof meta.displayName === "string" && meta.displayName.trim()) {
    content["displayName"] = meta.displayName.trim();
  }
  if (Array.isArray(meta.tags)) {
    content["tags"] = meta.tags.filter((t): t is string => typeof t === "string");
  }
  if (typeof meta.version === "string" && meta.version.trim()) {
    content["version"] = meta.version.trim();
  }
  if (kind !== "agent") {
    const desc =
      typeof meta.description === "string" && meta.description.trim()
        ? meta.description.trim()
        : typeof content["description"] === "string" && (content["description"] as string).trim()
          ? (content["description"] as string)
          : req.intent?.trim() || prose.slice(0, 80).trim();
    if (desc) content["description"] = desc;
  }
  if (kind === "skill" && typeof meta.trigger === "string" && meta.trigger.trim()) {
    content["trigger"] = meta.trigger.trim();
  }
  return content;
}

function parseDocument(kind: TenantDescriptorKind, raw: string): { name: string; content: unknown } {
  switch (kind) {
    case "agent":
      return parseAgentDocument(raw);
    case "skill":
      return parseSkillDocument(raw);
    case "rule":
      return parseRuleDocument(raw);
  }
}

@Injectable()
export class DescriptorManagementService {
  constructor(
    private readonly repo: TenantDescriptorRepository,
    /** ADR-0027 §10：辅助创作 LLM（凭据单源 llm-core）。未注入则 propose 不可用。 */
    private readonly llm?: LlmProviderPort,
    /** ADR-0027 §6：系统级候选 ref 来源。缺省（离线/未装配）= 无系统候选。 */
    private readonly candidateSource?: ProposeCandidateSource,
    /** ADR-0030 D1：作者创建 agent/skill 后自动进入「我的」货架。 */
    private readonly shelf?: Pick<ShelfService, "upsertAuthored">,
    /** ADR-0030：发布/回滚/删除后广播 descriptor cache 精确失效。 */
    private readonly outbox?: OutboxWriter,
  ) {}

  private validateContent(kind: TenantDescriptorKind, content: unknown): unknown {
    const res = CONTENT_SCHEMA[kind].safeParse(content);
    if (!res.success) {
      throw AgenticEngineError.fromCode(
        "INVALID_ARGUMENT_DESCRIPTOR_CONTENT",
        `Invalid ${kind} descriptor content: ${res.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
        { kind },
      );
    }
    return res.data;
  }

  private async getOwnedDescriptor(tenant: number, id: string): Promise<TenantDescriptorView> {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) {
      throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_DESCRIPTOR", `Descriptor not found: ${id}`, { id });
    }
    return existing;
  }

  private async appendDescriptorReload(tenant: number, descriptorId: string): Promise<void> {
    if (!this.outbox) return;
    try {
      await this.outbox.append(NULL_TX, {
        tenant,
        channel: "descriptor_reload",
        eventType: "descriptor.reload",
        payloadJson: { tenant, descriptorId },
        target: descriptorId,
        scheduleTime: Date.now(),
      });
    } catch {
      // POST-commit best-effort：发布/更新已落库，outbox 失败不应把 HTTP 打成 500。
    }
  }

  async create(
    tenant: number,
    kind: TenantDescriptorKind,
    body: { name?: unknown; content?: unknown },
    actor?: string,
  ): Promise<TenantDescriptorView> {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      throw AgenticEngineError.fromCode("INVALID_ARGUMENT_DESCRIPTOR_NAME", "Descriptor name is required", { kind });
    }
    const content = this.validateContent(kind, body.content);
    const { id } = await this.repo.upsert(tenant, kind, name, content, actor);
    if ((kind === "agent" || kind === "skill") && actor) {
      await this.shelf?.upsertAuthored(tenant, actor, id, kind);
    }
    const view = await this.repo.findById(tenant, id);
    if (!view) {
      throw AgenticEngineError.fromCode("INTERNAL_UNKNOWN", "Descriptor not visible after create", { id });
    }
    return view;
  }

  async update(tenant: number, kind: TenantDescriptorKind, id: string, content: unknown, actor?: string): Promise<TenantDescriptorView> {
    const existing = await this.getOwnedDescriptor(tenant, id);
    assertDescriptorOwner(existing.ownerUserId, actor);
    const validated = this.validateContent(kind, content);
    await this.repo.upsert(tenant, kind, existing.name, validated, actor);
    const view = await this.repo.findById(tenant, id);
    if (!view) {
      throw AgenticEngineError.fromCode("INTERNAL_UNKNOWN", "Descriptor not visible after update", { id });
    }
    return view;
  }

  list(tenant: number, kind: TenantDescriptorKind): Promise<TenantDescriptorView[]> {
    return this.repo.list(tenant, kind);
  }

  async get(tenant: number, id: string): Promise<TenantDescriptorView> {
    const view = await this.repo.findById(tenant, id);
    if (!view) {
      throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_DESCRIPTOR", `Descriptor not found: ${id}`, { id });
    }
    return view;
  }

  async publish(tenant: number, id: string, actor?: string): Promise<TenantDescriptorView> {
    const existing = await this.getOwnedDescriptor(tenant, id);
    assertDescriptorOwner(existing.ownerUserId, actor);
    const published = await this.repo.publish(tenant, id, actor);
    await this.appendDescriptorReload(tenant, id);
    return published;
  }

  async remove(tenant: number, id: string, actor?: string, opts: { isAdmin?: boolean } = {}): Promise<void> {
    const existing = await this.getOwnedDescriptor(tenant, id);
    assertDescriptorOwnerOrAdmin(existing.ownerUserId, actor, opts.isAdmin === true);
    await this.repo.softDelete(tenant, id, actor);
    await this.appendDescriptorReload(tenant, id);
  }

  async listVersions(tenant: number, id: string, actor?: string): Promise<DescriptorVersion[]> {
    const existing = await this.getOwnedDescriptor(tenant, id);
    assertDescriptorOwner(existing.ownerUserId, actor);
    return this.repo.listVersions(tenant, id);
  }

  async getVersionContent(tenant: number, id: string, versionNo: number, actor?: string): Promise<unknown> {
    const existing = await this.getOwnedDescriptor(tenant, id);
    assertDescriptorOwner(existing.ownerUserId, actor);
    const content = await this.repo.getVersionContent(tenant, id, versionNo);
    if (content == null) {
      throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_DESCRIPTOR", `Descriptor version not found: ${id}@${versionNo}`, {
        id,
        versionNo,
      });
    }
    return content;
  }

  async rollback(tenant: number, id: string, versionNo: number, actor?: string): Promise<TenantDescriptorView> {
    const existing = await this.getOwnedDescriptor(tenant, id);
    assertDescriptorOwner(existing.ownerUserId, actor);
    const rolledBack = await this.repo.rollback(tenant, id, versionNo, actor);
    await this.appendDescriptorReload(tenant, id);
    return rolledBack;
  }

  /** ADR-0018：text/plain 文档 → parse → upsert（结果恒为 draft）。 */
  async fromDocument(tenant: number, kind: TenantDescriptorKind, raw: string, actor?: string): Promise<FromDocumentResult> {
    let parsed: { name: string; content: unknown };
    try {
      parsed = parseDocument(kind, raw);
    } catch (e) {
      throw AgenticEngineError.fromCode(
        "INVALID_ARGUMENT_DESCRIPTOR_DOCUMENT",
        `Invalid ${kind} descriptor document: ${e instanceof Error ? e.message : String(e)}`,
        { kind },
      );
    }
    const existing = await this.repo.findByName(tenant, kind, parsed.name);
    if (existing) {
      assertDescriptorOwner(existing.ownerUserId, actor);
    }
    const res: UpsertDescriptorResult = await this.repo.upsert(tenant, kind, parsed.name, parsed.content, actor);
    return res;
  }

  /**
   * ADR-0027 ①：纯建议创作（非流式收口）。生成/优化 kind content + 接地后的 ref 建议。
   *
   * 内部复用 {@link proposeStream} 两阶段核，drain 后只取终态信封——供 Tool Handler / MCP 门面
   * 等不流式的消费者使用。无写副作用（只读 repo.list 取候选），失败内容返回 `valid:false` + `issues`。
   */
  async propose(tenant: number, kind: TenantDescriptorKind, req: ProposeRequest): Promise<ProposeResult> {
    let result: ProposeResult | undefined;
    for await (const ev of this.proposeStream(tenant, kind, req)) {
      if (ev.type === "proposal") result = ev.result;
    }
    if (!result) {
      throw AgenticEngineError.fromCode("INTERNAL_UNKNOWN", "propose produced no result", { kind });
    }
    return result;
  }

  /**
   * ADR-0027 §5：两阶段真流式创作。
   *  - Phase 1：`chatStream` 逐 token 生成 prose 正文 → 每个 text-delta `yield {type:'delta'}`。
   *  - Phase 2：`chat` 出结构化 refs/metadata → 接地 + 校验 → `yield {type:'proposal'}` 收尾。
   *
   * 纯只读（candidates 来自 repo.list），不落库；内容不合 schema 时终态 `valid:false` + `issues`（不抛）。
   */
  async *proposeStream(tenant: number, kind: TenantDescriptorKind, req: ProposeRequest): AsyncGenerator<ProposeStreamEvent, void, unknown> {
    if (!this.llm) {
      throw AgenticEngineError.fromCode(
        "FAILED_PRECONDITION_LLM_PROVIDER_UNAVAILABLE",
        "propose requires an LLM provider; none is configured",
        { kind },
      );
    }

    const candidates = await this.collectCandidates(tenant);
    const modelCode = authoringModelCode(req);

    // Phase 1 — prose 真流式
    let prose = "";
    try {
      for await (const chunk of this.llm.chatStream({
        tenant,
        modelCode,
        messages: buildProseMessages(kind, req),
      })) {
        if (chunk.type === "text-delta" && chunk.delta) {
          prose += chunk.delta;
          yield { type: "delta", delta: chunk.delta };
        }
      }
    } catch (e) {
      throw AgenticEngineError.fromCode(
        "UPSTREAM_LLM_UNAVAILABLE",
        `propose prose stream failed: ${e instanceof Error ? e.message : String(e)}`,
        { kind },
      );
    }
    prose = prose.trim();

    // Phase 2 — 结构化 refs/metadata
    let parsed: Record<string, unknown> | null = null;
    try {
      const res = await this.llm.chat({
        tenant,
        modelCode,
        messages: buildStructuredMessages(kind, req, prose, candidates),
      });
      parsed = tolerantJsonParse(res.content ?? "");
    } catch (e) {
      throw AgenticEngineError.fromCode(
        "UPSTREAM_LLM_UNAVAILABLE",
        `propose structured call failed: ${e instanceof Error ? e.message : String(e)}`,
        { kind },
      );
    }

    const meta = parsed && typeof parsed.meta === "object" && parsed.meta !== null ? (parsed.meta as Record<string, unknown>) : {};
    const rawSuggestions = Array.isArray(parsed?.suggestions) ? (parsed?.suggestions as unknown[]) : [];
    const candidateByRef = new Map(candidates.map((c) => [c.ref, c] as const));

    const rawContent = assembleContent(kind, req, prose, meta);
    const { content, suggestions } = groundAndInline(kind, rawContent, rawSuggestions, candidateByRef);

    const validation = CONTENT_SCHEMA[kind].safeParse(content);
    const result: ProposeResult = validation.success
      ? { content: validation.data, suggestions, valid: true }
      : {
          content,
          suggestions,
          valid: false,
          issues: validation.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
        };
    yield { type: "proposal", result };
  }

  /** 候选 ref = 系统级 registry（skill/rule/tool）+ 本租户已发布 descriptor（skill/rule/agent）。 */
  private async collectCandidates(tenant: number): Promise<ProposeCandidate[]> {
    const out: ProposeCandidate[] = [];
    const src = this.candidateSource;
    if (src) {
      out.push(...src.systemSkills(), ...src.systemRules(), ...src.systemTools());
    }
    for (const kind of ["skill", "rule", "agent"] as const) {
      let views: TenantDescriptorView[];
      try {
        views = await this.repo.list(tenant, kind);
      } catch {
        views = [];
      }
      for (const v of views) {
        if (v.status !== "published") continue;
        const meta = (v.content ?? {}) as { displayName?: unknown; description?: unknown };
        const description =
          typeof meta.description === "string" ? meta.description : typeof meta.displayName === "string" ? meta.displayName : v.name;
        out.push({ kind, ref: v.id, description });
      }
    }
    return out;
  }
}

/**
 * 硬接地（ADR-0027 §6）：丢弃任何不在候选集中的 ref（无论 LLM 内联还是 suggestions），
 * 再把存活的 suggestion ref 内联进 agent content 的对应数组。
 */
function groundAndInline(
  kind: TenantDescriptorKind,
  rawContent: Record<string, unknown>,
  rawSuggestions: unknown[],
  candidateByRef: ReadonlyMap<string, ProposeCandidate>,
): { content: Record<string, unknown>; suggestions: ProposeSuggestion[] } {
  const suggestions: ProposeSuggestion[] = [];
  for (const s of rawSuggestions) {
    if (!s || typeof s !== "object") continue;
    const rec = s as Record<string, unknown>;
    const ref = typeof rec.ref === "string" ? rec.ref : "";
    const cand = candidateByRef.get(ref);
    if (!cand) continue; // hallucinated → drop
    suggestions.push({
      kind: cand.kind,
      ref,
      rationale: typeof rec.rationale === "string" ? rec.rationale : "",
      ...(typeof rec.confidence === "number" ? { confidence: rec.confidence } : {}),
    });
  }

  if (kind !== "agent") {
    return { content: rawContent, suggestions };
  }

  const content: Record<string, unknown> = { ...rawContent };
  for (const { field, kind: refKind } of AGENT_REF_FIELDS) {
    const inlined = uniqueStrings(content[field]).filter((ref) => {
      const cand = candidateByRef.get(ref);
      return cand?.kind === refKind;
    });
    const fromSuggestions = suggestions.filter((s) => s.kind === refKind).map((s) => s.ref);
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const ref of [...inlined, ...fromSuggestions]) {
      if (!seen.has(ref)) {
        seen.add(ref);
        merged.push(ref);
      }
    }
    content[field] = merged;
  }
  return { content, suggestions };
}
