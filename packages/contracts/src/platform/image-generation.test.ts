import { describe, expect, it } from "bun:test";

import { ImageGenerationRequestSchema } from "./image-generation";

describe("ImageGenerationRequestSchema", () => {
  it("parses a minimal text2image request", () => {
    const r = ImageGenerationRequestSchema.parse({ modelCode: "qwen-image", prompt: "a cat", tenant: 1 });
    expect(r.prompt).toBe("a cat");
    expect(r.modelCode).toBe("qwen-image");
    expect(r.tenant).toBe(1);
  });

  it("allows optional fields", () => {
    const r = ImageGenerationRequestSchema.parse({
      modelCode: "wanx-v1",
      n: 2,
      negativePrompt: "blurry",
      prompt: "a mountain",
      referenceImages: ["https://example.com/ref.png"],
      seed: 42,
      size: "1024x1024",
      tenant: 2,
    });
    expect(r.n).toBe(2);
    expect(r.seed).toBe(42);
    expect(r.referenceImages?.[0]).toBe("https://example.com/ref.png");
  });

  it("rejects n > 4", () => {
    expect(() => ImageGenerationRequestSchema.parse({ modelCode: "x", n: 5, prompt: "y", tenant: 1 })).toThrow();
  });

  it("rejects empty prompt", () => {
    expect(() => ImageGenerationRequestSchema.parse({ modelCode: "x", prompt: "", tenant: 1 })).toThrow();
  });
});
