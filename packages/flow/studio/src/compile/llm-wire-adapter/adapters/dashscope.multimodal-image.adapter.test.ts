import { describe, expect, test } from 'bun:test'
import type { WireContext } from '../wire-context.types'
import { dashscopeMultimodalImageAdapter } from './dashscope.multimodal-image.adapter'

function dashscopeContext(partial: Partial<WireContext> = {}): WireContext {
  return {
    providerTypeCode: 'dashscope',
    providerCode: 'dashscope',
    modelCode: 'qwen-image',
    apiBaseUrl: 'https://dashscope.aliyuncs.com',
    apiKey: 'sk-test',
    endpointType: 'dashscope_text2image',
    requestSchema: { requestShape: 'dashscope_multimodal_generation' },
    responseSchema: { responseShape: 'dashscope_multimodal_generation' },
    nativeFamily: 'qwen',
    channelProfile: 'direct',
    adapterKey: 'dashscope.multimodal_image',
    ...partial,
  }
}

describe('dashscopeMultimodalImageAdapter.encodeRequest', () => {
  test('wraps prompt in dashscope multimodal message envelope with default endpoint', () => {
    const encoded = dashscopeMultimodalImageAdapter.encodeRequest({
      shape: 'image',
      model: 'qwen-image',
      prompt: 'a cat',
    }, dashscopeContext())

    expect(encoded.url).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
    expect(encoded.method).toBe('POST')
    expect(encoded.headers.Authorization).toBe('Bearer sk-test')
    expect(encoded.body).toEqual({
      model: 'qwen-image',
      input: {
        messages: [{ role: 'user', content: [{ text: 'a cat' }] }],
      },
      parameters: {},
    })
  })

  test('includes negative_prompt and size in parameters only when provided', () => {
    const encoded = dashscopeMultimodalImageAdapter.encodeRequest({
      shape: 'image',
      model: 'qwen-image',
      prompt: 'a cat',
      negativePrompt: 'blurry',
      size: '1328*1328',
    }, dashscopeContext())

    expect(encoded.body?.parameters).toEqual({
      negative_prompt: 'blurry',
      size: '1328*1328',
    })
  })

  test('honors schema endpointPath override', () => {
    const encoded = dashscopeMultimodalImageAdapter.encodeRequest({
      shape: 'image',
      model: 'qwen-image',
      prompt: 'p',
    }, dashscopeContext({
      requestSchema: { requestShape: 'dashscope_multimodal_generation', endpointPath: '/custom/path' },
    }))

    expect(encoded.url).toBe('https://dashscope.aliyuncs.com/custom/path')
  })

  test('rejects chat-shaped input', () => {
    expect(() => dashscopeMultimodalImageAdapter.encodeRequest({
      shape: 'chat',
      model: 'qwen3-max',
      messages: [],
      parameters: {},
    }, dashscopeContext())).toThrow('dashscope.multimodal_image only supports image requests')
  })
})

describe('dashscopeMultimodalImageAdapter.decodeResponse', () => {
  const ctx = dashscopeContext()

  test('extracts image url from output.choices message content parts', () => {
    expect(dashscopeMultimodalImageAdapter.decodeResponse({
      output: {
        choices: [{
          message: {
            role: 'assistant',
            content: [{ text: 'caption' }, { image: ' https://img.example.com/1.png ' }],
          },
        }],
      },
    }, ctx)).toEqual({ imageUrl: 'https://img.example.com/1.png' })
  })

  test('falls back to image_url field', () => {
    expect(dashscopeMultimodalImageAdapter.decodeResponse({
      output: {
        choices: [{ message: { content: [{ image_url: 'https://img.example.com/2.png' }] } }],
      },
    }, ctx)).toEqual({ imageUrl: 'https://img.example.com/2.png' })
  })

  test('returns empty imageUrl for malformed or empty payloads', () => {
    expect(dashscopeMultimodalImageAdapter.decodeResponse(null, ctx)).toEqual({ imageUrl: '' })
    expect(dashscopeMultimodalImageAdapter.decodeResponse({}, ctx)).toEqual({ imageUrl: '' })
    expect(dashscopeMultimodalImageAdapter.decodeResponse({ output: { choices: [] } }, ctx)).toEqual({ imageUrl: '' })
    expect(dashscopeMultimodalImageAdapter.decodeResponse({
      output: { choices: [{ message: { content: 'not-an-array' } }] },
    }, ctx)).toEqual({ imageUrl: '' })
    expect(dashscopeMultimodalImageAdapter.decodeResponse({
      output: { choices: [{ message: { content: [{ image: '   ' }] } }] },
    }, ctx)).toEqual({ imageUrl: '' })
  })
})
