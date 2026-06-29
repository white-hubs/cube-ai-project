import { describe, expect, test } from "bun:test";

import { type LlmRequestSchema } from "@cube-ai/llm-core";

import { type WireDefaultInput, inferWireDefaults } from "./wire-defaults";

function input(partial: Partial<WireDefaultInput>): WireDefaultInput {
  return {
    endpointType: null,
    modelCode: "gpt-4o",
    providerTypeCode: "openai",
    requestSchema: null,
    ...partial,
  };
}

const chatSchema: LlmRequestSchema = { requestShape: "openai_chat_compatible" };
const imageSchema: LlmRequestSchema = { requestShape: "openai_images_generation" };

describe("inferWireDefaults", () => {
  describe("native family inference (via result.nativeFamily)", () => {
    test.each([
      ["qwen3-235b-a22b", "qwen3"],
      ["Qwen3.5-72B", "qwen3"],
      ["doubao-seedream-3.0-t2i", "seedream"],
      ["doubao-seedance-1.0", "seedance"],
      ["deepseek-chat", "deepseek"],
      ["gpt-image-1", "gpt_image"],
      ["dall-e-3", "gpt_image"],
      ["gpt-4o", "gpt"],
      ["o1-preview", "gpt"],
      ["o3-mini", "gpt"],
      ["o4-mini", "gpt"],
      ["qwen-max", "qwen"],
      ["glm-4", null],
    ])("%s -> %s", (modelCode, family) => {
      expect(inferWireDefaults(input({ endpointType: "openai", modelCode })).nativeFamily).toBe(family);
    });
  });

  describe("geekai aggregator", () => {
    test("seedream image goes through aggregator_native seedream adapter", () => {
      expect(
        inferWireDefaults(
          input({
            modelCode: "doubao-seedream-3.0-t2i",
            providerTypeCode: "geekai",
            requestSchema: imageSchema,
          }),
        ),
      ).toEqual({
        adapterKey: "seedream.openai_images",
        channelProfile: "aggregator_native",
        nativeFamily: "seedream",
      });
    });

    test("non-seedream image uses unified openai.images adapter", () => {
      expect(
        inferWireDefaults(
          input({
            endpointType: "openai_image",
            modelCode: "gpt-image-1",
            providerTypeCode: "geekai",
          }),
        ),
      ).toEqual({
        adapterKey: "openai.images",
        channelProfile: "aggregator_unified",
        nativeFamily: "gpt_image",
      });
    });

    test("chat uses geekai.openai_chat adapter", () => {
      expect(
        inferWireDefaults(
          input({
            modelCode: "qwen3-235b-a22b",
            providerTypeCode: "geekai",
            requestSchema: chatSchema,
          }),
        ),
      ).toEqual({
        adapterKey: "geekai.openai_chat",
        channelProfile: "aggregator_unified",
        nativeFamily: "qwen3",
      });
    });
  });

  describe("volcengine_ark direct", () => {
    test("seedream image uses volcengine_ark.openai_image adapter", () => {
      expect(
        inferWireDefaults(
          input({
            modelCode: "doubao-seedream-5-0-260128",
            providerTypeCode: "volcengine_ark",
            requestSchema: imageSchema,
          }),
        ),
      ).toEqual({
        adapterKey: "volcengine_ark.openai_image",
        channelProfile: "direct",
        nativeFamily: "seedream",
      });
    });

    test("non-seedream image falls back to openai.images", () => {
      expect(
        inferWireDefaults(
          input({
            endpointType: "openai_image",
            modelCode: "some-other-image-model",
            providerTypeCode: "volcengine_ark",
          }),
        ).adapterKey,
      ).toBe("openai.images");
    });

    test("chat uses openai.chat direct", () => {
      expect(
        inferWireDefaults(
          input({
            endpointType: "openai",
            modelCode: "doubao-seed-2-0-pro",
            providerTypeCode: "volcengine_ark",
          }),
        ),
      ).toEqual({
        adapterKey: "openai.chat",
        channelProfile: "direct",
        nativeFamily: null,
      });
    });
  });

  describe("dashscope", () => {
    test("multimodal generation shape uses dashscope.multimodal_image", () => {
      expect(
        inferWireDefaults(
          input({
            modelCode: "qwen-image",
            providerTypeCode: "dashscope",
            requestSchema: { requestShape: "dashscope_multimodal_generation" },
          }),
        ),
      ).toEqual({
        adapterKey: "dashscope.multimodal_image",
        channelProfile: "direct",
        nativeFamily: "qwen",
      });
    });

    test("dashscope_text2image endpointType also routes to dashscope.multimodal_image", () => {
      expect(
        inferWireDefaults(
          input({
            endpointType: "dashscope_text2image",
            modelCode: "wanx-v1",
            providerTypeCode: "dashscope",
          }),
        ).adapterKey,
      ).toBe("dashscope.multimodal_image");
    });

    test("chat-compatible dashscope uses openai.chat", () => {
      expect(
        inferWireDefaults(
          input({
            endpointType: "openai",
            modelCode: "qwen3-max",
            providerTypeCode: "dashscope",
          }),
        ),
      ).toEqual({
        adapterKey: "openai.chat",
        channelProfile: "direct",
        nativeFamily: "qwen3",
      });
    });
  });

  describe("generic fallback", () => {
    test("unknown provider with openai image shape uses direct openai.images", () => {
      expect(
        inferWireDefaults(
          input({
            modelCode: "dall-e-3",
            providerTypeCode: "custom_provider",
            requestSchema: imageSchema,
          }),
        ),
      ).toEqual({
        adapterKey: "openai.images",
        channelProfile: "direct",
        nativeFamily: "gpt_image",
      });
    });

    test("unknown provider with openai endpointType uses direct openai.chat", () => {
      expect(
        inferWireDefaults(
          input({
            endpointType: "openai",
            modelCode: "gpt-4o",
            providerTypeCode: "custom_provider",
          }),
        ),
      ).toEqual({
        adapterKey: "openai.chat",
        channelProfile: "direct",
        nativeFamily: "gpt",
      });
    });

    test("unresolvable shape yields null profile and adapter", () => {
      expect(
        inferWireDefaults(
          input({
            endpointType: "grpc",
            modelCode: "mystery-model",
            providerTypeCode: "custom_provider",
          }),
        ),
      ).toEqual({
        adapterKey: null,
        channelProfile: null,
        nativeFamily: null,
      });
    });
  });
});
