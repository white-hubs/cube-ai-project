import { describe, expect, it } from "bun:test";

import { DashscopeText2ImageProvider } from "./dashscope-text2image-provider";

describe("DashscopeText2ImageProvider", () => {
  it("returns images directly when no task_id (sync response)", async () => {
    const mockFetch: typeof fetch = (async () =>
      Response.json(
        {
          output: {
            choices: [{ message: { content: [{ image: "https://example.com/img.png" }] } }],
          },
          request_id: "req-1",
        },
        { headers: { "content-type": "application/json" }, status: 200 },
      )) as unknown as typeof fetch;

    const provider = new DashscopeText2ImageProvider({
      apiBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
      apiKey: "sk-test",
      fetchImpl: mockFetch,
      modelCode: "qwen-image-2.0-pro",
    });

    const result = await provider.generate({ modelCode: "qwen-image-2.0-pro", prompt: "a cat", tenant: 1 });
    expect(result.images[0]?.url).toBe("https://example.com/img.png");
    expect(result.requestId).toBe("req-1");
    expect(result.model).toBe("qwen-image-2.0-pro");
  });

  it("polls until SUCCEEDED when async task_id returned", async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = (async (url: Parameters<typeof fetch>[0]) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : (url as Request).url;
      callCount++;

      if (urlStr.includes("generation")) {
        return Response.json(
          { output: { task_id: "task-abc", task_status: "PENDING" }, request_id: "req-2" },
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      if (urlStr.includes("tasks")) {
        if (callCount < 4) {
          return Response.json(
            { output: { task_id: "task-abc", task_status: "RUNNING" } },
            { headers: { "content-type": "application/json" }, status: 200 },
          );
        }
        return Response.json(
          {
            output: {
              results: [{ url: "https://result.example.com/done.png" }],
              task_id: "task-abc",
              task_status: "SUCCEEDED",
            },
            request_id: "req-2-done",
          },
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const provider = new DashscopeText2ImageProvider({
      apiBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
      apiKey: "sk-test",
      fetchImpl: mockFetch,
      modelCode: "wan2.2-t2i",
      pollIntervalMs: 0,
    });

    const result = await provider.generate({ modelCode: "wan2.2-t2i", prompt: "a mountain", tenant: 1 });
    expect(result.images[0]?.url).toBe("https://result.example.com/done.png");
    expect(result.requestId).toBe("req-2-done");
  });

  it("throws on FAILED task", async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = (async (url: Parameters<typeof fetch>[0]) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : (url as Request).url;
      callCount++;
      if (urlStr.includes("generation")) {
        return Response.json(
          { output: { task_id: "task-fail", task_status: "PENDING" }, request_id: "req-3" },
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      }
      return Response.json(
        { output: { code: "ERR_001", message: "Model error", task_status: "FAILED" } },
        { headers: { "content-type": "application/json" }, status: 200 },
      );
    }) as unknown as typeof fetch;

    const provider = new DashscopeText2ImageProvider({
      apiBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
      apiKey: "sk-test",
      fetchImpl: mockFetch,
      modelCode: "wan2.2-t2i",
      pollIntervalMs: 0,
    });

    await expect(provider.generate({ modelCode: "wan2.2-t2i", prompt: "a cloud", tenant: 1 })).rejects.toThrow(/failed/iu);
    expect(callCount).toBe(2);
  });

  it("throws UPSTREAM_LLM_AUTH_FAILED on 401", async () => {
    const mockFetch: typeof fetch = (async () => new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;

    const provider = new DashscopeText2ImageProvider({
      apiBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
      apiKey: "bad-key",
      fetchImpl: mockFetch,
      modelCode: "x",
    });

    await expect(provider.generate({ modelCode: "x", prompt: "test", tenant: 1 })).rejects.toMatchObject({
      code: "UPSTREAM_LLM_AUTH_FAILED",
    });
  });
});
