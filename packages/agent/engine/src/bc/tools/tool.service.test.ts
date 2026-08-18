import type { SafetyModule, VectorIndexAdapter, ProviderAdapter, AdapterCallContext } from "@tachu/core";
/**
 * ToolService 单测 — 鉴权 / 安全 / LONG_RUNNING / 路由。
 */
import { describe, test, expect, beforeEach } from "bun:test";

import { TurnAwareEmbeddingRuntime } from "@cube-ai/agent-engine/adapters/embedding";
import { InMemoryStore } from "@cube-ai/agent-engine/adapters/memory";
import { NoopLLMProviderAdapter } from "@cube-ai/agent-engine/adapters/provider";
import type { ToolDescriptor } from "@cube-ai/contracts";
import type { FlowInvokerPort } from "@cube-ai/contracts";
import type { FlowCatalogPort } from "@cube-ai/contracts";
import type { KnowledgeQueryPort } from "@cube-ai/contracts";

import type { AuditLogWriter } from "../../infra/audit/audit-log.writer";
import { AgenticEngineError } from "../../infra/errors/agentic-error";
import { LoggerFactory } from "../../infra/observability/logger.factory";
import { SfidService } from "../../infra/sfid/sfid.service";
import type { AuthzGatewayService } from "../authz/authz-gateway.service";
import type { GrantService } from "../authz/grant.service";
import type { DescriptorManagementService } from "../descriptor/descriptor-management.service";
import { DescriptorRegistryService } from "../descriptor/descriptor-registry.service";
import type { ToolEffectiveVersionSource } from "../descriptor/tool-effective-version.provider";
import type { SchedulerService } from "../jobs/scheduler.service";
import { ClockHandler } from "./handlers/clock-handler";
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
import { McpBridgeService } from "./mcp-bridge.service";
import type { ToolHandlerCtx } from "./tool-context";
import { ToolService } from "./tool.service";

const noopPin: ToolEffectiveVersionSource = {
  refreshFromNacos: async () => {},
  getPinnedVersion: async () => undefined,
};

function makeDescriptor(override: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return {
    schemaVersion: 1,
    kind: "TOOL",
    name: "platform.file.read",
    displayName: "读取文件",
    isPreset: true,
    version: "1.0.0",
    meta: {
      execution: "LOCAL",
      consent: "NEVER",
      requiresPrincipal: "USER",
      timeoutMs: 15000,
      idempotent: true,
      sideEffects: ["read:platform.file"],
    },
    inputSchema: { type: "object", properties: { fileId: { type: "string" } } },
    outputSchema: { type: "object", properties: { content: { type: "string" } } },
    requires: { principal: "USER", oauthScope: ["file.read"], obo: { audience: "app.file" } },
    execute: "builtin:platform.file.read",
    handler: { kind: "http", config: {} },
    ...override,
  } as ToolDescriptor;
}

const MOCK_CTX: ToolHandlerCtx = {
  traceId: "test-trace-001",
  signal: new AbortController().signal,
  auth: { tenant: 1, user: { userId: "123", scopes: ["file.read"] } },
  session: { id: "1234567890123456789", turnId: "1234567890123456788" },
};

