import { mergeExtraBodyFields } from "../transforms/extra-body-merge";
import { type CanonicalChatRequest, type EncodedHttpRequest, type WireAdapter } from "../wire-context.types";

export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/u, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (base.endsWith(suffix)) {
    return base;
  }
  return `${base}${suffix}`;
}

function chatBody(input: CanonicalChatRequest): Record<string, unknown> {
  const { enableThinking: _enableThinking, enable_thinking: _enableThinkingSnake, ...parameters } = input.parameters;
  return {
    messages: input.messages,
    model: input.model,
    ...parameters,
  };
}

export const openAiChatAdapter: WireAdapter = {
  decodeResponse(raw) {
    const payload =
      raw !== null && raw !== undefined && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = choices[0];
    const message =
      first !== null && first !== undefined && typeof first === "object" && !Array.isArray(first)
        ? (first as Record<string, unknown>).message
        : null;
    const text =
      message !== null && message !== undefined && typeof message === "object" && !Array.isArray(message)
        ? (message as Record<string, unknown>).content
        : null;
    return { text: typeof text === "string" ? text : "" };
  },
  encodeRequest(input, ctx): EncodedHttpRequest {
    if (input.shape !== "chat") {
      throw new Error("openai.chat only supports chat requests");
    }
    const endpointPath = ctx.requestSchema.endpointPath ?? "/chat/completions";
    return {
      url: joinUrl(ctx.apiBaseUrl, endpointPath),
      method: ctx.requestSchema.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: ctx.apiKey ? `Bearer ${ctx.apiKey}` : "",
      },
      body: mergeExtraBodyFields(chatBody(input), input.parameters, ctx.requestSchema),
    };
  },
  key: "openai.chat",
};
