import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import Redis from "ioredis";
import { type Pool, type RowDataPacket, createPool } from "mysql2/promise";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RedisKeys } from "@cube-ai/contracts";
import {
  type EngineIntegrationProcess,
  type MysqlRedisQdrantStack,
  applyMinimalMysqlSchema,
  getFreePort,
  registerProcessShutdown,
  resolveMonorepoRootFromImporter,
  resolveShouldRunTestcontainers,
  startEngineIntegrationProcess,
  startMysqlRedisQdrant,
  stopTrackedTestcontainersIfAny,
} from "@cube-ai/test-infra";
import { type GhcloudStubHandle, type GhcloudStubScripted, startGhcloudAiAppStub } from "@cube-ai/test-infra/ghcloud-ai-app-stub";

import { BULLMQ_REDIS_PREFIX, QueueNames } from "../../src/bc/jobs/bullmq-queues";
import { TOOL_CALL_JOB_NAME } from "../../src/bc/jobs/processors/tool-call.processor";

const run = Boolean(process.env["RUN_PLATFORM_ADAPTERS_GHCLOUD_TESTCONTAINERS"]) && (await resolveShouldRunTestcontainers());
const HOOK_MS = 1_800_000;
const AGENT_ID = "1234567890123456789";
const MODEL_CODE = "stub-model";

const stackHolder: { current: MysqlRedisQdrantStack | null } = { current: null };
const engineHolder: { current: EngineIntegrationProcess | null } = { current: null };
const stubHolder: { current: GhcloudStubHandle | null } = { current: null };
const queueHolder: { current: Queue | null } = { current: null };
const poolHolder: { current: Pool | null } = { current: null };
const descriptorDirHolder: { current: string | null } = { current: null };
const agentDescriptorDirHolder: { current: string | null } = { current: null };
const localFileDirHolder: { current: string | null } = { current: null };

let sfidCounter = 1n;

if (run) {
  setDefaultTimeout(3_600_000);
  registerProcessShutdown(
    async () => {
      await stopTrackedTestcontainersIfAny();
      if (queueHolder.current) {
        await queueHolder.current.close().catch(() => {});
        queueHolder.current = null;
      }
      if (poolHolder.current) {
        await poolHolder.current.end().catch(() => {});
        poolHolder.current = null;
      }
      if (engineHolder.current) {
        await engineHolder.current.stop().catch(() => {});
        engineHolder.current = null;
      }
      if (stubHolder.current) {
        await stubHolder.current.stop().catch(() => {});
        stubHolder.current = null;
      }
      if (descriptorDirHolder.current) {
        await rm(descriptorDirHolder.current, { force: true, recursive: true }).catch(() => {});
        descriptorDirHolder.current = null;
      }
      if (agentDescriptorDirHolder.current) {
        await rm(agentDescriptorDirHolder.current, { force: true, recursive: true }).catch(() => {});
        agentDescriptorDirHolder.current = null;
      }
      if (localFileDirHolder.current) {
        await rm(localFileDirHolder.current, { force: true, recursive: true }).catch(() => {});
        localFileDirHolder.current = null;
      }
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
    },
    { exitProcessAfterSignal: true },
  );
}

function nextSfid(): string {
  const base = BigInt(Date.now()) << 22n;
  const id = (base | (sfidCounter++ & ((1n << 22n) - 1n))).toString();
  return id.padStart(19, "1").slice(-19);
}

function mockHeaders(tenant: number, userId: string) {
  return {
    Authorization: "Bearer test-token",
    "Content-Type": "application/json",
    "x-mock-tenant-id": String(tenant),
    "x-mock-user-id": userId,
  } as const;
}

