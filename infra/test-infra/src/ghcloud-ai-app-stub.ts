/**
 * Bun.serve-based test stub impersonating @ghcloud/ai-application's HTTP
 * surface that platform-adapters-ghcloud talks to. Deterministic responses
 * + recorded request log for assertions.
 */
export interface GhcloudStubScripted {
  flowRunResponse?: unknown;
  flowListResponse?: unknown;
  knowledgeQueryResponse?: unknown;
  providersResponse?: unknown[];
  modelRuntimeConfig?: Record<string, unknown>;
  chatCompletionsResponse?: Record<string, unknown>;
}

export interface GhcloudStubRequestLog {
  method: string;
  path: string;
  /** `URL#search`, e.g. `?keyword=a` or empty when absent. */
  query: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface GhcloudStubHandle {
  url: string;
  port: number;
  requests: GhcloudStubRequestLog[];
  setScript(script: GhcloudStubScripted): void;
  stop(): Promise<void>;
}

async function readRequestBody(req: Request): Promise<unknown> {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return undefined;
  }
  const text = await req.text();
  if (!text) {
    return "";
  }
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return text;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function defaultFlowRunResponse(): Record<string, unknown> {
  return {
    ok: true,
    outputs: {},
    stub: "flow-sync-complete",
  };
}

function defaultFlowListResponse(): unknown[] {
  return [
    {
      compileError: null,
      compileRevision: "1",
      compileStatus: "OK",
      createTime: null,
      description: null,
      enabled: true,
      id: "1",
      name: "stub-flow",
      publishedReleaseId: null,
      publishedRevision: null,
      remark: null,
      tenant: 0,
      updateTime: null,
    },
  ];
}

function defaultKnowledgeResponse(): Record<string, unknown> {
  return {
    hits: [{ docId: "d1", kbId: "kb1", score: 0.81, snippet: "stub hit", title: "T" }],
    truncated: false,
  };
}

function defaultChatCompletionsResponse(): Record<string, unknown> {
  return {
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: "stub assistant response",
          // 默认在 stub 响应里同时塞一段 `reasoning_content`，让
          // OpenAICompatProvider 的非流路径走通 reasoning 提取分支（DeepSeek-R1 /
          // 豆包-thinking 风格）。集成测试可断言 SSE 流里出现 reasoning-*-v1 事件。
          reasoning_content: "stub reasoning trace: weighing options…",
        },
      },
    ],
    created: Math.floor(Date.now() / 1000),
    id: "chatcmpl-stub",
    model: "stub-model",
    object: "chat.completion",
    usage: {
      completion_tokens: 4,
      prompt_tokens: 8,
      total_tokens: 12,
    },
  };
}

function resolveChatMessage(script: GhcloudStubScripted): {
  content: string;
  reasoning: string;
  model: string;
} {
  const resp = script.chatCompletionsResponse ?? defaultChatCompletionsResponse();
  const choice = (
    resp.choices as
      | {
          message?: { content?: string; reasoning_content?: string };
        }[]
      | undefined
  )?.[0];
  const message = choice?.message ?? {};
  return {
    content: typeof message.content === "string" ? message.content : "stub assistant response",
    model: typeof resp.model === "string" ? resp.model : "stub-model",
    reasoning: typeof message.reasoning_content === "string" ? message.reasoning_content : "stub reasoning trace: weighing options…",
  };
}

/** OpenAI-compatible SSE for `stream: true` chat completions requests. */
function buildChatCompletionSse(script: GhcloudStubScripted): string {
  const { content, reasoning, model } = resolveChatMessage(script);
  const id = "chatcmpl-stub-stream";
  const created = Math.floor(Date.now() / 1000);
  const chunks: string[] = [];
  const push = (data: unknown): void => {
    chunks.push(`data: ${JSON.stringify(data)}\n\n`);
  };

  push({
    choices: [
      {
        index: 0,
        delta: { role: "assistant", reasoning_content: reasoning },
        finish_reason: null,
      },
    ],
    created,
    id,
    model,
    object: "chat.completion.chunk",
  });
  push({
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
    created,
    id,
    model,
    object: "chat.completion.chunk",
  });
  push({
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    created,
    id,
    model,
    object: "chat.completion.chunk",
    usage: { completion_tokens: 4, prompt_tokens: 8, total_tokens: 12 },
  });
  chunks.push("data: [DONE]\n\n");
  return chunks.join("");
}

export async function startGhcloudAiAppStub(initial?: GhcloudStubScripted): Promise<GhcloudStubHandle> {
  let script: GhcloudStubScripted = initial ?? {};
  const requests: GhcloudStubRequestLog[] = [];

  const server = Bun.serve({
    async fetch(req) {
      const u = new URL(req.url);
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      const body = await readRequestBody(req);
      requests.push({ method: req.method.toUpperCase(), path: u.pathname, query: u.search, headers, body });

      if (req.method.toUpperCase() === "POST" && /^\/ai\/flows\/[^/]+\/run(?:-stream)?$/u.test(u.pathname)) {
        return Response.json(script.flowRunResponse ?? defaultFlowRunResponse());
      }

      if (req.method.toUpperCase() === "GET" && (u.pathname === "/ai/flows" || u.pathname === "/ai/flows/")) {
        return Response.json(script.flowListResponse ?? defaultFlowListResponse());
      }

      if (req.method.toUpperCase() === "POST" && u.pathname === "/ai/knowledge/query") {
        return Response.json(script.knowledgeQueryResponse ?? defaultKnowledgeResponse());
      }

      if (req.method.toUpperCase() === "GET" && u.pathname === "/ai/llm/providers") {
        return Response.json(script.providersResponse ?? []);
      }

      if (req.method.toUpperCase() === "GET" && /^\/ai\/llm\/providers\/[^/]+\/models\/[^/]+\/runtime-config$/u.test(u.pathname)) {
        if (!script.modelRuntimeConfig) {
          return new Response("not found", { status: 404 });
        }
        return Response.json(script.modelRuntimeConfig);
      }

      if (req.method.toUpperCase() === "POST" && u.pathname === "/v1/chat/completions") {
        const reqBody = body as { stream?: boolean } | undefined;
        if (reqBody?.stream === true) {
          return new Response(buildChatCompletionSse(script), {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          });
        }
        return Response.json(script.chatCompletionsResponse ?? defaultChatCompletionsResponse());
      }

      return new Response("stub: not found", { status: 404 });
    },
    port: 0,
  });

  const port = server.port as number;
  return {
    port,
    requests,
    setScript(next) {
      script = next;
    },
    async stop() {
      server.stop(true);
    },
    url: `http://127.0.0.1:${port}`,
  };
}
