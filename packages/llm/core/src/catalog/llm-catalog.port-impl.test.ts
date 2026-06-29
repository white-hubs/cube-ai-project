import { describe, expect, it } from "bun:test";

import { type LlmCatalogPort } from "@cube-ai/contracts";

import { InMemoryCatalogStore, createDefaultCatalogSeed } from "./in-memory-catalog.store";
import { InMemoryLlmCatalogPort } from "./llm-catalog.port-impl";

describe("InMemoryLlmCatalogPort.resolveModelRuntime", () => {
  it("returns tenant runtime config with apiKey for seeded modelCode", async () => {
    const tenant = 1001;
    const store = new InMemoryCatalogStore(createDefaultCatalogSeed(tenant));
    const catalog: LlmCatalogPort = new InMemoryLlmCatalogPort(store);

    const runtime = await catalog.resolveModelRuntime(tenant, "gpt-4o", new AbortController().signal);

    expect(runtime).not.toBeNull();
    expect(runtime?.modelCode).toBe("gpt-4o");
    expect(runtime?.endpointType).toBe("openai");
    expect(runtime?.apiBaseUrl).toBe("https://api.openai.com/v1");
    expect(runtime?.apiKey).toBe("sk-tenant-openai");
    expect(runtime?.providerCode).toBe("openai-official");
    expect(runtime?.modelTypes).toContain("reasoning");
  });

  it("returns null when tenant model is missing", async () => {
    const store = new InMemoryCatalogStore(createDefaultCatalogSeed(1001));
    const catalog = new InMemoryLlmCatalogPort(store);
    const runtime = await catalog.resolveModelRuntime(1001, "missing-model", new AbortController().signal);
    expect(runtime).toBeNull();
  });

  it("listProviders returns enabled tenant providers", async () => {
    const tenant = 1001;
    const store = new InMemoryCatalogStore(createDefaultCatalogSeed(tenant));
    const catalog = new InMemoryLlmCatalogPort(store);
    const providers = await catalog.listProviders(tenant, new AbortController().signal);
    expect(providers.length).toBe(2);
    expect(providers.every((p) => p.enabled)).toBe(true);
  });
});