function parseJsonColumn(raw: unknown): unknown {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === "object" && !Buffer.isBuffer(raw)) {
    return raw;
  }
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function writeToolDescriptors(dir: string): Promise<void> {
  const knowledgeDescriptor = {
    category: "PLATFORM",
    costEstimate: { category: "IO_LIGHT" },
    description: "knowledge query builtin for integration test",
    displayName: "platform.knowledge.query",
    execute: "builtin:platform.knowledge.query",
    inputSchema: {
      properties: {
        kbIds: { items: { type: "string" }, type: "array" },
        query: { type: "string" },
        scoreThreshold: { type: "number" },
        topK: { type: "number" },
      },
      required: ["query"],
      type: "object",
    },
    isPreset: true,
    kind: "TOOL",
    meta: {
      consent: "NEVER",
      execution: "LOCAL",
      idempotent: true,
      requiresPrincipal: "USER",
      sideEffects: [],
      timeoutMs: 10_000,
    },
    name: "platform.knowledge.query",
    outputSchema: {
      properties: {
        hits: { type: "array" },
        truncated: { type: "boolean" },
      },
      required: ["hits", "truncated"],
      type: "object",
    },
    requires: {
      oauthScope: [],
      obo: null,
      principal: "USER",
    },
    schemaVersion: 1,
    version: "1.0.0",
  };

  const flowDescriptor = {
    category: "PLATFORM",
    costEstimate: { category: "LONG_RUNNING" },
    description: "flow invoke builtin for integration test",
    displayName: "platform.flow.invoke",
    execute: "builtin:platform.flow.invoke",
    inputSchema: {
      properties: {
        flowId: { type: "string" },
        variables: { type: "object" },
      },
      required: ["flowId"],
      type: "object",
    },
    isPreset: true,
    kind: "TOOL",
    meta: {
      consent: "NEVER",
      execution: "LOCAL",
      idempotent: false,
      requiresPrincipal: "USER",
      sideEffects: ["network:flow"],
      timeoutMs: 30_000,
    },
    name: "platform.flow.invoke",
    outputSchema: {
      properties: {
        result: { type: "object" },
      },
      required: ["result"],
      type: "object",
    },
    requires: {
      oauthScope: [],
      obo: null,
      principal: "USER",
    },
    schemaVersion: 1,
    version: "1.0.0",
  };

  const flowListDescriptor = {
    category: "PLATFORM",
    costEstimate: { category: "IO_LIGHT" },
    description: "flow catalog list builtin for integration test",
    displayName: "platform.flow.list",
    execute: "builtin:platform.flow.list",
    inputSchema: {
      properties: {
        keyword: { type: "string" },
        pageNumber: { type: "number" },
        pageSize: { type: "number" },
      },
      type: "object",
    },
    isPreset: true,
    kind: "TOOL",
    meta: {
      consent: "NEVER",
      execution: "LOCAL",
      idempotent: true,
      requiresPrincipal: "USER",
      sideEffects: [],
      timeoutMs: 15_000,
    },
    name: "platform.flow.list",
    outputSchema: {
      properties: {
        flows: { type: "array" },
        pagination: { type: "object" },
      },
      required: ["flows"],
      type: "object",
    },
    requires: {
      oauthScope: [],
      obo: null,
      principal: "USER",
    },
    schemaVersion: 1,
    version: "1.0.0",
  };

  await writeFile(join(dir, "platform.knowledge.query.json"), `${JSON.stringify(knowledgeDescriptor, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "platform.flow.invoke.json"), `${JSON.stringify(flowDescriptor, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "platform.flow.list.json"), `${JSON.stringify(flowListDescriptor, null, 2)}\n`, "utf8");
}

async function writeAgentDescriptors(dir: string): Promise<void> {
  const agentDescriptor = [
    "kind: agent",
    `name: '${AGENT_ID}'`,
    "description: testcontainer multimodal smoke agent",
    "idempotent: false",
    "requiresApproval: false",
    "timeout: 120000",
    "maxDepth: 4",
    "instructions: You are a deterministic integration-test assistant.",
  ].join("\n");
  await writeFile(join(dir, `${AGENT_ID}.yaml`), `${agentDescriptor}\n`, "utf8");
}

async function createSession(baseUrl: string, tenant: number, userId: string): Promise<string> {
  const resp = await fetch(`${baseUrl}/sessions`, {
    body: JSON.stringify({ agentId: AGENT_ID, title: "ghcloud-e2e" }),
    headers: mockHeaders(tenant, userId),
    method: "POST",
  });
  expect(resp.status).toBe(201);
  const body = (await resp.json()) as { id: string };
  expect(body.id).toMatch(/^\d{19}$/u);
  return body.id;
}

async function sendTurnAndAwaitSseCompletion(args: {
  baseUrl: string;
  sessionId: string;
  tenant: number;
  userId: string;
  prompt: string;
  runtimeRefs?: { knowledgeBases?: { kbId: string; displayName?: string }[] };
}): Promise<string> {
  const ac = new AbortController();
  const streamResp = await fetch(`${args.baseUrl}/sessions/${args.sessionId}/events`, {
    headers: {
      ...mockHeaders(args.tenant, args.userId),
      Accept: "text/event-stream",
    },
    signal: ac.signal,
  });
  expect(streamResp.ok).toBe(true);
  expect(streamResp.body).not.toBeNull();

  const reader = streamResp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const turnResp = await fetch(`${args.baseUrl}/sessions/${args.sessionId}/messages`, {
    body: JSON.stringify({
      prompt: args.prompt,
      ...(args.runtimeRefs !== undefined ? { runtimeRefs: args.runtimeRefs } : {}),
    }),
    headers: mockHeaders(args.tenant, args.userId),
    method: "POST",
  });
  expect(turnResp.status).toBe(200);
  const turnBody = (await turnResp.json()) as { turnId: string };
  const turnId = turnBody.turnId;
  expect(turnId).toMatch(/^\d{19}$/u);

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buf += decoder.decode(value);
    if (
      buf.includes("event: message.delta") &&
      buf.includes("message-delta-v1") &&
      buf.includes("event: message.completed") &&
      buf.includes("message-completed-v1") &&
      buf.includes("event: turn.completed") &&
      buf.includes("turn-completed-v1") &&
      buf.includes("reasoning-step-v1") &&
      buf.includes("reasoning-delta-v1") &&
      buf.includes(turnId)
    ) {
      break;
    }
  }

  ac.abort();
  await reader.cancel().catch(() => {});

  expect(buf).toContain("event: message.delta");
  expect(buf).toContain("message-delta-v1");
  expect(buf).toContain("event: message.completed");
  expect(buf).toContain("message-completed-v1");
  expect(buf).toContain("event: turn.completed");
  expect(buf).toContain("turn-completed-v1");
  // 9 阶段骨架 + 模型 reasoning 子 step 必须以结构化事件流出。
  // ghcloud-ai-app-stub 默认在 chat-completions 响应里塞 `reasoning_content`，
  // OpenAICompatProvider 应将其映射为顶层 reasoning-delta StreamChunk，最终
  // 由 mapper emit reasoning-step-v1 + reasoning-delta-v1。
  expect(buf).toContain("event: reasoning.step");
  expect(buf).toContain("reasoning-step-v1");
  expect(buf).toContain("event: reasoning.delta");
  expect(buf).toContain("reasoning-delta-v1");
  // 默认 stub 的 reasoning 文案应在 SSE 流中可见
  expect(buf).toContain("stub reasoning trace");
  // 9 阶段 phase START（首尾各 1 个验证骨架完整）
  expect(buf).toContain('"phase":"session"');
  expect(buf).toContain('"phase":"output"');
  // 旧 turn-phase-v1 已删除：流中绝对不应再出现
  expect(buf).not.toContain("event: turn.phase");
  expect(buf).not.toContain("turn-phase-v1");
  expect(buf).toContain(turnId);
  return turnId;
}

