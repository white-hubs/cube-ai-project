import { describe, expect, test } from "bun:test";

import { type WireContext } from "../wire-context.types";
import { decodeOpenAiImageResponse, encodeOpenAiImageRequest, openAiImagesAdapter } from "./openai.images.adapter";

function imageContext(partial: Partial<WireContext> = {}): WireContext {
  return {
    adapterKey: "openai.images",
    apiBaseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    channelProfile: "direct",
    endpointType: "openai_image",
    modelCode: "gpt-image-1",
    nativeFamily: "gpt_image",
    providerCode: "openai",
    providerTypeCode: "openai",
    requestSchema: { requestShape: "openai_images_generation" },
    responseSchema: { responseShape: "openai_images_generation" },
    ...partial,
  };
}

describe("encodeOpenAiImageRequest", () => {
  test("builds canonical images/generations request with normalized size", () => {
    const encoded = encodeOpenAiImageRequest(
      {
        model: "gpt-image-1",
        prompt: "a cat",
        shape: "image",
        size: "1024*1024",
      },
      imageContext(),
    );

    expect(encoded.url).toBe("https://api.example.com/v1/images/generations");
    expect(encoded.method).toBe("POST");
    expect(encoded.headers.Authorization).toBe("Bearer sk-test");
    expect(encoded.body).toEqual({
      model: "gpt-image-1",
      n: 1,
      prompt: "a cat",
      response_format: "url",
      size: "1024x1024",
    });
  });

  test("resolves URL for /api/v3 style base and bare host", () => {
    expect(
      encodeOpenAiImageRequest(
        { model: "m", prompt: "p", shape: "image" },
        imageContext({ apiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3" }),
      ).url,
    ).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");

    expect(
      encodeOpenAiImageRequest({ model: "m", prompt: "p", shape: "image" }, imageContext({ apiBaseUrl: "https://api.example.com" })).url,
    ).toBe("https://api.example.com/v1/images/generations");

    expect(
      encodeOpenAiImageRequest(
        { model: "m", prompt: "p", shape: "image" },
        imageContext({ apiBaseUrl: "https://api.example.com/v1/images/generations" }),
      ).url,
    ).toBe("https://api.example.com/v1/images/generations");
  });

  test("includes optional aspect ratio, negative prompt and reference image only when present", () => {
    const minimal = encodeOpenAiImageRequest({ model: "m", prompt: "p", shape: "image" }, imageContext());
    expect(minimal.body).not.toHaveProperty("aspect_ratio");
    expect(minimal.body).not.toHaveProperty("negative_prompt");
    expect(minimal.body).not.toHaveProperty("image");

    const full = encodeOpenAiImageRequest(
      {
        aspectRatio: "16:9",
        image: "https://img.example.com/ref.png",
        model: "m",
        negativePrompt: "blurry",
        prompt: "p",
        shape: "image",
      },
      imageContext(),
    );
    expect(full.body?.aspect_ratio).toBe("16:9");
    expect(full.body?.negative_prompt).toBe("blurry");
    expect(full.body?.image).toBe("https://img.example.com/ref.png");
  });

  test("applies seedream size tier mapping based on wire profile", () => {
    const encoded = encodeOpenAiImageRequest(
      {
        model: "doubao-seedream-3.0-t2i",
        prompt: "cat",
        shape: "image",
        size: "1024x1024",
      },
      imageContext({ channelProfile: "aggregator_native", nativeFamily: "seedream" }),
    );
    expect(encoded.body?.size).toBe("2K");
  });
});

describe("decodeOpenAiImageResponse", () => {
  test("extracts first data item url", () => {
    expect(decodeOpenAiImageResponse({ data: [{ url: "https://img.example.com/1.png" }] })).toEqual({
      imageUrl: "https://img.example.com/1.png",
    });
  });

  test("returns empty imageUrl for malformed payloads", () => {
    expect(decodeOpenAiImageResponse(null)).toEqual({ imageUrl: "" });
    expect(decodeOpenAiImageResponse([])).toEqual({ imageUrl: "" });
    expect(decodeOpenAiImageResponse({ data: [] })).toEqual({ imageUrl: "" });
    expect(decodeOpenAiImageResponse({ data: [{ b64_json: "abc" }] })).toEqual({ imageUrl: "" });
  });
});

describe("openAiImagesAdapter", () => {
  test("rejects chat-shaped input", () => {
    expect(() =>
      openAiImagesAdapter.encodeRequest(
        {
          messages: [],
          model: "gpt-4o",
          parameters: {},
          shape: "chat",
        },
        imageContext(),
      ),
    ).toThrow("openai.images only supports image requests");
  });

  test("delegates decodeResponse to shared decoder", () => {
    expect(openAiImagesAdapter.decodeResponse({ data: [{ url: "u" }] }, imageContext())).toEqual({ imageUrl: "u" });
  });
});
