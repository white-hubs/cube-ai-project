import { describe, expect, test } from "bun:test";

import { type WireContext, getAdapter, registerDefaultWireAdapters, resolveWireSize, supportsExtraBodyEnableThinking } from "./index";

function baseContext(partial: Partial<WireContext>): WireContext {
  return {
    adapterKey: "geekai.openai_chat",
    apiBaseUrl: "https://geekai.co/api/v1",
    apiKey: "sk-test",
    channelProfile: "aggregator_unified",
    endpointType: "openai",
    modelCode: "qwen3-235b-a22b",
    nativeFamily: "qwen3",
    providerCode: "geekai",
    providerTypeCode: "geekai",
    requestSchema: { requestShape: "openai_chat_compatible" },
    responseSchema: { responseShape: "openai_chat_completion" },
    ...partial,
  };
}

describe("llm-wire-adapter", () => {
  test("geekai chat adapter maps SDK-style extra_body enableThinking to HTTP top-level enable_thinking", () => {
    registerDefaultWireAdapters();
    const adapter = getAdapter("geekai.openai_chat");
    const encoded = adapter.encodeRequest(
      {
        messages: [{ role: "user", content: "hi" }],
        model: "qwen3-235b-a22b",
        parameters: { enableThinking: true, temperature: 0.2 },
        shape: "chat",
      },
      baseContext({
        requestSchema: {
          extraBodyFields: [
            {
              key: "enable_thinking",
              type: "boolean",
              wirePath: "extra_body.enable_thinking",
            },
          ],
          requestShape: "openai_chat_compatible",
        },
      }),
    );

    expect(encoded.url).toBe("https://geekai.co/api/v1/chat/completions");
    expect(encoded.body).toEqual({
      enable_thinking: true,
      messages: [{ role: "user", content: "hi" }],
      model: "qwen3-235b-a22b",
      temperature: 0.2,
    });
  });

  test("openai-compatible adapter maps disabled thinking switch to thinking.type", () => {
    registerDefaultWireAdapters();
    const adapter = getAdapter("openai.chat");
    const encoded = adapter.encodeRequest(
      {
        messages: [{ role: "user", content: "hi" }],
        model: "doubao-seed-2-0-pro-260215",
        parameters: { enableThinking: false },
        shape: "chat",
      },
      baseContext({
        adapterKey: "openai.chat",
        apiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        channelProfile: "direct",
        modelCode: "doubao-seed-2-0-pro-260215",
        nativeFamily: "doubao",
        providerCode: "volcengine-ark",
        providerTypeCode: "volcengine_ark",
        requestSchema: {
          extraBodyFields: [
            {
              key: "enableThinking",
              type: "boolean",
              feature: "thinking",
              wirePath: "thinking.type",
              wireTransform: "boolean:enabled_disabled",
            },
          ],
          requestShape: "openai_chat_compatible",
        },
      }),
    );

    expect(encoded.body).toEqual({
      messages: [{ role: "user", content: "hi" }],
      model: "doubao-seed-2-0-pro-260215",
      thinking: { type: "disabled" },
    });
  });

  test("seedream image adapter maps OpenAI square size to aggregator native 2K", () => {
    registerDefaultWireAdapters();
    const adapter = getAdapter("seedream.openai_images");
    const encoded = adapter.encodeRequest(
      {
        model: "doubao-seedream-3.0-t2i",
        prompt: "cat",
        shape: "image",
        size: "1024x1024",
      },
      baseContext({
        adapterKey: "seedream.openai_images",
        channelProfile: "aggregator_native",
        modelCode: "doubao-seedream-3.0-t2i",
        nativeFamily: "seedream",
        requestSchema: { requestShape: "openai_images_generation" },
        responseSchema: { responseShape: "openai_images_generation" },
      }),
    );

    expect(encoded.url).toBe("https://geekai.co/api/v1/images/generations");
    expect(encoded.body?.size).toBe("2K");
  });

  test("volcengine direct seedream maps OpenAI square size to native tier and decodes response", () => {
    registerDefaultWireAdapters();
    const adapter = getAdapter("volcengine_ark.openai_image");
    const ctx = baseContext({
      adapterKey: "volcengine_ark.openai_image",
      apiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      channelProfile: "direct",
      modelCode: "doubao-seedream-5-0-260128",
      nativeFamily: "seedream",
      providerCode: "volcengine-ark",
      providerTypeCode: "volcengine_ark",
      requestSchema: { requestShape: "openai_images_generation" },
      responseSchema: { responseShape: "openai_images_generation" },
    });
    const encoded = adapter.encodeRequest(
      {
        model: "doubao-seedream-5-0-260128",
        prompt: "cat",
        shape: "image",
        size: "1024x1024",
      },
      ctx,
    );

    expect(encoded.url).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");
    expect(encoded.body?.size).toBe("2k");
    expect(adapter.decodeResponse({ data: [{ url: "https://img.example.com/1.png" }] }, ctx)).toEqual({
      imageUrl: "https://img.example.com/1.png",
    });
  });

  test("transform helpers are table driven", () => {
    expect(resolveWireSize({ size: "1024*1024" }, { channelProfile: "aggregator_unified", nativeFamily: null })).toBe("1024x1024");
    expect(resolveWireSize({ size: "1024x1024" }, { channelProfile: "aggregator_native", nativeFamily: "seedream" })).toBe("2K");
    expect(resolveWireSize({ size: "1024x1024" }, { channelProfile: "direct", nativeFamily: "seedream" })).toBe("2k");
    expect(
      supportsExtraBodyEnableThinking({
        extraBodyFields: [{ key: "enable_thinking", type: "boolean", wirePath: "extra_body.enable_thinking" }],
        requestShape: "openai_chat_compatible",
      }),
    ).toBe(true);
    expect(
      supportsExtraBodyEnableThinking({
        extraBodyFields: [{ key: "stream", type: "boolean" }],
        requestShape: "openai_chat_compatible",
      }),
    ).toBe(false);
  });
});
