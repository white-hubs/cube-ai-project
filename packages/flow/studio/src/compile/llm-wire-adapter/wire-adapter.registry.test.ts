import { describe, expect, test } from 'bun:test'
import {
  getAdapter,
  registerDefaultWireAdapters,
  resolveWireSize,
  supportsExtraBodyEnableThinking,
  type WireContext,
} from './index'

function baseContext(partial: Partial<WireContext>): WireContext {
  return {
    providerTypeCode: 'geekai',
    providerCode: 'geekai',
    modelCode: 'qwen3-235b-a22b',
    apiBaseUrl: 'https://geekai.co/api/v1',
    apiKey: 'sk-test',
    endpointType: 'openai',
    requestSchema: { requestShape: 'openai_chat_compatible' },
    responseSchema: { responseShape: 'openai_chat_completion' },
    nativeFamily: 'qwen3',
    channelProfile: 'aggregator_unified',
    adapterKey: 'geekai.openai_chat',
    ...partial,
  }
}

describe('llm-wire-adapter', () => {
  test('geekai chat adapter maps SDK-style extra_body enableThinking to HTTP top-level enable_thinking', () => {
    registerDefaultWireAdapters()
    const adapter = getAdapter('geekai.openai_chat')
    const encoded = adapter.encodeRequest({
      shape: 'chat',
      model: 'qwen3-235b-a22b',
      messages: [{ role: 'user', content: 'hi' }],
      parameters: { enableThinking: true, temperature: 0.2 },
    }, baseContext({
      requestSchema: {
        requestShape: 'openai_chat_compatible',
        extraBodyFields: [
          {
            key: 'enable_thinking',
            type: 'boolean',
            wirePath: 'extra_body.enable_thinking',
          },
        ],
      },
    }))

    expect(encoded.url).toBe('https://geekai.co/api/v1/chat/completions')
    expect(encoded.body).toEqual({
      model: 'qwen3-235b-a22b',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      enable_thinking: true,
    })
  })

  test('openai-compatible adapter maps disabled thinking switch to thinking.type', () => {
    registerDefaultWireAdapters()
    const adapter = getAdapter('openai.chat')
    const encoded = adapter.encodeRequest({
      shape: 'chat',
      model: 'doubao-seed-2-0-pro-260215',
      messages: [{ role: 'user', content: 'hi' }],
      parameters: { enableThinking: false },
    }, baseContext({
      providerTypeCode: 'volcengine_ark',
      providerCode: 'volcengine-ark',
      modelCode: 'doubao-seed-2-0-pro-260215',
      apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      nativeFamily: 'doubao',
      channelProfile: 'direct',
      adapterKey: 'openai.chat',
      requestSchema: {
        requestShape: 'openai_chat_compatible',
        extraBodyFields: [
          {
            key: 'enableThinking',
            type: 'boolean',
            feature: 'thinking',
            wirePath: 'thinking.type',
            wireTransform: 'boolean:enabled_disabled',
          },
        ],
      },
    }))

    expect(encoded.body).toEqual({
      model: 'doubao-seed-2-0-pro-260215',
      messages: [{ role: 'user', content: 'hi' }],
      thinking: { type: 'disabled' },
    })
  })

  test('seedream image adapter maps OpenAI square size to aggregator native 2K', () => {
    registerDefaultWireAdapters()
    const adapter = getAdapter('seedream.openai_images')
    const encoded = adapter.encodeRequest({
      shape: 'image',
      model: 'doubao-seedream-3.0-t2i',
      prompt: 'cat',
      size: '1024x1024',
    }, baseContext({
      modelCode: 'doubao-seedream-3.0-t2i',
      nativeFamily: 'seedream',
      channelProfile: 'aggregator_native',
      adapterKey: 'seedream.openai_images',
      requestSchema: { requestShape: 'openai_images_generation' },
      responseSchema: { responseShape: 'openai_images_generation' },
    }))

    expect(encoded.url).toBe('https://geekai.co/api/v1/images/generations')
    expect(encoded.body?.size).toBe('2K')
  })

  test('volcengine direct seedream maps OpenAI square size to native tier and decodes response', () => {
    registerDefaultWireAdapters()
    const adapter = getAdapter('volcengine_ark.openai_image')
    const ctx = baseContext({
      providerTypeCode: 'volcengine_ark',
      providerCode: 'volcengine-ark',
      modelCode: 'doubao-seedream-5-0-260128',
      apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      nativeFamily: 'seedream',
      channelProfile: 'direct',
      adapterKey: 'volcengine_ark.openai_image',
      requestSchema: { requestShape: 'openai_images_generation' },
      responseSchema: { responseShape: 'openai_images_generation' },
    })
    const encoded = adapter.encodeRequest({
      shape: 'image',
      model: 'doubao-seedream-5-0-260128',
      prompt: 'cat',
      size: '1024x1024',
    }, ctx)

    expect(encoded.url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')
    expect(encoded.body?.size).toBe('2k')
    expect(adapter.decodeResponse({ data: [{ url: 'https://img.example.com/1.png' }] }, ctx)).toEqual({
      imageUrl: 'https://img.example.com/1.png',
    })
  })

  test('transform helpers are table driven', () => {
    expect(resolveWireSize({ size: '1024*1024' }, { nativeFamily: null, channelProfile: 'aggregator_unified' })).toBe('1024x1024')
    expect(resolveWireSize({ size: '1024x1024' }, { nativeFamily: 'seedream', channelProfile: 'aggregator_native' })).toBe('2K')
    expect(resolveWireSize({ size: '1024x1024' }, { nativeFamily: 'seedream', channelProfile: 'direct' })).toBe('2k')
    expect(supportsExtraBodyEnableThinking({
      requestShape: 'openai_chat_compatible',
      extraBodyFields: [{ key: 'enable_thinking', type: 'boolean', wirePath: 'extra_body.enable_thinking' }],
    })).toBe(true)
    expect(supportsExtraBodyEnableThinking({
      requestShape: 'openai_chat_compatible',
      extraBodyFields: [{ key: 'stream', type: 'boolean' }],
    })).toBe(false)
  })
})
