import type { LlmRequestSchema, LlmResponseSchema } from "@cube-ai/llm-core";

export type ChannelProfile = "direct" | "aggregator_unified" | "aggregator_native";

export interface WireContext {
  providerTypeCode: string;
  providerCode: string;
  modelCode: string;
  apiBaseUrl: string;
  apiKey: string;
  endpointType: string | null;
  requestSchema: LlmRequestSchema;
  responseSchema: LlmResponseSchema | null;
  nativeFamily: string | null;
  channelProfile: ChannelProfile;
  adapterKey: string;
}

export interface CanonicalChatRequest {
  shape: "chat";
  messages: unknown[];
  model: string;
  parameters: Record<string, unknown>;
}

export interface CanonicalImageRequest {
  shape: "image";
  prompt: string;
  model: string;
  size?: string;
  sizeTier?: string;
  aspectRatio?: string;
  negativePrompt?: string;
  image?: string;
}

export interface EncodedHttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

export interface WireAdapter {
  readonly key: string;
  encodeRequest(input: CanonicalChatRequest | CanonicalImageRequest, ctx: WireContext): EncodedHttpRequest;
  decodeResponse(raw: unknown, ctx: WireContext): Record<string, unknown>;
}
