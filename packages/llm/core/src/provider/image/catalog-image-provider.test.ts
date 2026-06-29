import { describe, expect, it } from "bun:test";

import { createImageProviderFromRuntimeConfig } from "./catalog-image-provider";

describe("createImageProviderFromRuntimeConfig", () => {
  it("routes dashscope_text2image to the dashscope provider", () => {
    const p = createImageProviderFromRuntimeConfig({
      apiBaseUrl: "https://dashscope.aliyuncs.com",
      apiKey: "k",
      displayName: "wan",
      endpointType: "dashscope_text2image",
      isFree: false,
      modelCode: "wan2.2-t2i",
      modelTypes: ["image_generation"],
      providerCode: "dashscope",
    });
    expect(p.id).toBe("dashscope-text2image");
  });

  it("routes geekai nano-banana to the geekai provider", () => {
    const p = createImageProviderFromRuntimeConfig({
      apiBaseUrl: "https://geekai.co",
      apiKey: "k",
      displayName: "nb",
      endpointType: "geekai",
      isFree: false,
      modelCode: "nano-banana",
      modelTypes: ["image_generation"],
      providerCode: "geekai",
    });
    expect(p.id).toBe("geekai-nano-banana");
  });

  it("routes openai_image + geekai host nano-banana to geekai provider", () => {
    const p = createImageProviderFromRuntimeConfig({
      apiBaseUrl: "https://geekai.co/v1",
      apiKey: "k",
      displayName: "nb",
      endpointType: "openai_image",
      isFree: false,
      modelCode: "nano-banana",
      modelTypes: ["image_generation"],
      providerCode: "geekai",
    });
    expect(p.id).toBe("geekai-nano-banana");
  });

  it("throws on unsupported endpointType for image", () => {
    expect(() =>
      createImageProviderFromRuntimeConfig({
        apiBaseUrl: "https://api.openai.com/v1",
        apiKey: "k",
        displayName: "test",
        endpointType: "openai",
        isFree: false,
        modelCode: "some-model",
        modelTypes: ["image_generation"],
        providerCode: "openai",
      }),
    ).toThrow();
  });
});
