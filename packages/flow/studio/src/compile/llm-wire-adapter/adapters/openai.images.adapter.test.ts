import { describe, expect, test } from 'bun:test'
import type { WireContext } from '../wire-context.types'
import { decodeOpenAiImageResponse, encodeOpenAiImageRequest, openAiImagesAdapter } from './openai.images.adapter'

function imageContext(partial: Partial<WireContext> = {}): WireContext {
  return {
    providerTypeCode: 'openai',
    providerCode: 'openai',
    modelCode: 'gpt-image-1',
    apiBaseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    endpointType: 'openai_image',
    requestSchema: { requestShape: 'openai_images_generation' },
    responseSchema: { responseShape: 'openai_images_generation' },
    nativeFamily: 'gpt_image',
    channelProfile: 'direct',
    adapterKey: 'openai.images',
    ...partial,
  }
}

describe('encodeOpenAiImageRequest', () => {
  test('builds canonical images/generations request with normalized size', () => {
    const encoded = encodeOpenAiImageRequest({
      shape: 'image',
      model: 'gpt-image-1',
      prompt: 'a cat',
      size: '1024*1024',
    }, imageContext())

    expect(encoded.url).toBe('https://api.example.com/v1/images/generations')
    expect(encoded.method).toBe('POST')
    expect(encoded.headers.Authorization).toBe('Bearer sk-test')
    expect(encoded.body).toEqual({
      model: 'gpt-image-1',
      prompt: 'a cat',
      n: 1,
      response_format: 'url',
      size: '1024x1024',
    })
  })

  test('resolves URL for /api/v3 style base and bare host', () => {
    expect(encodeOpenAiImageRequest(
      { shape: 'image', model: 'm', prompt: 'p' },
      imageContext({ apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3' }),
    ).url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')

    expect(encodeOpenAiImageRequest(
      { shape: 'image', model: 'm', prompt: 'p' },
      imageContext({ apiBaseUrl: 'https://api.example.com' }),
    ).url).toBe('https://api.example.com/v1/images/generations')

    expect(encodeOpenAiImageRequest(
      { shape: 'image', model: 'm', prompt: 'p' },
      imageContext({ apiBaseUrl: 'https://api.example.com/v1/images/generations' }),
    ).url).toBe('https://api.example.com/v1/images/generations')
  })

  test('includes optional aspect ratio, negative prompt and reference image only when present', () => {
    const minimal = encodeOpenAiImageRequest({ shape: 'image', model: 'm', prompt: 'p' }, imageContext())
    expect(minimal.body).not.toHaveProperty('aspect_ratio')
    expect(minimal.body).not.toHaveProperty('negative_prompt')
    expect(minimal.body).not.toHaveProperty('image')

    const full = encodeOpenAiImageRequest({
      shape: 'image',
      model: 'm',
      prompt: 'p',
      aspectRatio: '16:9',
      negativePrompt: 'blurry',
      image: 'https://img.example.com/ref.png',
    }, imageContext())
    expect(full.body?.aspect_ratio).toBe('16:9')
    expect(full.body?.negative_prompt).toBe('blurry')
    expect(full.body?.image).toBe('https://img.example.com/ref.png')
  })

  test('applies seedream size tier mapping based on wire profile', () => {
    const encoded = encodeOpenAiImageRequest({
      shape: 'image',
      model: 'doubao-seedream-3.0-t2i',
      prompt: 'cat',
      size: '1024x1024',
    }, imageContext({ nativeFamily: 'seedream', channelProfile: 'aggregator_native' }))
    expect(encoded.body?.size).toBe('2K')
  })
})

describe('decodeOpenAiImageResponse', () => {
  test('extracts first data item url', () => {
    expect(decodeOpenAiImageResponse({ data: [{ url: 'https://img.example.com/1.png' }] }))
      .toEqual({ imageUrl: 'https://img.example.com/1.png' })
  })

  test('returns empty imageUrl for malformed payloads', () => {
    expect(decodeOpenAiImageResponse(null)).toEqual({ imageUrl: '' })
    expect(decodeOpenAiImageResponse([])).toEqual({ imageUrl: '' })
    expect(decodeOpenAiImageResponse({ data: [] })).toEqual({ imageUrl: '' })
    expect(decodeOpenAiImageResponse({ data: [{ b64_json: 'abc' }] })).toEqual({ imageUrl: '' })
  })
})

describe('openAiImagesAdapter', () => {
  test('rejects chat-shaped input', () => {
    expect(() => openAiImagesAdapter.encodeRequest({
      shape: 'chat',
      model: 'gpt-4o',
      messages: [],
      parameters: {},
    }, imageContext())).toThrow('openai.images only supports image requests')
  })

  test('delegates decodeResponse to shared decoder', () => {
    expect(openAiImagesAdapter.decodeResponse({ data: [{ url: 'u' }] }, imageContext())).toEqual({ imageUrl: 'u' })
  })
})
