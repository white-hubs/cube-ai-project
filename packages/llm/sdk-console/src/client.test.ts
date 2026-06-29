import { describe, expect, test } from "bun:test";

import { createLlmConsoleClient } from "./client";

describe("LlmConsoleClient", () => {
  test("listProviders GET /llm/console/providers", async () => {
    let capturedUrl = "";
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      expect(init?.method).toBe("GET");
      return Response.json([
        {
          apiBaseUrl: "https://api.openai.com/v1",
          enabled: true,
          id: "p1",
          providerCode: "openai",
          typeCode: "openai",
        },
      ]);
    };

    const client = createLlmConsoleClient({
      baseUrl: "http://ai-center.test",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const providers = await client.listProviders();

    expect(capturedUrl).toBe("http://ai-center.test/llm/console/providers");
    expect(providers[0]?.providerCode).toBe("openai");
  });

  test("listProviders preserves admin fields from GET /llm/console/providers", async () => {
    const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
      expect(init?.method).toBe("GET");
      return Response.json([
        {
          apiBaseUrl: "https://api.openai.com/v1",
          apiKey: "sk-***",
          enabled: true,
          iconUrl: "https://cdn.example/icon.png",
          id: "p1",
          isCustom: false,
          name: "OpenAI",
          providerCode: "openai",
          remark: "tenant default",
          systemProviderId: "sys-1",
          typeCode: "openai",
        },
      ]);
    };

    const client = createLlmConsoleClient({
      baseUrl: "http://ai-center.test",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const providers = await client.listProviders();

    expect(providers[0]).toMatchObject({
      apiKey: "sk-***",
      iconUrl: "https://cdn.example/icon.png",
      id: "p1",
      isCustom: false,
      name: "OpenAI",
      providerCode: "openai",
      remark: "tenant default",
      systemProviderId: "sys-1",
    });
  });

  test("listProviders accepts unconfigured providers with null apiBaseUrl", async () => {
    const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
      expect(init?.method).toBe("GET");
      return Response.json([
        {
          apiBaseUrl: null,
          enabled: false,
          id: "p1",
          providerCode: "dashscope",
          typeCode: "dashscope",
        },
      ]);
    };

    const client = createLlmConsoleClient({
      baseUrl: "http://ai-center.test",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const providers = await client.listProviders();

    expect(providers[0]?.apiBaseUrl).toBeNull();
  });

  test("listEndpointTypes GET /llm/console/endpoint-types", async () => {
    let capturedUrl = "";
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      expect(init?.method).toBe("GET");
      return Response.json([{ code: "openai", description: "OpenAI Chat Completions 兼容协议", displayName: "OpenAI" }]);
    };

    const client = createLlmConsoleClient({
      baseUrl: "http://ai-center.test",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const types = await client.listEndpointTypes();

    expect(capturedUrl).toBe("http://ai-center.test/llm/console/endpoint-types");
    expect(types).toEqual([{ code: "openai", description: "OpenAI Chat Completions 兼容协议", displayName: "OpenAI" }]);
  });

  test("normalizes legacy pathPrefix /llm to the console management face", async () => {
    let capturedUrl = "";
    const fetchImpl = async (url: string): Promise<Response> => {
      capturedUrl = url;
      return Response.json([]);
    };

    const client = createLlmConsoleClient({
      baseUrl: "http://ai-center.test/api/ai-center",
      fetchImpl: fetchImpl as typeof fetch,
      pathPrefix: "/llm",
    });
    await client.listProviders();

    expect(capturedUrl).toBe("http://ai-center.test/api/ai-center/llm/console/providers");
  });

  test("normalizes legacy baseUrl ending in /llm to the console management face", async () => {
    let capturedUrl = "";
    const fetchImpl = async (url: string): Promise<Response> => {
      capturedUrl = url;
      return Response.json([]);
    };

    const client = createLlmConsoleClient({
      baseUrl: "http://ai-center.test/api/ai-center/llm",
      fetchImpl: fetchImpl as typeof fetch,
      pathPrefix: "",
    });
    await client.listProviders();

    expect(capturedUrl).toBe("http://ai-center.test/api/ai-center/llm/console/providers");
  });
});
