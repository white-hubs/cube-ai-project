import { type WireAdapter } from "../wire-context.types";
import { decodeOpenAiImageResponse, encodeOpenAiImageRequest } from "./openai.images.adapter";

export const seedreamOpenAiImagesAdapter: WireAdapter = {
  decodeResponse(raw) {
    return decodeOpenAiImageResponse(raw);
  },
  encodeRequest(input, ctx) {
    if (input.shape !== "image") {
      throw new Error("seedream.openai_images only supports image requests");
    }
    return encodeOpenAiImageRequest(input, ctx);
  },
  key: "seedream.openai_images",
};
