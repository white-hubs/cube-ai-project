import { mergeExtraBodyFields } from '../transforms/extra-body-merge'
import type { EncodedHttpRequest, WireAdapter } from '../wire-context.types'
import { openAiChatAdapter } from './openai.chat.adapter'

export const geekAiOpenAiChatAdapter: WireAdapter = {
  key: 'geekai.openai_chat',
  encodeRequest(input, ctx): EncodedHttpRequest {
    if (input.shape !== 'chat') {
      throw new Error('geekai.openai_chat only supports chat requests')
    }
    const encoded = openAiChatAdapter.encodeRequest(input, ctx)
    return {
      ...encoded,
      body: mergeExtraBodyFields(encoded.body ?? {}, input.parameters, ctx.requestSchema),
    }
  },
  decodeResponse(raw, ctx) {
    return openAiChatAdapter.decodeResponse(raw, ctx)
  },
}
