import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import {
  type EngineIntegrationProcess,
  type MysqlRedisQdrantStack,
  type OllamaStack,
  applyMinimalMysqlSchema,
  getFreePort,
  registerProcessShutdown,
  resolveMonorepoRootFromImporter,
  resolveShouldRunOllamaE2e,
  startEngineIntegrationProcess,
  startMysqlRedisQdrant,
  startOllamaWithModel,
  stopTrackedOllamaIfAny,
  stopTrackedTestcontainersIfAny,
} from "@cube-ai/test-infra";

import { createAgenticClient } from "../../src/client";
import { buildVersionHeaders } from "../../src/versioning";

/**
 * sdk-core × engine × **Ollama（Docker）** — 独立可选端到端。
 *
 * 验证 `streamMessages` 经真实 LLM（OpenAI 兼容口连 Ollama）能收到 `turn-completed-v1`。
 * **首次** `ollama pull` 耗时长，默认不跑；勿并入常规 `test:containers` 必过集。
 *
 * 官方镜像说明：https://docs.ollama.com/docker
 *
 * 运行（需 Docker）：
 *   USE_TESTCONTAINERS=1 RUN_OLLAMA_E2E=1 bun test packages/agent/sdk-client/test/integration/end-to-end-ollama.testcontainers.test.ts
 *   或根目录：`bun run test:containers:ollama`
 *
 * 可选环境变量：
 *   - `AGENTIC_E2E_OLLAMA_MODEL` — 默认 `tinyllama`
 *   - `AGENTIC_E2E_OLLAMA_IMAGE` — 默认 `ollama/ollama`
 */

const run = await resolveShouldRunOllamaE2e();

const stackHolder: { current: MysqlRedisQdrantStack | null } = { current: null };
const ollamaHolder: { current: OllamaStack | null } = { current: null };
const engineHolder: { current: EngineIntegrationProcess | null } = { current: null };

const HOOK_MS = 3_600_000;
const AGENT_ID = "1234567890123456789";
const TENANT = 991_002;
const USER_ID = "sdk-e2e-ollama-user";

if (run) {
  setDefaultTimeout(HOOK_MS);
  registerProcessShutdown(
    async () => {
      await stopTrackedOllamaIfAny();
      await stopTrackedTestcontainersIfAny();
      if (engineHolder.current) {
        await engineHolder.current.stop().catch(() => {});
        engineHolder.current = null;
      }
      if (ollamaHolder.current) {
        await ollamaHolder.current.stop().catch(() => {});
        ollamaHolder.current = null;
      }
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
    },
    { exitProcessAfterSignal: true },
  );
}

function buildMockFetchImpl(): typeof fetch {
  const realFetch = fetch.bind(globalThis);
  return async (input, init) => {
    const headers = new Headers(init?.headers ?? {});
    for (const [k, v] of Object.entries(buildVersionHeaders())) {
      if (!headers.has(k)) {
        headers.set(k, v);
      }
    }
    if (!headers.has("x-mock-tenant-id")) {
      headers.set("x-mock-tenant-id", String(TENANT));
    }
    if (!headers.has("x-mock-user-id")) {
      headers.set("x-mock-user-id", USER_ID);
    }
    return realFetch(input, { ...init, headers });
  };
}

(run ? describe : describe.skip)("[testcontainers] sdk-core × engine × Ollama — streamMessages turn-completed-v1", () => {
  beforeAll(async () => {
    const stack = await startMysqlRedisQdrant();
    try {
      await applyMinimalMysqlSchema(stack.mysqlUrl);
      stackHolder.current = stack;
    } catch (e) {
      await stack.stop();
      throw e;
    }

    const ollama = await startOllamaWithModel({});
    ollamaHolder.current = ollama;

    const port = await getFreePort();
    const repoRoot = resolveMonorepoRootFromImporter(import.meta.dir);
    try {
      const engine = await startEngineIntegrationProcess({
        extraEnv: {
          AGENTIC_ENGINE_OPENAI_API_KEY: process.env["AGENTIC_ENGINE_OPENAI_API_KEY"]?.trim() || "ollama",
          AGENTIC_ENGINE_OPENAI_BASE_URL: ollama.openAiBaseUrl,
          AGENTIC_ENGINE_OPENAI_MODEL: ollama.model,
          AGENTIC_ENGINE_OPENAI_TIMEOUT_MS: "300000",
          AGENTIC_ENGINE_PROVIDER: "openai-compat",
        },
        port,
        repoRoot,
        stack,
      });
      engineHolder.current = engine;
    } catch (e) {
      await ollama.stop().catch(() => {});
      ollamaHolder.current = null;
      await stack.stop();
      stackHolder.current = null;
      throw e;
    }
  }, HOOK_MS);

  afterAll(async () => {
    if (engineHolder.current) {
      await engineHolder.current.stop().catch(() => {});
      engineHolder.current = null;
    }
    if (ollamaHolder.current) {
      await ollamaHolder.current.stop().catch(() => {});
      ollamaHolder.current = null;
    }
    if (stackHolder.current) {
      await stackHolder.current.stop().catch(() => {});
      stackHolder.current = null;
    }
    await stopTrackedOllamaIfAny();
    await stopTrackedTestcontainersIfAny();
  });

  it("streamMessages emits turn-completed-v1 via Ollama-backed engine SSE", async () => {
    const client = createAgenticClient({
      auth: { provider: () => "test-token" },
      baseUrl: engineHolder.current!.baseUrl,
      fetchImpl: buildMockFetchImpl(),
      sse: { maxReconnectAttempts: 3, reconnect: true },
    });

    const created = await client.sessions.create({
      agentId: AGENT_ID,
      title: "sdk-ollama-e2e",
    });

    const schemas: string[] = [];
    const signal = AbortSignal.timeout(300_000);
    try {
      for await (const ev of client.sessions.streamMessages(
        created.id,
        {
          content: {
            blocks: [{ type: "text", text: "Reply with exactly: OK" }],
            schema: "message-content-v1",
          },
        },
        signal,
      )) {
        schemas.push(ev.schema);
        if (ev.schema === "turn-completed-v1") {
          break;
        }
      }
    } catch (e) {
      if (signal.aborted) {
        throw new Error(`timeout waiting for turn-completed-v1; schemas so far: ${schemas.join(", ")}`, { cause: e });
      }
      throw e;
    }

    expect(schemas.some((s) => s.includes("completed") || s.includes("delta") || s.includes("started"))).toBe(true);
    expect(schemas).toContain("turn-completed-v1");
  }, 360_000);
});
