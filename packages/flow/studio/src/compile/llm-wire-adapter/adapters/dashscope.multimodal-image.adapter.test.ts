import { describe, expect, test } from "bun:test";

import type { WireContext } from "../wire-context.types";
import { dashscopeMultimodalImageAdapter } from "./dashscope.multimodal-image.adapter";

function dashscopeContext(partial: Partial<WireContext> = {}): WireContext {
  return {
    adapterKey: "dashscope.multimodal_image",
    apiBaseUrl: "https://dashscope.aliyuncs.com",
    apiKey: "sk-test",
    channelProfile: "direct",
    endpointType: "dashscope_text2image",
    modelCode: "qwen-image",
    nativeFamily: "qwen",
    providerCode: "dashscope",
    providerTypeCode: "dashscope",
    requestSchema: { requestShape: "dashscope_multimodal_generation" },
    responseSchema: { responseShape: "dashscope_multimodal_generation" },
    ...partial,
  };
}

describe("dashscopeMultimodalImageAdapter.encodeRequest", () => {
  test("wraps prompt in dashscope multimodal message envelope with default endpoint", () => {
    const encoded = dashscopeMultimodalImageAdapter.encodeRequest(
      {
        model: "qwen-image",
        prompt: "a cat",
        shape: "image",
      },
      dashscopeContext(),
    );

    expect(encoded.url).toBe("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
    expect(encoded.method).toBe("POST");
    expect(encoded.headers.Authorization).toBe("Bearer sk-test");
    expect(encoded.body).toEqual({
      input: {
        messages: [{ role: "user", content: [{ text: "a cat" }] }],
      },
      model: "qwen-image",
      parameters: {},
    });
  });

  test("includes negative_prompt and size in parameters only when provided", () => {
    const encoded = dashscopeMultimodalImageAdapter.encodeRequest(
      {
        model: "qwen-image",
        negativePrompt: "blurry",
        prompt: "a cat",
        shape: "image",
        size: "1328*1328",
      },
      dashscopeContext(),
    );

    expect(encoded.body?.parameters).toEqual({
      negative_prompt: "blurry",
      size: "1328*1328",
    });
  });

  test("honors schema endpointPath override", () => {
    const encoded = dashscopeMultimodalImageAdapter.encodeRequest(
      {
        model: "qwen-image",
        prompt: "p",
        shape: "image",
      },
      dashscopeContext({
        requestSchema: { endpointPath: "/custom/path", requestShape: "dashscope_multimodal_generation" },
      }),
    );

    expect(encoded.url).toBe("https://dashscope.aliyuncs.com/custom/path");
  });

  test("rejects chat-shaped input", () => {
    expect(() =>
      dashscopeMultimodalImageAdapter.encodeRequest(
        {
          messages: [],
          model: "qwen3-max",
          parameters: {},
          shape: "chat",
        },
        dashscopeContext(),
      ),
    ).toThrow("dashscope.multimodal_image only supports image requests");
  });
});

describe("dashscopeMultimodalImageAdapter.decodeResponse", () => {
  const ctx = dashscopeContext();

  test("extracts image url from output.choices message content parts", () => {
    expect(
      dashscopeMultimodalImageAdapter.decodeResponse(
        {
          output: {
            choices: [
              {
                message: {
                  content: [{ text: "caption" }, { image: " https://img.example.com/1.png " }],
                  role: "assistant",
                },
              },
            ],
          },
        },
        ctx,
      ),
    ).toEqual({ imageUrl: "https://img.example.com/1.png" });
  });

  test("falls back to image_url field", () => {
    expect(
      dashscopeMultimodalImageAdapter.decodeResponse(
        {
          output: {
            choices: [{ message: { content: [{ image_url: "https://img.example.com/2.png" }] } }],
          },
        },
        ctx,
      ),
    ).toEqual({ imageUrl: "https://img.example.com/2.png" });
  });

  test("returns empty imageUrl for malformed or empty payloads", () => {
    expect(dashscopeMultimodalImageAdapter.decodeResponse(null, ctx)).toEqual({ imageUrl: "" });
    expect(dashscopeMultimodalImageAdapter.decodeResponse({}, ctx)).toEqual({ imageUrl: "" });
    expect(dashscopeMultimodalImageAdapter.decodeResponse({ output: { choices: [] } }, ctx)).toEqual({ imageUrl: "" });
    expect(
      dashscopeMultimodalImageAdapter.decodeResponse(
        {
          output: { choices: [{ message: { content: "not-an-array" } }] },
        },
        ctx,
      ),
    ).toEqual({ imageUrl: "" });
    expect(
      dashscopeMultimodalImageAdapter.decodeResponse(
        {
          output: { choices: [{ message: { content: [{ image: "   " }] } }] },
        },
        ctx,
      ),
    ).toEqual({ imageUrl: "" });
  });
});
