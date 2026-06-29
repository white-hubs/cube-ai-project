import { describe, expect, it } from "bun:test";

import { GeekaiNanoBananaProvider } from "./geekai-nano-banana-provider";

describe("GeekaiNanoBananaProvider", () => {
  it("returns image URLs from OpenAI-image-compatible response", async () => {
    const mockFetch: typeof fetch = (async () =>
      Response.json(
        {
          created: 1718000000,
          data: [{ url: "https://cdn.geekai.co/img.png" }],
        },
        { headers: { "content-type": "application/json" }, status: 200 },
      )) as unknown as typeof fetch;

    const provider = new GeekaiNanoBananaProvider({
      apiBaseUrl: "https://geekai.co",
      apiKey: "gk-test",
      fetchImpl: mockFetch,
      modelCode: "nano-banana",
    });

    const result = await provider.generate({ modelCode: "nano-banana", prompt: "a sunrise", tenant: 1 });
    expect(result.images[0]?.url).toBe("https://cdn.geekai.co/img.png");
    expect(result.model).toBe("nano-banana");
  });

  it("throws on empty data array", async () => {
    const mockFetch: typeof fetch = (async () =>
      Response.json(
        { created: 1718000000, data: [] },
        { headers: { "content-type": "application/json" }, status: 200 },
      )) as unknown as typeof fetch;

    const provider = new GeekaiNanoBananaProvider({
      apiBaseUrl: "https://geekai.co",
      apiKey: "gk-test",
      fetchImpl: mockFetch,
      modelCode: "nano-banana",
    });

    await expect(provider.generate({ modelCode: "nano-banana", prompt: "test", tenant: 1 })).rejects.toThrow(/no image URLs/iu);
  });

  it("throws UPSTREAM_LLM_AUTH_FAILED on 401", async () => {
    const mockFetch: typeof fetch = (async () => new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;

    const provider = new GeekaiNanoBananaProvider({
      apiBaseUrl: "https://geekai.co",
      apiKey: "bad",
      fetchImpl: mockFetch,
      modelCode: "nano-banana",
    });

    await expect(provider.generate({ modelCode: "nano-banana", prompt: "x", tenant: 1 })).rejects.toMatchObject({
      code: "UPSTREAM_LLM_AUTH_FAILED",
    });
  });
});
