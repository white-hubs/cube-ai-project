import { describe, expect, test } from "bun:test";

import {
  type LlmChatRequest,
  type LlmChatResponse,
  type LlmEmbedRequest,
  type LlmEmbedResult,
  type LlmProviderPort,
} from "@cube-ai/contracts";

import { LlmGatewayController } from "./llm-gateway.controller";
import { LlmHttpTenantResolverService } from "./request-tenant";

class MockProvider implements LlmProviderPort {
  lastChat?: LlmChatRequest;
  lastEmbed?: LlmEmbedRequest;

  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    this.lastChat = req;
    return {
      content: "hello from mock",
      finishReason: "stop",
      usage: { completionTokens: 2, promptTokens: 1, totalTokens: 3 },
    };
  }

  async *chatStream() {
    yield { finishReason: "stop" as const, type: "finish" as const };
  }

  async embed(req: LlmEmbedRequest): Promise<LlmEmbedResult[]> {
    this.lastEmbed = req;
    return req.input.map(() => ({ dense: [0.1, 0.2, 0.3] }));
  }
}

function tenantResolver(tenant: number): LlmHttpTenantResolverService {
  return new LlmHttpTenantResolverService(() => tenant);
}

describe("LlmGatewayController", () => {
  test("POST /v1/chat/completions maps OpenAI wire to LlmProviderPort", async () => {
    const mock = new MockProvider();
    const ctrl = new LlmGatewayController(mock, tenantResolver(42));

    const body = await ctrl.chatCompletions({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
    });

    expect(mock.lastChat?.tenant).toBe(42);
    expect(mock.lastChat?.modelCode).toBe("gpt-4o");
    expect(mock.lastChat?.messages[0]?.content).toBe("hi");
    expect(body).toMatchObject({
      choices: [{ message: { content: "hello from mock" } }],
      model: "gpt-4o",
      object: "chat.completion",
    });
  });

  test("POST /v1/embeddings maps OpenAI wire to LlmProviderPort.embed", async () => {
    const mock = new MockProvider();
    const ctrl = new LlmGatewayController(mock, tenantResolver(7));

    const body = await ctrl.embeddings({
      input: ["a", "b"],
      model: "text-embedding-3-small",
    });

    expect(mock.lastEmbed?.tenant).toBe(7);
    expect(mock.lastEmbed?.modelCode).toBe("text-embedding-3-small");
    expect(body).toMatchObject({
      data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.1, 0.2, 0.3] }],
      object: "list",
    });
  });
});
