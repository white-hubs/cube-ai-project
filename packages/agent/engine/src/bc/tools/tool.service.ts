/**
 * ToolService — 鉴权 + 安全基线 + 按 execution 路由 handler；LONG_RUNNING 入队。
 */
import { Inject, Injectable } from "@dangao/bun-server";
import type { ExecutionContext, InputEnvelope, SafetyModule } from "@tachu/core";
import type { Logger } from "pino";

import { AGENTIC_SAFETY_MODULE_TOKEN } from "@cube-ai/agent-engine/adapters/tokens";
import type { HandlerKindValue, ToolDescriptor } from "@cube-ai/contracts";

import type { AuditLogWriter } from "../../infra/audit/audit-log.writer";
import { AUDIT_LOG_WRITER_TOKEN } from "../../infra/audit/audit.module";
import { AgenticEngineError } from "../../infra/errors/agentic-error";
import { LoggerFactory } from "../../infra/observability/logger.factory";
import { debugBodyField } from "../../infra/observability/turn-debug-log";
import { SfidService } from "../../infra/sfid/sfid.service";
import type { AuthzGatewayService } from "../authz/authz-gateway.service";
import { AUTHZ_TOKENS } from "../authz/authz.module";
import { GrantService } from "../authz/grant.service";
import { DescriptorRegistryService } from "../descriptor/descriptor-registry.service";
import { JOBS_SCHEDULER_TOKEN } from "../jobs/jobs.module";
import type { SchedulerService } from "../jobs/scheduler.service";
import { AskBusinessDataProgram } from "./biz-ontology-ask";
import type { ToolHandler, ToolHandlerInvokeOptions } from "./handlers/base-handler";
import { ClockHandler } from "./handlers/clock-handler";
import { descriptorOpFromExecute } from "./handlers/descriptor-ops";
import { DescriptorOpsHandler } from "./handlers/descriptor-ops-handler";
import { FlowHandler } from "./handlers/flow-handler";
import { FlowListHandler } from "./handlers/flow-list-handler";
import { HttpHandler } from "./handlers/http-handler";
import { KnowledgeHandler } from "./handlers/knowledge-handler";
import { LlmHandler } from "./handlers/llm-handler";
import { McpHandler } from "./handlers/mcp-handler";
import { MemoryHandler } from "./handlers/memory-handler";
import { OpenApiHandler } from "./handlers/openapi-handler";
import { QwenImageHandler } from "./handlers/qwen-image-handler";
import { SessionRecallHandler } from "./handlers/session-recall-handler";
import { ShellHandler } from "./handlers/shell-handler";
import { SqlHandler } from "./handlers/sql-handler";
import { VectorHandler } from "./handlers/vector-handler";
import type { ToolHandlerCtx } from "./tool-context";

/** 仅打日志：参数键名 + 近似体积，不落具体值（避免 PII / 密钥进日志）。 */
function summarizeArgsForLog(input: unknown): { keys: string[] | null; approxBytes: number } {
  if (input == null) return { keys: null, approxBytes: 0 };
  if (
    typeof input === "object" &&
    !Array.isArray(input) &&
    "serverId" in (input as object) &&
    "toolName" in (input as object) &&
    "arguments" in (input as object)
  ) {
    const m = input as { serverId: string; toolName: string; arguments: Record<string, unknown> };
    const argObj = m.arguments && typeof m.arguments === "object" && !Array.isArray(m.arguments) ? m.arguments : {};
    const keys = Object.keys(argObj);
    try {
      const s = JSON.stringify(argObj);
      return {
        keys: [`mcp:${m.serverId}:${m.toolName}`, ...keys].slice(0, 48),
        approxBytes: Math.min(s.length, 50_000),
      };
    } catch {
      return { keys: [`mcp:${m.serverId}:${m.toolName}`], approxBytes: 0 };
    }
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    try {
      const s = JSON.stringify(input);
      return { keys: null, approxBytes: Math.min(s.length, 50_000) };
    } catch {
      return { keys: null, approxBytes: 0 };
    }
  }
  const keys = Object.keys(input as Record<string, unknown>);
  try {
    const s = JSON.stringify(input);
    return { keys: keys.slice(0, 48), approxBytes: Math.min(s.length, 50_000) };
  } catch {
    return { keys: keys.slice(0, 48), approxBytes: 0 };
  }
}

