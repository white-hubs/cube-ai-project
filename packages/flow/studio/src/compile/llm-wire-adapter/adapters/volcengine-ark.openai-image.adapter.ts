import type { WireAdapter } from '../wire-context.types'
import { decodeOpenAiImageResponse, encodeOpenAiImageRequest } from './openai.images.adapter'

export const volcengineArkOpenAiImageAdapter: WireAdapter = {
  key: 'volcengine_ark.openai_image',
  encodeRequest(input, ctx) {
    if (input.shape !== 'image') {
      throw new Error('volcengine_ark.openai_image only supports image requests')
    }
    return encodeOpenAiImageRequest(input, ctx)
  },
  decodeResponse(raw) {
    return decodeOpenAiImageResponse(raw)
  },
}