function makeVectorFake(): { vectorIndex: VectorIndexAdapter; embedding: TurnAwareEmbeddingRuntime } {
  const turnCtx: AdapterCallContext = {
    correlation: {
      traceId: "t",
      requestId: "t",
      sessionId: MOCK_CTX.session.id,
      turnId: MOCK_CTX.session.turnId,
    },
    tenant: MOCK_CTX.auth.tenant,
  };
  const provider: ProviderAdapter = {
    id: "test",
    name: "Test",
    async listAvailableModels() {
      return [];
    },
    async chat() {
      return { content: "ok", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    },
    async *chatStream() {
      yield { type: "text-delta", delta: "ok" } as const;
      yield { type: "finish", finishReason: "stop" } as const;
    },
    async embed() {
      return { embeddings: [[1, 0, 0]] };
    },
  };
  const embedding = new TurnAwareEmbeddingRuntime({
    embeddingPort: {
      dimension: 3,
      async embed(inputs) {
        return inputs.map(() => ({ dense: [1, 0, 0], sparse: null }));
      },
    },
    defaultModel: "embed",
    getTurnContext: () => turnCtx,
    resolveModelCode: () => "embed",
  });
  const vectorIndex: VectorIndexAdapter = {
    async upsert() {},
    async searchVector() {
      return [{ id: "a", score: 0.9, metadata: {} }];
    },
    async delete() {},
  };
  return { vectorIndex, embedding };
}

function makeMemoryFake() {
  const { vectorIndex, embedding } = makeVectorFake();
  return {
    memory: new InMemoryStore(),
    vectorIndex,
    embedding,
  };
}

function buildToolService(
  registry: DescriptorRegistryService,
  opts?: {
    authz?: Pick<AuthzGatewayService, "check">;
    grantService?: Pick<GrantService, "requestGrant" | "waitForGrantResolution">;
    safety?: Pick<SafetyModule, "checkBaseline">;
    scheduler?: Pick<SchedulerService, "enqueueToolCall">;
    audit?: Pick<AuditLogWriter, "write">;
    mcpBridge?: Pick<McpBridgeService, "callTool">;
    flowPort?: FlowInvokerPort;
    descriptorSvc?: Partial<DescriptorManagementService>;
  },
): ToolService {
  const safety: Pick<SafetyModule, "checkBaseline"> = opts?.safety ?? {
    checkBaseline: async () => ({ passed: true, violations: [] }),
  };
  const authz = opts?.authz ?? {
    check: async () => ({ kind: "ALLOW", reason: "policy_never" }) as Awaited<ReturnType<AuthzGatewayService["check"]>>,
  };
  const grantService: Pick<GrantService, "requestGrant" | "waitForGrantResolution"> = opts?.grantService ?? {
    requestGrant: async () => ({ grantRequestId: "mock-grant-request-id" }),
    waitForGrantResolution: async () => "APPROVED" as const,
  };
  const scheduler = opts?.scheduler ?? {
    enqueueToolCall: async () => ({ jobId: "1234567890123456789" }),
  };
  const audit = opts?.audit ?? { write: async () => {} };
  const flowPort: FlowInvokerPort = opts?.flowPort ?? {
    invoke: async () => ({
      result: { ok: true, stub: true },
    }),
  };
  const knowledgePort: KnowledgeQueryPort = {
    query: async () => ({ hits: [], truncated: false }),
  };
  const flowCatalogPort: FlowCatalogPort = {
    list: async () => ({ flows: [] }),
  };

  const qwenImageHandler = new QwenImageHandler({
    listProviders: async () => [],
    resolveModelRuntime: async () => null,
  });

  const { vectorIndex, embedding } = makeVectorFake();
  const { memory } = makeMemoryFake();

  return new ToolService(
    registry,
    new HttpHandler(),
    new ShellHandler(safety as SafetyModule),
    new SqlHandler(),
    new VectorHandler(vectorIndex, embedding),
    new MemoryHandler(memory, vectorIndex, embedding),
    new OpenApiHandler(),
    new McpHandler((opts?.mcpBridge ?? new McpBridgeService()) as McpBridgeService),
    new LlmHandler(new NoopLLMProviderAdapter()),
    new FlowHandler(flowPort),
    new FlowListHandler(flowCatalogPort),
    new KnowledgeHandler(knowledgePort),
    new ClockHandler(),
    new SessionRecallHandler({ listBySession: async () => [] }),
    qwenImageHandler,
    new DescriptorOpsHandler((opts?.descriptorSvc ?? {}) as unknown as DescriptorManagementService),
    authz as AuthzGatewayService,
    grantService as GrantService,
    safety as SafetyModule,
    scheduler as SchedulerService,
    audit as AuditLogWriter,
    new SfidService(),
    new LoggerFactory(),
  );
}

describe("ToolService", () => {
  let registry: DescriptorRegistryService;
  let service: ToolService;

  beforeEach(() => {
    registry = new DescriptorRegistryService(noopPin);
    service = buildToolService(registry);
  });

  test("descriptor 不存在 → RESOURCE_NOT_FOUND_DESCRIPTOR", async () => {
    await expect(service.invoke("non.existent", {}, MOCK_CTX)).rejects.toThrow(AgenticEngineError);
    try {
      await service.invoke("non.existent", {}, MOCK_CTX);
    } catch (e) {
      expect((e as AgenticEngineError).code).toContain("RESOURCE_NOT_FOUND");
    }
  });

  test("AuthZ ALLOW + http handler：非法 URL → INVALID_ARGUMENT", async () => {
    registry.register(makeDescriptor({ handler: { kind: "http", config: {} } }));
    await expect(service.invoke("platform.file.read", { url: ":::not-a-url", method: "GET" }, MOCK_CTX)).rejects.toThrow(
      AgenticEngineError,
    );
  });

  test("路由 shell：echo 成功返回 exitCode 0", async () => {
    registry.register(
      makeDescriptor({
        name: "platform.shell.echo",
        execute: "builtin:platform.shell.echo",
        handler: { kind: "shell", config: {} },
      }),
    );
    const out = await service.invoke("platform.shell.echo", { command: "echo", args: ["hi"] }, MOCK_CTX);
    expect(out).toMatchObject({ exitCode: 0 });
    expect(String((out as { stdout: string }).stdout).trim()).toBe("hi");
  });

  test("LONG_RUNNING → 返回 scheduled + jobId（走 scheduler 入队）", async () => {
    let enq = false;
    const svc = buildToolService(registry, {
      scheduler: {
        enqueueToolCall: async () => {
          enq = true;
          return { jobId: "9876543210987654321" };
        },
      },
    });
    registry.register(
      makeDescriptor({
        meta: {
          execution: "LONG_RUNNING",
          consent: "NEVER",
          requiresPrincipal: "USER",
          timeoutMs: 600000,
          idempotent: false,
          sideEffects: [],
        },
        outputSchema: {
          type: "object",
          required: ["scheduled", "jobId"],
          properties: {
            scheduled: { const: true },
            jobId: { type: "string" },
          },
        },
        handler: { kind: "http", config: {} },
      }),
    );
    const r = await svc.invoke("platform.file.read", { x: 1 }, MOCK_CTX, {
      toolCallId: "tcall_test",
    });
    expect(enq).toBe(true);
    expect(r).toMatchObject({
      scheduled: true,
      jobId: "9876543210987654321",
    });
  });

  test("AuthZ DENY → PERMISSION_DENIED_AUTHZ_AT_RUNTIME", async () => {
    const svc = buildToolService(registry, {
      authz: {
        check: async () => ({
          kind: "DENY",
          reason: "admin_deny",
          violatedGrantId: "gr_1",
        }),
      },
    });
    registry.register(makeDescriptor());
    await expect(svc.invoke("platform.file.read", {}, MOCK_CTX)).rejects.toMatchObject({
      code: "PERMISSION_DENIED_AUTHZ_AT_RUNTIME",
    });
  });

  test("REQUIRE_CONSENT → requestGrant + waitForGrantResolution → APPROVED → tool executes", async () => {
    const requestGrantCalls: unknown[] = [];
    const svc = buildToolService(registry, {
      authz: {
        check: async () => ({
          kind: "REQUIRE_CONSENT" as const,
          reason: "policy_on_first_use" as const,
          scopeHint: "PERSISTENT" as const,
        }),
      },
      grantService: {
        requestGrant: async (input) => {
          requestGrantCalls.push(input);
          return { grantRequestId: "gr-req-001" };
        },
        waitForGrantResolution: async () => "APPROVED" as const,
      },
    });
    registry.register(makeDescriptor({ handler: { kind: "clock", config: {} }, execute: "builtin:engine.current_date" }));
    const result = await svc.invoke("platform.file.read", {}, MOCK_CTX);
    expect(result).toBeDefined();
    expect(requestGrantCalls).toHaveLength(1);
    expect(requestGrantCalls[0]).toMatchObject({
      toolName: "platform.file.read",
      scopeHint: "PERSISTENT",
      tenant: 1,
      userId: "123",
    });
  });

  test("REQUIRE_CONSENT → DENIED → PERMISSION_DENIED_GRANT_MISSING", async () => {
    const svc = buildToolService(registry, {
      authz: {
        check: async () => ({
          kind: "REQUIRE_CONSENT" as const,
          reason: "policy_each_call" as const,
          scopeHint: "ONCE" as const,
        }),
      },
      grantService: {
        requestGrant: async () => ({ grantRequestId: "gr-req-002" }),
        waitForGrantResolution: async () => "DENIED" as const,
      },
    });
    registry.register(makeDescriptor());
    await expect(svc.invoke("platform.file.read", {}, MOCK_CTX)).rejects.toMatchObject({
      code: "PERMISSION_DENIED_GRANT_MISSING",
    });
  });

  test("REQUIRE_CONSENT → TIMEOUT → PERMISSION_DENIED_GRANT_MISSING", async () => {
    const svc = buildToolService(registry, {
      authz: {
        check: async () => ({
          kind: "REQUIRE_CONSENT" as const,
          reason: "policy_on_first_use" as const,
          scopeHint: "PERSISTENT" as const,
        }),
      },
      grantService: {
        requestGrant: async () => ({ grantRequestId: "gr-req-003" }),
        waitForGrantResolution: async () => "TIMEOUT" as const,
      },
    });
    registry.register(makeDescriptor());
    await expect(svc.invoke("platform.file.read", {}, MOCK_CTX)).rejects.toMatchObject({
      code: "PERMISSION_DENIED_GRANT_MISSING",
    });
  });

  test("安全基线失败 → INVALID_ARGUMENT_SAFETY_REJECTED", async () => {
    const svc = buildToolService(registry, {
      safety: {
        checkBaseline: async () => ({
          passed: false,
          violations: [
            {
              policyId: "baseline/test",
              severity: "error",
              message: "blocked",
            },
          ],
        }),
      },
    });
    registry.register(makeDescriptor());
    await expect(svc.invoke("platform.file.read", {}, MOCK_CTX)).rejects.toThrow(AgenticEngineError);
  });

  test("MCP descriptor 原始参数通过 execute ref 适配为 bridge.callTool(server, tool, args)", async () => {
    const calls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }> = [];
    const svc = buildToolService(registry, {
      mcpBridge: {
        callTool: async (serverId, toolName, args) => {
          calls.push({ serverId, toolName, args });
          return { results: [{ title: "ok" }] };
        },
      },
    });
    registry.register(
      makeDescriptor({
        name: "mcp.web-search.search",
        displayName: "Web Search",
        isPreset: false,
        meta: {
          execution: "REMOTE",
          consent: "NEVER",
          requiresPrincipal: "USER",
          timeoutMs: 120000,
          idempotent: true,
          sideEffects: ["read:web.search"],
        },
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
        outputSchema: {
          type: "object",
          properties: { results: { type: "array" } },
        },
        requires: { principal: "USER", oauthScope: [], obo: null },
        execute: "mcp:web-search:search",
        handler: { kind: "mcp", config: {} },
        category: "MCP",
      }),
    );

    const out = await svc.invoke("mcp.web-search.search", { query: "cube ai" }, MOCK_CTX);

    expect(out).toEqual({ results: [{ title: "ok" }] });
    expect(calls).toEqual([
      {
        serverId: "web-search",
        toolName: "search",
        args: { query: "cube ai" },
      },
    ]);
  });

  test("MCP descriptor → ToolService 将 toolCallId/onProgress 透传给 McpBridge progress options", async () => {
    const onProgress = () => {};
    const calls: Array<{
      serverId: string;
      toolName: string;
      args: Record<string, unknown>;
      progress?: { progressToken?: string | number; onProgress?: unknown };
    }> = [];
    const svc = buildToolService(registry, {
      mcpBridge: {
        callTool: async (serverId, toolName, args, _callIdentity, progress) => {
          calls.push({ serverId, toolName, args, progress });
          return { ok: true };
        },
      },
    });
    registry.register(
      makeDescriptor({
        name: "mcp.biz-ontology.ask_business_data",
        displayName: "Ask Business Data",
        isPreset: false,
        meta: {
          execution: "REMOTE",
          consent: "NEVER",
          requiresPrincipal: "USER",
          timeoutMs: 120000,
          idempotent: true,
          sideEffects: ["read:business.data"],
        },
        inputSchema: {
          type: "object",
          properties: { question: { type: "string" } },
        },
        outputSchema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
        },
        requires: { principal: "USER", oauthScope: [], obo: null },
        execute: "mcp:biz-ontology:ask_business_data",
        handler: { kind: "mcp", config: {} },
        category: "MCP",
      }),
    );

    const out = await svc.invoke(
      "mcp.biz-ontology.ask_business_data",
      { question: "风险等级有哪些？" },
      MOCK_CTX,
      { toolCallId: "tcall_biz_1", onProgress },
    );

    expect(out).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      serverId: "biz-ontology",
      toolName: "ask_business_data",
      args: { question: "风险等级有哪些？" },
      progress: { progressToken: "tcall_biz_1" },
    });
    expect(calls[0]?.progress?.onProgress).toBe(onProgress);
  });

  test("currentDate：{} 参数返回 { iso, epochMs }（UTC toISOString）", async () => {
    registry.register(
      makeDescriptor({
        name: "currentDate",
        displayName: "Current time (UTC)",
        execute: "builtin:engine.current_date",
        handler: { kind: "clock", config: {} },
        inputSchema: { type: "object", properties: {} },
        outputSchema: {
          type: "object",
          properties: {
            iso: { type: "string" },
            epochMs: { type: "integer" },
          },
        },
        requires: { principal: "USER", oauthScope: [], obo: null },
        meta: {
          execution: "LOCAL",
          consent: "NEVER",
          requiresPrincipal: "USER",
          timeoutMs: 5000,
          idempotent: true,
          sideEffects: ["read:engine.clock"],
        },
      }),
    );
    const before = Date.now();
    const out = await service.invoke("currentDate", {}, MOCK_CTX);
    const after = Date.now();
    expect(out && typeof out === "object" && !Array.isArray(out)).toBe(true);
    const typed = out as { iso: string; epochMs: number };
    expect(typeof typed.iso).toBe("string");
    expect(typeof typed.epochMs).toBe("number");
    expect(typed.iso).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(new Date(typed.iso).getTime()).toBe(typed.epochMs);
    expect(typed.epochMs).toBeGreaterThanOrEqual(before - 1);
    expect(typed.epochMs).toBeLessThanOrEqual(after + 1);
  });

  test("getRegisteredKinds 返回 15 个 handler", () => {
    expect(service.getRegisteredKinds()).toHaveLength(15);
  });

  test("descriptorOps：execute ref → op 适配，tenant 取自 ctx 派发到管理 service", async () => {
    const createCalls: Array<{ tenant: number; kind: string }> = [];
    const svc = buildToolService(registry, {
      descriptorSvc: {
        create: (async (tenant: number, kind: string) => {
          createCalls.push({ tenant, kind });
          return { id: "agt_1", status: "draft" };
        }) as unknown as DescriptorManagementService["create"],
      },
    });
    registry.register(
      makeDescriptor({
        name: "platform.descriptor.create",
        displayName: "Create descriptor",
        execute: "builtin:platform.descriptor.create",
        handler: { kind: "descriptorOps", config: {} },
        inputSchema: {
          type: "object",
          properties: { kind: { type: "string" }, name: { type: "string" }, content: { type: "object" } },
        },
        outputSchema: { type: "object", properties: {} },
        requires: { principal: "USER", oauthScope: [], obo: null },
      }),
    );

    const out = await svc.invoke("platform.descriptor.create", { kind: "agent", name: "a", content: { prompt: "p" } }, MOCK_CTX);
    expect(out).toMatchObject({ status: "draft" });
    expect(createCalls).toEqual([{ tenant: 1, kind: "agent" }]);
  });

  test("platform.flow.invoke accepts flowId+variables", async () => {
    const calls: Array<{ flowId?: string; variables?: Record<string, unknown> }> = [];
    const svc = buildToolService(registry, {
      flowPort: {
        invoke: async (req) => {
          calls.push({ flowId: req.flowId, variables: req.variables });
          return { result: { ok: true } };
        },
      },
    });
    registry.register(
      makeDescriptor({
        name: "platform.flow.invoke",
        execute: "builtin:platform.flow.invoke",
        handler: undefined,
        inputSchema: {
          type: "object",
          required: ["flowId"],
          properties: {
            flowId: { type: "string" },
            variables: { type: "object", additionalProperties: true },
          },
        },
      }),
    );

    const out = await svc.invoke(
      "platform.flow.invoke",
      { flowId: "2056623887579381760", variables: { prompt: "一只可爱的小猫" } },
      MOCK_CTX,
    );
    expect((out as { result?: { ok?: boolean } }).result?.ok).toBe(true);
    expect(calls).toEqual([{ flowId: "2056623887579381760", variables: { prompt: "一只可爱的小猫" } }]);
  });

  test("platform.flow.invoke maps legacy flowCode+input args from LLM tool calls", async () => {
    const calls: Array<{ flowId?: string; variables?: Record<string, unknown> }> = [];
    const svc = buildToolService(registry, {
      flowPort: {
        invoke: async (req) => {
          calls.push({ flowId: req.flowId, variables: req.variables });
          return { result: { ok: true } };
        },
      },
    });
    registry.register(
      makeDescriptor({
        name: "platform.flow.invoke",
        execute: "builtin:platform.flow.invoke",
        handler: undefined,
        inputSchema: {
          type: "object",
          required: ["flowCode"],
          properties: {
            flowCode: { type: "string" },
            input: { type: "object", additionalProperties: true },
          },
        },
      }),
    );

    const out = await svc.invoke("platform.flow.invoke", { flowCode: "测试文生图", input: { prompt: "一只可爱的小猫" } }, MOCK_CTX);
    expect((out as { result?: { ok?: boolean } }).result?.ok).toBe(true);
    expect(calls).toEqual([{ flowId: "测试文生图", variables: { prompt: "一只可爱的小猫" } }]);
  });
});
