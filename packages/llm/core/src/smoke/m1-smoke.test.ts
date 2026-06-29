import { describe, expect, it } from "bun:test";

import { type LlmModelRuntimeConfig } from "@cube-ai/contracts";

import { InMemoryCatalogStore, createDefaultCatalogSeed } from "../catalog/in-memory-catalog.store";
import { InMemoryLlmCatalogPort } from "../catalog/llm-catalog.port-impl";
import {
  CatalogDrivenProvider,
  type InnerLlmProvider,
  createInnerProviderFromCatalogRuntimeConfig,
} from "../provider/catalog-driven-provider";
import { DoubaoMultimodalEmbedProvider } from "../provider/doubao-multimodal-embed";
import { OpenAiCompatProvider } from "../provider/openai-compat-provider";

describe("M1 smoke: tenant+modelCode → resolve → chat → embed{dense,sparse}", () => {
  it("runs end-to-end with mocked vendor HTTP", async () => {
    const tenant = 1001;
    const store = new InMemoryCatalogStore(createDefaultCatalogSeed(tenant));
    const catalog = new InMemoryLlmCatalogPort(store);

    const chatRuntime = await catalog.resolveModelRuntime(tenant, "gpt-4o", new AbortController().signal);
    const embedRuntime = await catalog.resolveModelRuntime(tenant, "doubao-embedding-vision-251215", new AbortController().signal);
    expect(chatRuntime?.apiKey).toBe("sk-tenant-openai");
    expect(embedRuntime?.endpointType).toBe("volcengine_ark");

    const fetchImpl = async (input: URL | Request | string): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/chat/completions")) {
        return Response.json({
          choices: [{ finish_reason: "stop", message: { content: "pong" } }],
          usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
        });
      }
      if (url.includes("/embeddings/multimodal")) {
        return Response.json({
          data: {
            embedding: [0.11, 0.22],
            sparse_embedding: [{ index: 2, value: 0.7 }],
          },
        });
      }
      return new Response("not found", { status: 404 });
    };

    const provider = new CatalogDrivenProvider({
      catalog,
      providerFactory: (cfg) => withFetch(cfg, fetchImpl as typeof fetch),
    });

    const chat = await provider.chat({
      messages: [{ role: "user", content: "ping" }],
      modelCode: "gpt-4o",
      tenant,
    });
    expect(chat.content).toBe("pong");

    const embed = await provider.embed({
      contexts: [{ retrievalProfile: "semantic-qa" }],
      input: ["检索问题"],
      modelCode: "doubao-embedding-vision-251215",
      purpose: "query",
      tenant,
    });
    expect(embed[0]?.dense).toEqual([0.11, 0.22]);
    expect(embed[0]?.sparse).toEqual({ indices: [2], values: [0.7] });
  });
});

function withFetch(cfg: LlmModelRuntimeConfig, fetchImpl: typeof fetch): InnerLlmProvider {
  const inner = createInnerProviderFromCatalogRuntimeConfig(cfg);
  if (inner.id === "doubao-multimodal-embed") {
    const embedder = new DoubaoMultimodalEmbedProvider({
      apiKey: cfg.apiKey,
      baseURL: cfg.apiBaseUrl,
      fetch: fetchImpl,
      model: cfg.modelCode,
    });
    return {
      chat: inner.chat.bind(inner),
      chatStream: inner.chatStream.bind(inner),
      embed: embedder.embed.bind(embedder),
      id: inner.id,
    };
  }
  const openai = new OpenAiCompatProvider({
    apiKey: cfg.apiKey,
    baseURL: cfg.apiBaseUrl,
    fetch: fetchImpl,
    model: cfg.modelCode,
  });
  return {
    chat: openai.chat.bind(openai),
    chatStream: openai.chatStream.bind(openai),
    embed: openai.embed.bind(openai),
    id: inner.id,
  };
}