async function uploadLocalImage(args: {
  baseUrl: string;
  tenant: number;
  userId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<{
  fileId: string;
  previewUrl: string;
  mimeType: string;
}> {
  const resp = await fetch(`${args.baseUrl}/files`, {
    body: JSON.stringify({
      fileName: args.fileName,
      mimeType: args.mimeType,
      base64: Buffer.from(args.bytes).toString("base64"),
    }),
    headers: mockHeaders(args.tenant, args.userId),
    method: "POST",
  });
  expect(resp.status).toBe(200);
  const body = (await resp.json()) as {
    fileId: string;
    previewUrl: string;
    mimeType: string;
  };
  expect(body.fileId).toMatch(/^[a-z0-9_]+$/iu);
  expect(body.previewUrl).toBe(`/files/${body.fileId}/preview`);
  expect(body.mimeType).toBe(args.mimeType);
  return body;
}

/** Upstream user turns must carry resolved vision (data:image), not file placeholders. */
function assertUpstreamChatCarriesResolvedVision(chatReqs: { body: unknown }[]): void {
  let sawBase64InUser = false;
  for (const req of chatReqs) {
    const body = req.body as {
      messages?: { role?: string; content?: unknown }[];
    } | null;
    const serialized = JSON.stringify(body ?? {});
    expect(serialized).not.toContain("[file:");
    const messages = body?.messages;
    if (!Array.isArray(messages)) {
      continue;
    }
    for (const message of messages) {
      if (message.role !== "user") {
        continue;
      }
      const content = message.content;
      if (typeof content === "string") {
        continue;
      }
      if (!Array.isArray(content)) {
        continue;
      }
      for (const part of content) {
        if (part && typeof part === "object" && (part as { type?: string }).type === "file") {
          throw new Error(`unexpanded file part in upstream user message: ${JSON.stringify(part)}`);
        }
      }
      if (JSON.stringify(content).includes("data:image/")) {
        sawBase64InUser = true;
      }
    }
  }
  expect(sawBase64InUser).toBe(true);
}

async function sendMultimodalTurnAndCollectSse(args: {
  baseUrl: string;
  sessionId: string;
  tenant: number;
  userId: string;
  body: unknown;
}): Promise<{ turnId: string; sseText: string }> {
  const ac = new AbortController();
  const streamResp = await fetch(`${args.baseUrl}/sessions/${args.sessionId}/events`, {
    headers: {
      ...mockHeaders(args.tenant, args.userId),
      Accept: "text/event-stream",
    },
    signal: ac.signal,
  });
  expect(streamResp.ok).toBe(true);
  expect(streamResp.body).not.toBeNull();

  const reader = streamResp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const turnResp = await fetch(`${args.baseUrl}/sessions/${args.sessionId}/messages`, {
    body: JSON.stringify(args.body),
    headers: mockHeaders(args.tenant, args.userId),
    method: "POST",
  });
  expect(turnResp.status).toBe(200);
  const turnBody = (await turnResp.json()) as { turnId: string };
  expect(turnBody.turnId).toMatch(/^\d{19}$/u);

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buf += decoder.decode(value);
    if (
      buf.includes("event: turn.route.resolved") &&
      buf.includes("effective-route-resolved-v1") &&
      buf.includes("event: message.completed") &&
      buf.includes("message-completed-v1") &&
      buf.includes("event: turn.completed") &&
      buf.includes("turn-completed-v1") &&
      buf.includes(turnBody.turnId)
    ) {
      break;
    }
  }

  ac.abort();
  await reader.cancel().catch(() => {});

  expect(buf).toContain("event: turn.route.resolved");
  expect(buf).toContain("effective-route-resolved-v1");
  expect(buf).toContain("event: message.completed");
  expect(buf).toContain("message-completed-v1");
  expect(buf).toContain("event: turn.completed");
  expect(buf).toContain("turn-completed-v1");
  return { sseText: buf, turnId: turnBody.turnId };
}

async function insertQueuedToolDispatchJob(args: {
  pool: Pool;
  jobId: string;
  tenant: number;
  sessionId: string;
  turnId: string;
  userId: string;
  toolName: string;
  toolArgs: unknown;
}): Promise<void> {
  const now = new Date();
  const overallDeadline = new Date(Date.now() + 3_600_000);
  const toolRef = `builtin:${args.toolName}`;
  const toolCallId = `tcall_${args.jobId}`;
  const principalSnapshot = {
    schema: "job-principal-v1",
    scopes: ["engine.use"],
    tenant: args.tenant,
    userId: args.userId,
  };

  await args.pool.query(
    `INSERT INTO jobs (
      id, tenant, session_id, turn_id, tool_call_id, user_id,
      kind, tool_ref, queue, status, attempts, max_attempts,
      timeout_ms, overall_deadline_time,
      input_snapshot_json, principal_snapshot_json,
      callback_event, requires_notification, idempotency_key, deleted,
      create_by, creator_id, creator_type, create_time,
      update_by, updater_id, updater_type, update_time
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      'TOOL', ?, ?, 'QUEUED', 0, 3,
      300000, ?,
      CAST(? AS JSON), CAST(? AS JSON),
      'job.completed', 1, ?, 0,
      ?, ?, ?, ?, ?, ?, ?, ?
    )`,
    [
      args.jobId,
      args.tenant,
      args.sessionId,
      args.turnId,
      toolCallId,
      args.userId,
      toolRef,
      QueueNames.LONG_RUNNING_JOBS,
      overallDeadline,
      JSON.stringify(args.toolArgs),
      JSON.stringify(principalSnapshot),
      `it-${args.jobId}`,
      "scheduler",
      null,
      "SYSTEM",
      now,
      "scheduler",
      null,
      "SYSTEM",
      now,
    ],
  );
}

async function waitForJobTerminal(
  pool: Pool,
  jobId: string,
  timeoutMs = 45_000,
): Promise<{
  status: string;
  result: unknown;
  errorCode: string | null;
  errorDetail: unknown;
}> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT status, result_ref_json, error_code, error_detail_json
       FROM jobs WHERE id = ? LIMIT 1`,
      [jobId],
    );
    const row = rows[0];
    if (row) {
      const status = String(row["status"] ?? "");
      if (status === "COMPLETED" || status === "FAILED" || status === "CANCELLED") {
        return {
          errorCode: row["error_code"] !== null && row["error_code"] !== undefined ? String(row["error_code"]) : null,
          errorDetail: parseJsonColumn(row["error_detail_json"]),
          result: parseJsonColumn(row["result_ref_json"]),
          status,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`waitForJobTerminal timeout: ${jobId}`);
}

async function seedUserToolGrant(pool: Pool, redisUrl: string, tenant: number, userId: string, toolName: string): Promise<void> {
  const now = new Date();
  const expire = new Date(now.getTime() + 3_600_000);
  const grantId = nextSfid();
  await pool.query(
    `INSERT INTO grants (
      id, tenant, form, grantor_type, grantor_user_id,
      subject_user_id, scope_tool_name, scope_action,
      expire_time, origin, deleted,
      create_by, create_time, update_by, update_time
    ) VALUES (?, ?, 'G_A', 'ADMIN', 'integration-admin', NULL, ?, 'ALLOW', ?, 'USER_CENTER', 0, ?, ?, ?, ?)`,
    [grantId, tenant, toolName, expire, "integration-test", now, "integration-test", now],
  );

  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null });
  await redis.connect();
  try {
    const grant = {
      createTime: now.getTime(),
      deleted: 0,
      expireTime: expire.getTime(),
      form: "G_A",
      grantorType: "ADMIN",
      grantorUserId: "integration-admin",
      id: grantId,
      origin: "USER_CENTER",
      scope: { action: "ALLOW", toolName },
      subject: {},
      tenant,
      updateTime: now.getTime(),
    };
    await redis.set(RedisKeys.authzGrantsAdmin(tenant), JSON.stringify([grant]), "EX", 300);
    await redis.del(RedisKeys.authzGrantsUser(tenant, userId), RedisKeys.authzGrantActiveTool(tenant, userId, toolName));
    await redis.publish(RedisKeys.pubsubGrantInvalidate(), JSON.stringify({ reason: "integration-test-seed", tenant, userId }));
  } finally {
    redis.disconnect();
  }
}

async function dispatchToolCallAndWait(args: {
  pool: Pool;
  queue: Queue;
  jobId: string;
  tenant: number;
  sessionId: string;
  turnId: string;
  userId: string;
  toolName: string;
  toolArgs: unknown;
}) {
  await insertQueuedToolDispatchJob(args);
  await args.queue.add(
    TOOL_CALL_JOB_NAME,
    {
      args: args.toolArgs,
      jobId: args.jobId,
      tenant: args.tenant,
      toolName: args.toolName,
    },
    { jobId: args.jobId },
  );
  return waitForJobTerminal(args.pool, args.jobId);
}

(run ? describe : describe.skip)("[testcontainers] platform-adapters-ghcloud e2e", () => {
  const scriptedBase: GhcloudStubScripted = {
    chatCompletionsResponse: {
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "stub turn completion",
            reasoning_content: "stub reasoning trace: weighing options…",
          },
        },
      ],
      created: 1_715_000_000,
      id: "chatcmpl-stub",
      model: MODEL_CODE,
      object: "chat.completion",
      usage: {
        completion_tokens: 4,
        prompt_tokens: 8,
        total_tokens: 12,
      },
    },
    flowRunResponse: {
      ok: true,
      outputs: {},
      stub: "default-sync",
    },
    knowledgeQueryResponse: {
      hits: [{ docId: "d1", kbId: "kb1", snippet: "integration", score: 0.91 }],
      truncated: false,
    },
    modelRuntimeConfig: {
      apiBaseUrl: "http://stub.invalid/v1",
      apiKey: "sk-stub",
      displayName: "Stub Model",
      endpointType: "openai",
      isFree: true,
      modelCode: MODEL_CODE,
      modelTypes: ["chat"],
      providerCode: "stub-openai",
    },
    providersResponse: [
      {
        id: "stub-openai",
        providerCode: "stub-openai",
        typeCode: "openai",
        apiBaseUrl: "http://stub.invalid/v1",
        enabled: true,
      },
    ],
  };

  beforeAll(async () => {
    const stack = await startMysqlRedisQdrant();
    try {
      await applyMinimalMysqlSchema(stack.mysqlUrl);
      stackHolder.current = stack;
    } catch (e) {
      await stack.stop();
      throw e;
    }

    const pool = createPool({
      bigNumberStrings: true,
      connectionLimit: 4,
      supportBigNumbers: true,
      uri: stack.mysqlUrl,
    });
    poolHolder.current = pool;

    const queue = new Queue(QueueNames.LONG_RUNNING_JOBS, {
      connection: { url: stack.redisUrl },
      prefix: BULLMQ_REDIS_PREFIX,
    });
    queueHolder.current = queue;

    const stub = await startGhcloudAiAppStub(scriptedBase);
    const runtimeCfg = {
      ...scriptedBase.modelRuntimeConfig,
      apiBaseUrl: `${stub.url}/v1`,
    };
    stub.setScript({
      ...scriptedBase,
      modelRuntimeConfig: runtimeCfg,
      providersResponse: [
        {
          apiBaseUrl: `${stub.url}/v1`,
          enabled: true,
          id: "stub-openai",
          providerCode: "stub-openai",
          typeCode: "openai",
        },
      ],
    });
    stubHolder.current = stub;

    const descriptorDir = await mkdtemp(join(tmpdir(), "agentic-ghcloud-tool-descriptors-"));
    await writeToolDescriptors(descriptorDir);
    descriptorDirHolder.current = descriptorDir;
    const agentDescriptorDir = await mkdtemp(join(tmpdir(), "agentic-ghcloud-agent-descriptors-"));
    await writeAgentDescriptors(agentDescriptorDir);
    agentDescriptorDirHolder.current = agentDescriptorDir;
    const localFileDir = await mkdtemp(join(tmpdir(), "agentic-local-files-"));
    localFileDirHolder.current = localFileDir;

    const port = await getFreePort();
    const repoRoot = resolveMonorepoRootFromImporter(import.meta.dir);
    const engine = await startEngineIntegrationProcess({
      extraEnv: {
        AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR: agentDescriptorDir,
        AGENTIC_ENGINE_ENABLE_JOB_WORKERS: "1",
        AGENTIC_ENGINE_LOCAL_FILE_DIR: localFileDir,
        AGENTIC_ENGINE_MODEL: MODEL_CODE,
        AGENTIC_ENGINE_OPENAI_MODEL: MODEL_CODE,
        AGENTIC_ENGINE_PLATFORM_API_BASE_URL: stub.url,
        AGENTIC_ENGINE_PLATFORM_SERVICE_TOKEN: "svc-test",
        AGENTIC_ENGINE_PROVIDER: "agentic-platform-llm-catalog",
        AGENTIC_ENGINE_TOOL_DESCRIPTOR_DIR: descriptorDir,
      },
      port,
      repoRoot,
      stack,
    });
    engineHolder.current = engine;
  }, HOOK_MS);

  afterAll(async () => {
    if (queueHolder.current) {
      await queueHolder.current.close().catch(() => {});
      queueHolder.current = null;
    }
    if (poolHolder.current) {
      await poolHolder.current.end().catch(() => {});
      poolHolder.current = null;
    }
    if (engineHolder.current) {
      await engineHolder.current.stop().catch(() => {});
      engineHolder.current = null;
    }
    if (stubHolder.current) {
      await stubHolder.current.stop().catch(() => {});
      stubHolder.current = null;
    }
    if (descriptorDirHolder.current) {
      await rm(descriptorDirHolder.current, { force: true, recursive: true }).catch(() => {});
      descriptorDirHolder.current = null;
    }
    if (agentDescriptorDirHolder.current) {
      await rm(agentDescriptorDirHolder.current, { force: true, recursive: true }).catch(() => {});
      agentDescriptorDirHolder.current = null;
    }
    if (localFileDirHolder.current) {
      await rm(localFileDirHolder.current, { force: true, recursive: true }).catch(() => {});
      localFileDirHolder.current = null;
    }
    if (stackHolder.current) {
      await stackHolder.current.stop().catch(() => {});
      stackHolder.current = null;
    }
    await stopTrackedTestcontainersIfAny();
  });

  it("platform.knowledge.query routes through Tool dispatch to stub once", async () => {
    const engine = engineHolder.current!;
    const pool = poolHolder.current!;
    const queue = queueHolder.current!;
    const stub = stubHolder.current!;
    const tenant = 92_001;
    const userId = "tc-ghcloud-user-k";

    const sessionId = await createSession(engine.baseUrl, tenant, userId);
    const turnId = await sendTurnAndAwaitSseCompletion({
      baseUrl: engine.baseUrl,
      prompt: "knowledge dispatch turn",
      runtimeRefs: {
        knowledgeBases: [{ kbId: "kb1", displayName: "Integration KB" }],
      },
      sessionId,
      tenant,
      userId,
    });

    const knowledgeReqBaseline = stub.requests.filter((r) => r.path === "/ai/knowledge/query").length;

    const dispatchJobId = nextSfid();
    const terminal = await dispatchToolCallAndWait({
      jobId: dispatchJobId,
      pool,
      queue,
      sessionId,
      tenant,
      toolArgs: { kbIds: ["kb1"], query: "how to reset password", topK: 3 },
      toolName: "platform.knowledge.query",
      turnId,
      userId,
    });

    expect(terminal.status).toBe("COMPLETED");
    const out = terminal.result as { hits?: { docId?: string }[]; truncated?: boolean };
    expect(Array.isArray(out.hits)).toBe(true);
    expect(out.hits?.[0]?.docId).toBe("d1");
    expect(out.truncated).toBe(false);

    const reqs = stub.requests.filter((r) => r.path === "/ai/knowledge/query").slice(knowledgeReqBaseline);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.headers["authorization"]).toBe("Bearer svc-test");
    const body = reqs[0]!.body as { query?: string; kbIds?: string[]; topK?: number };
    expect(body.query).toBe("how to reset password");
    expect(body.kbIds).toEqual(["kb1"]);
    expect(body.topK).toBe(3);
  });

  it("platform.flow.list routes through Tool dispatch to stub GET /ai/flows", async () => {
    const engine = engineHolder.current!;
    const pool = poolHolder.current!;
    const queue = queueHolder.current!;
    const stub = stubHolder.current!;
    const tenant = 92_003;
    const userId = "tc-ghcloud-user-l";

    const sessionId = await createSession(engine.baseUrl, tenant, userId);
    const turnId = await sendTurnAndAwaitSseCompletion({
      baseUrl: engine.baseUrl,
      prompt: "flow list dispatch turn",
      sessionId,
      tenant,
      userId,
    });

    const dispatchJobId = nextSfid();
    const terminal = await dispatchToolCallAndWait({
      jobId: dispatchJobId,
      pool,
      queue,
      sessionId,
      tenant,
      toolArgs: { keyword: "  refund  " },
      toolName: "platform.flow.list",
      turnId,
      userId,
    });

    expect(terminal.status).toBe("COMPLETED");
    const out = terminal.result as { flows?: { flowId?: string; name?: string }[] };
    expect(Array.isArray(out.flows)).toBe(true);
    expect(out.flows?.[0]?.flowId).toBe("1");
    expect(out.flows?.[0]?.name).toBe("stub-flow");

    const reqs = stub.requests.filter((r) => r.path === "/ai/flows" || r.path === "/ai/flows/");
    expect(reqs.length).toBeGreaterThanOrEqual(1);
    const hit = reqs.find((r) => r.method === "GET");
    expect(hit).toBeDefined();
    expect(hit!.headers["authorization"]).toBe("Bearer svc-test");
    expect(hit!.query).toContain("keyword=refund");
  });

  it("platform.flow.invoke returns sync result payload", async () => {
    const engine = engineHolder.current!;
    const pool = poolHolder.current!;
    const queue = queueHolder.current!;
    const stub = stubHolder.current!;
    const tenant = 92_002;
    const userId = "tc-ghcloud-user-f";
    const dispatchJobId = nextSfid();

    const runtimeCfg = {
      ...scriptedBase.modelRuntimeConfig,
      apiBaseUrl: `${stub.url}/v1`,
    };
    stub.setScript({
      ...scriptedBase,
      flowRunResponse: {
        meta: { flow: "stub" },
        ok: true,
        outputs: { x: 1 },
      },
      modelRuntimeConfig: runtimeCfg,
      providersResponse: [
        {
          apiBaseUrl: `${stub.url}/v1`,
          enabled: true,
          id: "stub-openai",
          providerCode: "stub-openai",
          typeCode: "openai",
        },
      ],
    });

    await seedUserToolGrant(pool, stackHolder.current!.redisUrl, tenant, userId, "platform.flow.invoke");

    const sessionId = await createSession(engine.baseUrl, tenant, userId);
    const turnId = await sendTurnAndAwaitSseCompletion({
      baseUrl: engine.baseUrl,
      prompt: "flow dispatch turn",
      sessionId,
      tenant,
      userId,
    });

    const terminal = await dispatchToolCallAndWait({
      jobId: dispatchJobId,
      pool,
      queue,
      sessionId,
      tenant,
      toolArgs: { flowId: "flow-1", variables: { topic: "sales" } },
      toolName: "platform.flow.invoke",
      turnId,
      userId,
    });

    expect(terminal.status).toBe("COMPLETED");
    const out = terminal.result as { result?: Record<string, unknown> };
    expect(out.result?.ok).toBe(true);
    expect(out.result?.outputs).toEqual({ x: 1 });

    const flowReqs = stub.requests.filter((r) => /^\/ai\/flows\/[^/]+\/run(?:-stream)?$/u.test(r.path));
    expect(flowReqs).toHaveLength(1);
    expect(flowReqs[0]!.headers["authorization"]).toBe("Bearer svc-test");

    const [rows] = await pool.query<RowDataPacket[]>(`SELECT id, status, result_ref_json FROM jobs WHERE id = ? LIMIT 1`, [dispatchJobId]);
    expect(rows.length).toBe(1);
    expect(String(rows[0]!["id"])).toBe(dispatchJobId);
    expect(String(rows[0]!["status"])).toBe("COMPLETED");
    const resultRef = parseJsonColumn(rows[0]!["result_ref_json"]) as {
      result?: Record<string, unknown>;
    };
    expect(resultRef.result?.ok).toBe(true);
  });

  /**
   * Full-chain smoke (tachu MultimodalResolver → engine local files → ghcloud stub Provider):
   * POST /files → image_ref turn (SSE) → upstream chat/completions carries data:image base64.
   * Runs engine via test-infra subprocess (linked @tachu/core), same code path as dev / host-binary bundle input.
   */
  it("local file upload + multimodal turn smoke preserves attachments and sends image_url upstream", async () => {
    const engine = engineHolder.current!;
    const stub = stubHolder.current!;
    const tenant = 92_004;
    const userId = "tc-ghcloud-user-mm";
    const beforeChatReqs = stub.requests.filter((r) => r.path === "/v1/chat/completions").length;

    const sessionId = await createSession(engine.baseUrl, tenant, userId);
    const uploaded = await uploadLocalImage({
      baseUrl: engine.baseUrl,
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      fileName: "tiny.png",
      mimeType: "image/png",
      tenant,
      userId,
    });

    const previewResp = await fetch(`${engine.baseUrl}${uploaded.previewUrl}`, {
      headers: mockHeaders(tenant, userId),
    });
    expect(previewResp.status).toBe(200);
    expect(previewResp.headers.get("content-type")).toContain("image/png");
    const previewBytes = new Uint8Array(await previewResp.arrayBuffer());
    expect([...previewBytes]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const { turnId, sseText } = await sendMultimodalTurnAndCollectSse({
      baseUrl: engine.baseUrl,
      body: {
        attachments: [
          {
            attachmentId: "att_01",
            kind: "image",
            fileId: uploaded.fileId,
            mimeType: "image/png",
            previewUrl: uploaded.previewUrl,
          },
        ],
        content: {
          blocks: [
            { type: "text", text: "describe this image" },
            { type: "image_ref", attachmentId: "att_01" },
          ],
          schema: "message-content-v1",
        },
      },
      sessionId,
      tenant,
      userId,
    });

    expect(sseText).toContain(turnId);

    const messagesResp = await fetch(`${engine.baseUrl}/sessions/${sessionId}/messages?limit=20`, {
      headers: mockHeaders(tenant, userId),
    });
    expect(messagesResp.status).toBe(200);
    const messagesBody = (await messagesResp.json()) as {
      items: { role: string; attachments?: { fileId?: string; previewUrl?: string }[] }[];
    };
    const userMessage = messagesBody.items.find((item) => item.role === "user");
    expect(userMessage?.attachments?.[0]?.fileId).toBe(uploaded.fileId);
    expect(userMessage?.attachments?.[0]?.previewUrl).toBe(uploaded.previewUrl);

    const chatReqs = stub.requests.filter((r) => r.path === "/v1/chat/completions").slice(beforeChatReqs);
    expect(chatReqs.length).toBeGreaterThanOrEqual(1);
    assertUpstreamChatCarriesResolvedVision(chatReqs);
    const withPng = chatReqs.find((r) => JSON.stringify(r.body ?? {}).includes("data:image/png;base64,"));
    expect(withPng).toBeDefined();
  });
});
