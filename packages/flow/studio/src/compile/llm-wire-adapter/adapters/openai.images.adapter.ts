import { resolveOpenAiImagesGenerationUrl } from "../../flow-runtime-mapper";
import { resolveWireSize } from "../transforms/size-transform";
import { type CanonicalImageRequest, type EncodedHttpRequest, type WireAdapter, type WireContext } from "../wire-context.types";

export function encodeOpenAiImageRequest(input: CanonicalImageRequest, ctx: WireContext): EncodedHttpRequest {
  const body: Record<string, unknown> = {
    model: input.model,
    n: 1,
    prompt: input.prompt,
    response_format: "url",
    size: resolveWireSize(input, {
      nativeFamily: ctx.nativeFamily,
      channelProfile: ctx.channelProfile,
    }),
  };
  if (input.aspectRatio) {
    body.aspect_ratio = input.aspectRatio;
  }
  if (input.negativePrompt) {
    body.negative_prompt = input.negativePrompt;
  }
  if (input.image) {
    body.image = input.image;
  }
  return {
    body,
    headers: {
      Authorization: ctx.apiKey ? `Bearer ${ctx.apiKey}` : "",
      "Content-Type": "application/json",
    },
    method: ctx.requestSchema.method ?? "POST",
    url: resolveOpenAiImagesGenerationUrl(ctx.apiBaseUrl),
  };
}

export function decodeOpenAiImageResponse(raw: unknown): Record<string, unknown> {
  const payload =
    raw !== null && raw !== undefined && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const data = Array.isArray(payload.data) ? payload.data : [];
  const first = data[0];
  const item =
    first !== null && first !== undefined && typeof first === "object" && !Array.isArray(first) ? (first as Record<string, unknown>) : {};
  const url = typeof item.url === "string" ? item.url : "";
  return { imageUrl: url };
}

export const openAiImagesAdapter: WireAdapter = {
  decodeResponse(raw) {
    return decodeOpenAiImageResponse(raw);
  },
  encodeRequest(input, ctx) {
    if (input.shape !== "image") {
      throw new Error("openai.images only supports image requests");
    }
    return encodeOpenAiImageRequest(input, ctx);
  },
  key: "openai.images",
};
