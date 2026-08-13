import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { OpenAiCompatProvider } from "./openai-compat-provider";

const ORIGINAL_FETCH = globalThis.fetch.bind(globalThis);

type FetchLike = (input: URL | Request | string, init?: RequestInit) => Promise<Response>;

function stubFetch(impl: FetchLike) {
  globalThis.fetch = impl as typeof fetch;
}

beforeEach(() => {
  stubFetch(ORIGINAL_FETCH as FetchLike);
});

afterEach(() => {
  stubFetch(ORIGINAL_FETCH as FetchLike);
});

describe("OpenAiCompatProvider", () => {
  it("chat parses content and usage from OpenAI-compatible response", async () => {
    stubFetch(async () =>
      Response.json({
        choices: [{ finish_reason: "stop", message: { content: "你好", role: "assistant" } }],
        usage: { completion_tokens: 2, prompt_tokens: 3, total_tokens: 5 },
      }),
    );

    const provider = new OpenAiCompatProvider({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      model: "gpt-4o",
    });
    const res = await provider.chat({
      messages: [{ role: "user", content: "hi" }],
      modelCode: "gpt-4o",
      tenant: 1,
    });
    expect(res.content).toBe("你好");
    expect(res.usage?.totalTokens).toBe(5);
  });

  it("chat parses tool_calls from OpenAI-compatible response", async () => {
    stubFetch(async () =>
      Response.json({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "weather", arguments: '{"city":"SH"}' },
                },
              ],
            },
          },
        ],
        usage: { completion_tokens: 2, prompt_tokens: 1, total_tokens: 3 },
      }),
    );

    const provider = new OpenAiCompatProvider({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      model: "gpt-4o",
    });
    const res = await provider.chat({
      messages: [{ role: "user", content: "天气" }],
      modelCode: "gpt-4o",
      tenant: 1,
      tools: [
        {
          name: "weather",
          description: "查天气",
          inputSchema: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
    });
    expect(res.toolCalls?.[0]?.arguments).toEqual({ city: "SH" });
    expect(res.finishReason).toBe("tool_calls");
  });

  it("chatStream yields tool-call chunks from streaming tool_calls deltas", async () => {
    const sse = [
      String.raw`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"weather","arguments":"{\"city\":"}}]}}]}`,
      "",
      String.raw`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"SH\"}"}}]}}]}`,
      "",
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    stubFetch(
      async () =>
        new Response(sse, {
          headers: { "Content-Type": "text/event-stream" },
          status: 200,
        }),
    );

    const provider = new OpenAiCompatProvider({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      model: "gpt-4o",
    });

    const chunks: { type: string }[] = [];
    for await (const ch of provider.chatStream({
      messages: [{ role: "user", content: "天气" }],
      modelCode: "gpt-4o",
      tenant: 1,
      tools: [{ name: "weather", inputSchema: { type: "object" } }],
    })) {
      chunks.push(ch);
    }

    expect(chunks.some((c) => c.type === "tool-call-delta")).toBe(true);
    expect(chunks.some((c) => c.type === "tool-call-complete")).toBe(true);
    const complete = chunks.find((c) => c.type === "tool-call-complete") as {
      type: string;
      call?: { name: string; arguments: Record<string, unknown> };
    };
    expect(complete?.call?.name).toBe("weather");
    expect(complete?.call?.arguments).toEqual({ city: "SH" });
  });

  it("chatStream parses tool_calls from message field (gateway compatibility)", async () => {
    const sse = [
      String.raw`data: {"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"weather","arguments":"{\"city\":\"SH\"}"}}]},"finish_reason":"tool_calls"}]}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    stubFetch(
      async () =>
        new Response(sse, {
          headers: { "Content-Type": "text/event-stream" },
          status: 200,
        }),
    );

    const provider = new OpenAiCompatProvider({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      model: "gpt-4o",
    });

    const chunks: { type: string }[] = [];
    for await (const ch of provider.chatStream({
      messages: [{ role: "user", content: "天气" }],
      modelCode: "gpt-4o",
      tenant: 1,
      tools: [{ name: "weather", inputSchema: { type: "object" } }],
    })) {
      chunks.push(ch);
    }

    const complete = chunks.find((c) => c.type === "tool-call-complete") as {
      type: string;
      call?: { name: string; arguments: Record<string, unknown> };
    };
    expect(complete?.call?.name).toBe("weather");
    expect(complete?.call?.arguments).toEqual({ city: "SH" });
    const finish = chunks.find((c) => c.type === "finish") as { finishReason?: string };
    expect(finish?.finishReason).toBe("tool_calls");
  });

  it("chatStream parses plain JSON when gateway ignores stream flag (geekai)", async () => {
    const json =
      '{"choices":[{"message":{"role":"assistant","content":"汇总结果"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}';

    stubFetch(
      async () =>
        new Response(json, {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
    );

    const provider = new OpenAiCompatProvider({
      apiKey: "sk-test",
      baseURL: "https://geekai.co/api/v1",
      model: "gpt-5.5",
    });

    const chunks: { type: string; delta?: string }[] = [];
    for await (const ch of provider.chatStream({
      messages: [{ role: "user", content: "统计报警" }],
      modelCode: "gpt-5.5",
      tenant: 1,
      tools: [{ name: "query", inputSchema: { type: "object" } }],
    })) {
      chunks.push(ch);
    }

    const text = chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => c.delta)
      .join("");
    expect(text).toBe("汇总结果");
  });

  it("chatStream falls back to non-stream chat when stream body is empty (geekai)", async () => {
    stubFetch(async (_input, init) => {
      const body = JSON.parse(init?.body as string) as { stream?: boolean };
      if (body.stream) {
        return new Response("", {
          headers: { "Content-Type": "text/event-stream" },
          status: 200,
        });
      }
      return Response.json({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              role: "assistant",
              tool_calls: [
                {
                  id: "call_fb",
                  type: "function",
                  function: { name: "query_database", arguments: '{"year":2026}' },
                },
              ],
            },
          },
        ],
      });
    });

    const provider = new OpenAiCompatProvider({
      apiKey: "sk-test",
      baseURL: "https://geekai.co/api/v1",
      model: "gpt-5.5",
    });

    const chunks: { type: string; call?: { name: string } }[] = [];
    for await (const ch of provider.chatStream({
      messages: [{ role: "user", content: "统计报警" }],
      modelCode: "gpt-5.5",
      tenant: 1,
      tools: [{ name: "query_database", inputSchema: { type: "object" } }],
    })) {
      chunks.push(ch as { type: string; call?: { name: string } });
    }

    const complete = chunks.find((c) => c.type === "tool-call-complete");
    expect(complete?.call?.name).toBe("query_database");
  });

  it("chatStream flushes a final SSE data line that lacks a trailing newline (geekai single-frame)", async () => {
    // geekai consolidates the whole turn into one SSE frame and may omit the
    // terminating newline on the final `data:` line. The previous reader loop
    // kept that line in `buffer` and dropped it on stream end → sseChunks=0 →
    // empty terminal → TOOL_LOOP_PROVIDER_NO_RESPONSE.
    const sse =
      'data: {"choices":[{"message":{"role":"assistant","content":"今日新闻摘要"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}';

    stubFetch(
      async () =>
        new Response(sse, {
          headers: { "Content-Type": "text/event-stream" },
          status: 200,
        }),
    );

    const provider = new OpenAiCompatProvider({
      apiKey: "sk-test",
      baseURL: "https://geekai.co/api/v1",
      model: "gpt-5.5",
    });

    const chunks: { type: string; delta?: string }[] = [];
    for await (const ch of provider.chatStream({
      messages: [{ role: "user", content: "搜索今日新闻" }],
      modelCode: "gpt-5.5",
      tenant: 1,
    })) {
      chunks.push(ch);
    }

    const text = chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => c.delta)
      .join("");
    expect(text).toBe("今日新闻摘要");
    const finish = chunks.find((c) => c.type === "finish") as { finishReason?: string };
    expect(finish?.finishReason).toBe("stop");
  });

  it("sends tools in request body when tools are provided", async () => {
    let capturedBody: unknown;
    const capturingFetch: FetchLike = async (_input, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: "ok", role: "assistant" } }],
      });
    };

    const provider = new OpenAiCompatProvider({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      fetch: capturingFetch as typeof fetch,
      model: "gpt-4o",
    });
    await provider.chat({
      messages: [{ role: "user", content: "hi" }],
      modelCode: "gpt-4o",
      tenant: 1,
      tools: [{ name: "demo", description: "d", inputSchema: { type: "object" } }],
    });

    const body = capturedBody as { tools?: unknown[]; tool_choice?: string };
    expect(body.tools?.length).toBe(1);
    expect(body.tool_choice).toBe("auto");
  });

  it("encodes dotted MCP tool names for OpenAI wire format and decodes tool_calls", async () => {
    let capturedBody: unknown;
    const capturingFetch: FetchLike = async (_input, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return Response.json({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "mcp_biz-ontology_query_database",
                    arguments: '{"year":2026}',
                  },
                },
              ],
            },
          },
        ],
      });
    };

    const provider = new OpenAiCompatProvider({
      apiKey: "sk-test",
      baseURL: "https://geekai.co/api/v1",
      fetch: capturingFetch as typeof fetch,
      model: "gpt-5.5",
    });

    const res = await provider.chat({
      messages: [{ role: "user", content: "统计报警" }],
      modelCode: "gpt-5.5",
      tenant: 1,
      tools: [
        { name: "currentDate", inputSchema: { type: "object" } },
        { name: "mcp.biz-ontology.query_database", inputSchema: { type: "object" } },
      ],
    });

    const body = capturedBody as {
      tools?: { function?: { name?: string } }[];
    };
    expect(body.tools?.[0]?.function?.name).toBe("currentDate");
    expect(body.tools?.[1]?.function?.name).toBe("mcp_biz-ontology_query_database");
    expect(res.toolCalls?.[0]?.name).toBe("mcp.biz-ontology.query_database");
    expect(res.toolCalls?.[0]?.arguments).toEqual({ year: 2026 });
  });

  it("normalizes separator-variant upstream stream tool names to declared tools", async () => {
    const upstreamFrame = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                function: {
                  arguments: JSON.stringify({ keyword: "待办" }),
                  name: "mcp_biz-ontology-search_ontology",
                },
                id: "call_mixed",
                index: 0,
                type: "function",
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const sse = [`data: ${JSON.stringify(upstreamFrame)}`, "", "data: [DONE]", ""].join("\n");
    const diagnosticFetch: FetchLike = async () =>
      new Response(sse, {
        headers: { "Content-Type": "text/event-stream" },
        status: 200,
      });
    const provider = new OpenAiCompatProvider({
      apiKey: "sk-test",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fetch: diagnosticFetch as typeof fetch,
      model: "qwen3.6-flash",
    });

    const chunks = [];
    for await (const chunk of provider.chatStream({
      messages: [{ role: "user", content: "查询待办" }],
      modelCode: "qwen3.6-flash",
      tenant: 1,
      tools: [{ name: "mcp.biz-ontology.search_ontology", inputSchema: { type: "object" } }],
    })) {
      chunks.push(chunk);
    }

    expect(
      chunks.find((chunk) => chunk.type === "tool-call-complete" && chunk.call.name === "mcp.biz-ontology.search_ontology"),
    ).toBeDefined();
  });

  it("rewrites historical separator-variant assistant tool names back to canonical wire names", async () => {
    let capturedBody: unknown;
    const capturingFetch: FetchLike = async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: "ok", role: "assistant" } }],
      });
    };
    const provider = new OpenAiCompatProvider({
      apiKey: "sk-test",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fetch: capturingFetch as typeof fetch,
      model: "qwen3.6-flash",
    });

    await provider.chat({
      messages: [
        { role: "user", content: "查询待办" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              arguments: { keyword: "待办" },
              id: "call_bad_history",
              name: "mcp_biz-ontology.search_ontology",
            },
          ],
        },
      ],
      modelCode: "qwen3.6-flash",
      tenant: 1,
      tools: [{ name: "mcp.biz-ontology.search_ontology", inputSchema: { type: "object" } }],
    });

    const body = capturedBody as {
      messages?: { tool_calls?: { function?: { name?: string } }[] }[];
      tools?: { function?: { name?: string } }[];
    };
    expect(body.tools?.[0]?.function?.name).toBe("mcp_biz-ontology_search_ontology");
    expect(body.messages?.[1]?.tool_calls?.[0]?.function?.name).toBe("mcp_biz-ontology_search_ontology");
  });

  it("aligns visible system tool names with OpenAI wire tool names on the first request", async () => {
    let capturedBody: unknown;
    const capturingFetch: FetchLike = async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: "ok", role: "assistant" } }],
      });
    };
    const provider = new OpenAiCompatProvider({
      apiKey: "sk-test",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fetch: capturingFetch as typeof fetch,
      model: "qwen3.6-flash",
    });

    await provider.chat({
      messages: [
        {
          role: "system",
          content: "## Tool Definitions\n- mcp.biz-ontology.search_ontology: search\n- mcp.biz-ontology.resolve_business_query: resolve",
        },
        { role: "user", content: "查询待办" },
      ],
      modelCode: "qwen3.6-flash",
      tenant: 1,
      tools: [
        { name: "mcp.biz-ontology.search_ontology", inputSchema: { type: "object" } },
        { name: "mcp.biz-ontology.resolve_business_query", inputSchema: { type: "object" } },
      ],
    });

    const body = capturedBody as {
      messages?: { content?: string }[];
      tools?: { function?: { name?: string } }[];
    };
    expect(body.tools?.map((tool) => tool.function?.name)).toEqual([
      "mcp_biz-ontology_search_ontology",
      "mcp_biz-ontology_resolve_business_query",
    ]);
    expect(body.messages?.[0]?.content).toContain("mcp_biz-ontology_search_ontology");
    expect(body.messages?.[0]?.content).toContain("mcp_biz-ontology_resolve_business_query");
    expect(body.messages?.[0]?.content).not.toContain("mcp.biz-ontology.search_ontology");
    expect(body.messages?.[0]?.content).not.toContain("mcp.biz-ontology.resolve_business_query");
  });

  it("embed returns dense vectors (G3 sparse optional on openai path)", async () => {
    const embeddingFetch: FetchLike = async () =>
      Response.json({
        data: [{ object: "embedding", embedding: [0.1, 0.2, 0.3], index: 0 }],
        object: "list",
        usage: { prompt_tokens: 2, total_tokens: 2 },
      });

    const provider = new OpenAiCompatProvider({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      fetch: embeddingFetch as typeof fetch,
      model: "text-embedding-3-small",
    });
    const res = await provider.embed({
      input: ["hello world"],
      modelCode: "text-embedding-3-small",
      tenant: 1,
    });
    expect(res).toEqual([{ dense: [0.1, 0.2, 0.3] }]);
    expect(res[0]?.sparse).toBeUndefined();
  });
});
