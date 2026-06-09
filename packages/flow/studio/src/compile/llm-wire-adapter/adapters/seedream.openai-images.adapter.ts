import type { WireAdapter } from '../wire-context.types'
import { decodeOpenAiImageResponse, encodeOpenAiImageRequest } from './openai.images.adapter'

export const seedreamOpenAiImagesAdapter: WireAdapter = {
  key: 'seedream.openai_images',
  encodeRequest(input, ctx) {
    if (input.shape !== 'image') {
      throw new Error('seedream.openai_images only supports image requests')
    }
    return encodeOpenAiImageRequest(input, ctx)
  },
  decodeResponse(raw) {
    return decodeOpenAiImageResponse(raw)
  },
}
