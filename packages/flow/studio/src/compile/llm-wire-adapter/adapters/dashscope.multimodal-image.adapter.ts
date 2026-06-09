import type { EncodedHttpRequest, WireAdapter } from '../wire-context.types'
import { joinUrl } from './openai.chat.adapter'

function dashscopeImageUrl(raw: unknown): string {
  const payload = raw != null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const output = payload.output != null && typeof payload.output === 'object' && !Array.isArray(payload.output)
    ? payload.output as Record<string, unknown>
    : {}
  const choices = Array.isArray(output.choices) ? output.choices : []
  const first = choices[0]
  const message = first != null && typeof first === 'object' && !Array.isArray(first)
    ? (first as Record<string, unknown>).message
    : null
  const content = message != null && typeof message === 'object' && !Array.isArray(message)
    ? (message as Record<string, unknown>).content
    : null
  if (!Array.isArray(content)) {
    return ''
  }
  for (const part of content) {
    if (part != null && typeof part === 'object' && !Array.isArray(part)) {
      const image = (part as Record<string, unknown>).image ?? (part as Record<string, unknown>).image_url
      if (typeof image === 'string' && image.trim() !== '') {
        return image.trim()
      }
    }
  }
  return ''
}

export const dashscopeMultimodalImageAdapter: WireAdapter = {
  key: 'dashscope.multimodal_image',
  encodeRequest(input, ctx): EncodedHttpRequest {
    if (input.shape !== 'image') {
      throw new Error('dashscope.multimodal_image only supports image requests')
    }
    return {
      url: joinUrl(ctx.apiBaseUrl, ctx.requestSchema.endpointPath ?? '/api/v1/services/aigc/multimodal-generation/generation'),
      method: ctx.requestSchema.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: ctx.apiKey ? `Bearer ${ctx.apiKey}` : '',
      },
      body: {
        model: input.model,
        input: {
          messages: [{ role: 'user', content: [{ text: input.prompt }] }],
        },
        parameters: {
          ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
          ...(input.size ? { size: input.size } : {}),
        },
      },
    }
  },
  decodeResponse(raw) {
    return { imageUrl: dashscopeImageUrl(raw) }
  },
}
