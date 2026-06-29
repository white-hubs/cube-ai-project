import { type WireAdapter } from "../wire-context.types";
import { decodeOpenAiImageResponse, encodeOpenAiImageRequest } from "./openai.images.adapter";

export const volcengineArkOpenAiImageAdapter: WireAdapter = {
  decodeResponse(raw) {
    return decodeOpenAiImageResponse(raw);
  },
  encodeRequest(input, ctx) {
    if (input.shape !== "image") {
      throw new Error("volcengine_ark.openai_image only supports image requests");
    }
    return encodeOpenAiImageRequest(input, ctx);
  },
  key: "volcengine_ark.openai_image",
};
