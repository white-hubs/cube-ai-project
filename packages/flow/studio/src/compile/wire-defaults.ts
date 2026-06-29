// Wire-default inference extracted verbatim from ai-application model-metadata-inference.service.ts.
// llm-core keeps `inferWireDefaults` private inside ModelMetadataInferenceService, so the studio
// compiler carries its own copy of this pure function (ADR-0014: compile algorithm unchanged).
import { type LlmRequestSchema } from "@cube-ai/llm-core";

import { type ChannelProfile } from "./llm-wire-adapter/wire-context.types";

export interface WireDefaultInput {
  providerTypeCode: string;
  modelCode: string;
  endpointType: string | null;
  requestSchema: LlmRequestSchema | null;
}

export interface WireDefaultResult {
  nativeFamily: string | null;
  channelProfile: ChannelProfile | null;
  adapterKey: string | null;
}

function inferNativeFamily(modelCode: string): string | null {
  const value = modelCode.toLowerCase();
  if (value.startsWith("qwen3-") || value.startsWith("qwen3.")) {
    return "qwen3";
  }
  if (value.startsWith("doubao-seedream")) {
    return "seedream";
  }
  if (value.startsWith("doubao-seedance")) {
    return "seedance";
  }
  if (value.startsWith("deepseek-")) {
    return "deepseek";
  }
  if (value.startsWith("gpt-image") || value.startsWith("dall-e")) {
    return "gpt_image";
  }
  if (value.startsWith("gpt-") || value.startsWith("o1") || value.startsWith("o3") || value.startsWith("o4-")) {
    return "gpt";
  }
  if (value.startsWith("qwen-")) {
    return "qwen";
  }
  return null;
}

function isOpenAiChatShape(input: WireDefaultInput): boolean {
  return input.requestSchema?.requestShape === "openai_chat_compatible" || input.endpointType === "openai";
}

function isOpenAiImageShape(input: WireDefaultInput): boolean {
  return input.requestSchema?.requestShape === "openai_images_generation" || input.endpointType === "openai_image";
}

export function inferWireDefaults(input: WireDefaultInput): WireDefaultResult {
  const nativeFamily = inferNativeFamily(input.modelCode);

  if (input.providerTypeCode === "geekai") {
    if (isOpenAiImageShape(input)) {
      if (nativeFamily === "seedream") {
        return { adapterKey: "seedream.openai_images", channelProfile: "aggregator_native", nativeFamily };
      }
      return { adapterKey: "openai.images", channelProfile: "aggregator_unified", nativeFamily };
    }
    if (isOpenAiChatShape(input)) {
      return { adapterKey: "geekai.openai_chat", channelProfile: "aggregator_unified", nativeFamily };
    }
  }

  if (input.providerTypeCode === "volcengine_ark") {
    if (isOpenAiImageShape(input)) {
      return {
        adapterKey: nativeFamily === "seedream" ? "volcengine_ark.openai_image" : "openai.images",
        channelProfile: "direct",
        nativeFamily,
      };
    }
    if (isOpenAiChatShape(input)) {
      return { adapterKey: "openai.chat", channelProfile: "direct", nativeFamily };
    }
  }

  if (input.providerTypeCode === "dashscope") {
    if (input.requestSchema?.requestShape === "dashscope_multimodal_generation" || input.endpointType === "dashscope_text2image") {
      return { adapterKey: "dashscope.multimodal_image", channelProfile: "direct", nativeFamily };
    }
    if (isOpenAiChatShape(input)) {
      return { adapterKey: "openai.chat", channelProfile: "direct", nativeFamily };
    }
  }

  if (isOpenAiImageShape(input)) {
    return { adapterKey: "openai.images", channelProfile: "direct", nativeFamily };
  }
  if (isOpenAiChatShape(input)) {
    return { adapterKey: "openai.chat", channelProfile: "direct", nativeFamily };
  }
  return { adapterKey: null, channelProfile: null, nativeFamily };
}