/** 仅打日志：返回形状与体量线索，不落全文（与 logger redaction 策略一致）。 */
function summarizeResultForLog(result: unknown): Record<string, unknown> {
  if (result == null) return { shape: "nullish" };
  const t = typeof result;
  if (t === "string") return { shape: "string", chars: (result as string).length };
  if (t === "number" || t === "boolean" || t === "bigint") return { shape: t };
  if (Array.isArray(result)) return { shape: "array", length: result.length };
  if (t === "object") {
    const o = result as Record<string, unknown>;
    const keys = Object.keys(o);
    if ("content" in o && Array.isArray(o.content)) {
      const contentArr = o.content as unknown[];
      const contentItemTypes = contentArr
        .slice(0, 8)
        .map((c) =>
          c && typeof c === "object" && !Array.isArray(c) && "type" in (c as object) ? (c as { type: unknown }).type : typeof c,
        );
      const summary: Record<string, unknown> = {
        shape: "object-with-content-array",
        contentLength: contentArr.length,
        contentItemTypes,
        keysCount: keys.length,
        topKeys: keys.slice(0, 16),
      };
      if (typeof o.isError === "boolean") {
        summary.mcpIsError = o.isError;
      }
      const sc = o.structuredContent;
      if (sc && typeof sc === "object" && !Array.isArray(sc)) {
        const sk = Object.keys(sc as object);
        summary.structuredKeysCount = sk.length;
        summary.structuredTopKeys = sk.slice(0, 12);
      } else if (sc != null) {
        summary.structuredKind = typeof sc;
      }
      return summary;
    }
    return { shape: "object", keysCount: keys.length, topKeys: keys.slice(0, 16) };
  }
  return { shape: "unknown" };
}

@Injectable()
export class ToolService {
  private readonly handlerMap: Map<HandlerKindValue, ToolHandler>;
  private readonly log: Logger;

  constructor(
    private readonly registry: DescriptorRegistryService,
    httpHandler: HttpHandler,
    shellHandler: ShellHandler,
    sqlHandler: SqlHandler,
    vectorHandler: VectorHandler,
    memoryHandler: MemoryHandler,
    openApiHandler: OpenApiHandler,
    mcpHandler: McpHandler,
    private readonly askBusinessData: AskBusinessDataProgram,
    llmHandler: LlmHandler,
    flowHandler: FlowHandler,
    flowListHandler: FlowListHandler,
    knowledgeHandler: KnowledgeHandler,
    clockHandler: ClockHandler,
    sessionRecallHandler: SessionRecallHandler,
    qwenImageHandler: QwenImageHandler,
    descriptorOpsHandler: DescriptorOpsHandler,
    @Inject(AUTHZ_TOKENS.AUTHZ_GATEWAY) private readonly authz: AuthzGatewayService,
    @Inject(AUTHZ_TOKENS.GRANT_SERVICE) private readonly grantService: GrantService,
    @Inject(AGENTIC_SAFETY_MODULE_TOKEN) private readonly safety: SafetyModule,
    @Inject(JOBS_SCHEDULER_TOKEN) private readonly scheduler: SchedulerService,
    @Inject(AUDIT_LOG_WRITER_TOKEN) private readonly audit: AuditLogWriter,
    @Inject(SfidService) private readonly sfid: SfidService,
    loggerFactory: LoggerFactory,
  ) {
    this.log = loggerFactory.getLogger("agentic.engine.tools.invoke");
    this.handlerMap = new Map<HandlerKindValue, ToolHandler>([
      ["http", httpHandler],
      ["shell", shellHandler],
      ["sql", sqlHandler],
      ["vector", vectorHandler],
      ["memory", memoryHandler],
      ["openapi", openApiHandler],
      ["mcp", mcpHandler],
      ["llm", llmHandler],
      ["flow" as HandlerKindValue, flowHandler],
      ["flowList" as HandlerKindValue, flowListHandler],
      ["knowledge" as HandlerKindValue, knowledgeHandler],
      ["clock", clockHandler],
      ["sessionRecall" as HandlerKindValue, sessionRecallHandler],
      ["qwenImage" as HandlerKindValue, qwenImageHandler],
      ["descriptorOps" as HandlerKindValue, descriptorOpsHandler],
    ]);
  }

