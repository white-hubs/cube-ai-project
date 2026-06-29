import { mergeExtraBodyFields } from "../transforms/extra-body-merge";
import { type EncodedHttpRequest, type WireAdapter } from "../wire-context.types";
import { openAiChatAdapter } from "./openai.chat.adapter";

export const geekAiOpenAiChatAdapter: WireAdapter = {
  decodeResponse(raw, ctx) {
    return openAiChatAdapter.decodeResponse(raw, ctx);
  },
  encodeRequest(input, ctx): EncodedHttpRequest {
    if (input.shape !== "chat") {
      throw new Error("geekai.openai_chat only supports chat requests");
    }
    const encoded = openAiChatAdapter.encodeRequest(input, ctx);
    return {
      ...encoded,
      body: mergeExtraBodyFields(encoded.body ?? {}, input.parameters, ctx.requestSchema),
    };
  },
  key: "geekai.openai_chat",
};