  async invoke(
    toolName: string,
    input: unknown,
    ctx: ToolHandlerCtx,
    options?: { toolCallId?: string; onProgress?: ToolHandlerInvokeOptions["onProgress"] },
  ): Promise<unknown> {
    const descriptor = this.registry.resolve(toolName);
    if (!descriptor) {
      throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_DESCRIPTOR", `Tool descriptor not found: ${toolName}`);
    }

    await this.ensureTenantAuthorization(descriptor, ctx);

    const decision = await this.authz.check({
      tenant: ctx.auth.tenant,
      userId: ctx.auth.user?.userId ?? "anonymous",
      sessionId: ctx.session.id,
      turnId: ctx.session.turnId,
      toolName,
      args: input,
      consentPolicy: descriptor.meta.consent,
    });

    if (decision.kind === "DENY") {
      await this.safeAudit("authz_deny", toolName, ctx, {
        reason: decision.reason,
        violatedGrantId: decision.violatedGrantId,
      });
      throw AgenticEngineError.fromCode("PERMISSION_DENIED_AUTHZ_AT_RUNTIME", `AuthZ denied tool ${toolName}: ${decision.reason}`);
    }
    if (decision.kind === "REQUIRE_CONSENT") {
      const userId = ctx.auth.user?.userId ?? "anonymous";
      const { grantRequestId } = await this.grantService.requestGrant({
        tenant: ctx.auth.tenant,
        userId,
        toolName,
        sessionId: ctx.session.id,
        turnId: ctx.session.turnId,
        toolCallId: options?.toolCallId,
        scopeHint: decision.scopeHint,
      });
      const resolution = await this.grantService.waitForGrantResolution({
        grantRequestId,
        tenant: ctx.auth.tenant,
        userId,
        toolName,
      });
      if (resolution === "APPROVED") {
        await this.safeAudit("authz_consent_approved", toolName, ctx, { grantRequestId });
      } else {
        await this.safeAudit("authz_consent_denied", toolName, ctx, {
          grantRequestId,
          resolution,
        });
        throw AgenticEngineError.fromCode(
          "PERMISSION_DENIED_GRANT_MISSING",
          resolution === "DENIED" ? `User denied consent for ${toolName}` : `Consent request timed out for ${toolName}`,
        );
      }
    }

    await this.runSafetyReview(descriptor, input, ctx);

    if (descriptor.execute === "mcp:biz-ontology:ask_business_data") {
      const toolCallId = options?.toolCallId;
      return this.askBusinessData.invoke(input, ctx, {
        ...(toolCallId ? { progressToken: toolCallId } : {}),
        ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
      });
    }

    const kind = this.inferHandlerKind(descriptor);
    if (!kind) {
      throw AgenticEngineError.fromCode(
        "UNIMPLEMENTED_TOOL_HANDLER",
        `Cannot infer handler kind for tool ${toolName} (execute=${descriptor.execute})`,
      );
    }

    const handler = this.handlerMap.get(kind);
    if (!handler) {
      throw AgenticEngineError.fromCode("UNIMPLEMENTED_TOOL_HANDLER", `No handler registered for kind: ${kind}`);
    }

    if (descriptor.meta.execution === "LONG_RUNNING") {
      const toolCallId = options?.toolCallId ?? this.sfid.next();
      const argDbg = summarizeArgsForLog(input);
      this.log.debug(
        {
          phase: "scheduled",
          toolName,
          toolCallId,
          handlerKind: kind,
          tenant: ctx.auth.tenant,
          sessionId: ctx.session.id,
          turnId: ctx.session.turnId,
          traceId: ctx.traceId,
          executeRef: descriptor.execute,
          argKeys: argDbg.keys,
          argsApproxBytes: argDbg.approxBytes,
        },
        "tool.invoke.scheduled",
      );
      const { jobId } = await this.scheduler.enqueueToolCall({
        toolCallId,
        toolName,
        tenant: ctx.auth.tenant,
        sessionId: ctx.session.id,
        turnId: ctx.session.turnId,
        args: input,
        traceId: ctx.traceId,
      });
      await this.safeAudit("scheduled", toolName, ctx, { jobId, toolCallId });
      return {
        scheduled: true,
        jobId,
        statusUrl: `/jobs/${jobId}`,
      };
    }

    try {
      const handlerInput = this.adaptHandlerInput(descriptor, kind, input);
      const toolCallId = options?.toolCallId ?? null;
      const argDbg = summarizeArgsForLog(handlerInput);
      this.log.debug(
        {
          phase: "start",
          toolName,
          toolCallId,
          handlerKind: kind,
          tenant: ctx.auth.tenant,
          sessionId: ctx.session.id,
          turnId: ctx.session.turnId,
          traceId: ctx.traceId,
          executeRef: descriptor.execute,
          argKeys: argDbg.keys,
          argsApproxBytes: argDbg.approxBytes,
          ...debugBodyField("argsBody", handlerInput),
        },
        "tool.invoke.start",
      );
      const result = await handler.invoke(handlerInput, ctx, {
        ...(toolCallId ? { toolCallId } : {}),
        ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
      });
      this.log.debug(
        {
          phase: "ok",
          toolName,
          toolCallId,
          handlerKind: kind,
          tenant: ctx.auth.tenant,
          sessionId: ctx.session.id,
          turnId: ctx.session.turnId,
          traceId: ctx.traceId,
          resultSummary: summarizeResultForLog(result),
          ...debugBodyField("resultBody", result),
        },
        "tool.invoke.completed",
      );
      await this.safeAudit("completed", toolName, ctx, { ok: true });
      return result;
    } catch (e) {
      const errPayload =
        e instanceof AgenticEngineError
          ? { code: e.code, message: e.message, category: e.category }
          : { message: e instanceof Error ? e.message : String(e) };
      this.log.warn(
        {
          phase: "error",
          toolName,
          toolCallId: options?.toolCallId ?? null,
          handlerKind: kind,
          tenant: ctx.auth.tenant,
          sessionId: ctx.session.id,
          turnId: ctx.session.turnId,
          traceId: ctx.traceId,
          err: errPayload,
        },
        "tool.invoke.failed",
      );
      await this.safeAudit("failed", toolName, ctx, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  private async ensureTenantAuthorization(d: ToolDescriptor, ctx: ToolHandlerCtx): Promise<void> {
    if (d.isPreset === false && d.execute.startsWith("ext:")) {
      const tenantMatch = d.execute.startsWith(`ext:${ctx.auth.tenant}:`);
      if (!tenantMatch) {
        throw AgenticEngineError.fromCode("PERMISSION_DENIED_GRANT_MISSING", `Tool does not belong to tenant ${ctx.auth.tenant}`);
      }
    }
  }

  private async runSafetyReview(descriptor: ToolDescriptor, input: unknown, ctx: ToolHandlerCtx): Promise<void> {
    const envelope: InputEnvelope = {
      content: JSON.stringify({ tool: descriptor.name, args: input }),
      metadata: { source: "tool.invoke" },
    };
    const execCtx: ExecutionContext = {
      correlation: {
        traceId: ctx.traceId,
        requestId: ctx.traceId,
        sessionId: ctx.session.id,
        turnId: ctx.session.turnId,
      },
      principal: {
        tenant: ctx.auth.tenant,
        ...(ctx.auth.user?.userId ? { userId: ctx.auth.user.userId } : {}),
      },
      subject: {
        tenant: String(ctx.auth.tenant),
        ...(ctx.auth.user?.userId ? { userId: ctx.auth.user.userId } : {}),
      },
      budget: {},
      scopes: ctx.auth.user?.scopes ?? [],
      abortSignal: ctx.signal,
    };

    // TODO(P3-10): GAP-01 — SafetyModule.checkBaseline has no ToolDescriptor; future alpha.2 may add ctx extension
    const baseline = await this.safety.checkBaseline(envelope, execCtx);
    if (!baseline.passed) {
      const first = baseline.violations.find((v) => v.severity === "error");
      throw AgenticEngineError.fromCode("INVALID_ARGUMENT_SAFETY_REJECTED", first?.message ?? "Tool input rejected by safety review", {
        violations: baseline.violations,
      });
    }
  }

  private async safeAudit(eventSuffix: string, toolName: string, ctx: ToolHandlerCtx, payload: Record<string, unknown>): Promise<void> {
    try {
      const sfidOk = (s: string) => /^\d{19}$/.test(s);
      const outcome = eventSuffix === "authz_deny" ? "DENIED" : eventSuffix === "failed" ? "FAILURE" : "SUCCESS";
      await this.audit.write({
        eventType: `tool.invoke.${eventSuffix}`,
        eventSchema: "audit-tool-invoke-v1",
        severity: 2,
        actor: {
          userId: ctx.auth.user?.userId ?? null,
          agentId: ctx.auth.service?.clientId ?? null,
          tenant: ctx.auth.tenant,
          principalType: ctx.auth.user ? "USER" : "SERVICE",
        },
        traceId: ctx.traceId,
        sessionId: sfidOk(ctx.session.id) ? ctx.session.id : null,
        turnId: sfidOk(ctx.session.turnId) ? ctx.session.turnId : null,
        toolCallId: null,
        jobId: typeof payload["jobId"] === "string" && sfidOk(payload["jobId"] as string) ? (payload["jobId"] as string) : null,
        grantRequestId: null,
        subject: toolName,
        outcome,
        payloadJson: { ...payload, traceId: ctx.traceId },
        ipAddress: null,
        userAgent: null,
      });
    } catch {
      /* audit best-effort — schema / tenant context may be unavailable in tests */
    }
  }

  private inferHandlerKind(descriptor: { execute: string; handler?: { kind: HandlerKindValue } }): HandlerKindValue | null {
    if (descriptor.handler?.kind) return descriptor.handler.kind;

    if (descriptor.execute.startsWith("mcp:")) return "mcp";

    if (descriptor.execute === "builtin:engine.current_date") return "clock";

    if (descriptor.execute === "builtin:engine.session_recall") return "sessionRecall" as HandlerKindValue;

    if (descriptor.execute === "builtin:engine.image_qwen") return "qwenImage" as HandlerKindValue;

    if (descriptor.execute.includes("memory")) return "memory";

    if (descriptor.execute === "builtin:platform.flow.invoke") return "flow" as HandlerKindValue;
    if (descriptor.execute === "builtin:platform.flow.list" || descriptor.execute === "ext:platform.flow.list") {
      return "flowList" as HandlerKindValue;
    }
    if (descriptor.execute === "builtin:platform.knowledge.query") return "knowledge" as HandlerKindValue;
    if (descriptor.execute.startsWith("builtin:platform.descriptor.")) {
      return "descriptorOps" as HandlerKindValue;
    }
    if (descriptor.execute.startsWith("builtin:platform.")) return "http";

    return null;
  }

  getRegisteredKinds(): HandlerKindValue[] {
    return Array.from(this.handlerMap.keys());
  }

  private adaptHandlerInput(descriptor: { execute: string }, kind: HandlerKindValue, input: unknown): unknown {
    if (kind === "flow") {
      return this.normalizeFlowHandlerInput(input);
    }
    if (kind === "descriptorOps") {
      const op = descriptorOpFromExecute(descriptor.execute);
      if (!op) {
        throw AgenticEngineError.fromCode(
          "INVALID_ARGUMENT_DESCRIPTOR_EXECUTE_REF",
          `Invalid descriptor management execute ref: ${descriptor.execute}`,
        );
      }
      const args = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
      return { op, args };
    }
    if (kind !== "mcp") return input;

    const match = /^mcp:([^:]+):(.+)$/.exec(descriptor.execute);
    if (!match) {
      throw AgenticEngineError.fromCode("INVALID_ARGUMENT_DESCRIPTOR_EXECUTE_REF", `Invalid MCP execute ref: ${descriptor.execute}`);
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw AgenticEngineError.fromCode("INVALID_ARGUMENT_SCHEMA_VIOLATION", "MCP tool arguments must be a JSON object");
    }

    return {
      serverId: match[1]!,
      toolName: match[2]!,
      arguments: input as Record<string, unknown>,
    };
  }

  /** Accept legacy LLM args (`flowCode` / `input`) until all descriptors are repinned. */
  private normalizeFlowHandlerInput(input: unknown): {
    flowId?: string;
    variables?: Record<string, unknown>;
  } {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return input as { flowId?: string; variables?: Record<string, unknown> };
    }

    const raw = input as Record<string, unknown>;
    const flowIdCandidate =
      typeof raw.flowId === "string" && raw.flowId.trim()
        ? raw.flowId.trim()
        : typeof raw.flowCode === "string" && raw.flowCode.trim()
          ? raw.flowCode.trim()
          : undefined;
    const variablesSource = raw.variables !== undefined ? raw.variables : raw.input;
    const variables =
      variablesSource !== undefined && variablesSource !== null && typeof variablesSource === "object" && !Array.isArray(variablesSource)
        ? (variablesSource as Record<string, unknown>)
        : undefined;

    return {
      ...(flowIdCandidate !== undefined ? { flowId: flowIdCandidate } : {}),
      ...(variables !== undefined ? { variables } : {}),
    };
  }
}
