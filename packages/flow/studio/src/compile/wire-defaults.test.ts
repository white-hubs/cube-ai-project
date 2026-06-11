import { describe, expect, test } from 'bun:test'
import type { LlmRequestSchema } from '@cube-ai/llm-core'
import { inferWireDefaults, type WireDefaultInput } from './wire-defaults'

function input(partial: Partial<WireDefaultInput>): WireDefaultInput {
  return {
    providerTypeCode: 'openai',
    modelCode: 'gpt-4o',
    endpointType: null,
    requestSchema: null,
    ...partial,
  }
}

const chatSchema: LlmRequestSchema = { requestShape: 'openai_chat_compatible' }
const imageSchema: LlmRequestSchema = { requestShape: 'openai_images_generation' }

describe('inferWireDefaults', () => {
  describe('native family inference (via result.nativeFamily)', () => {
    test.each([
      ['qwen3-235b-a22b', 'qwen3'],
      ['Qwen3.5-72B', 'qwen3'],
      ['doubao-seedream-3.0-t2i', 'seedream'],
      ['doubao-seedance-1.0', 'seedance'],
      ['deepseek-chat', 'deepseek'],
      ['gpt-image-1', 'gpt_image'],
      ['dall-e-3', 'gpt_image'],
      ['gpt-4o', 'gpt'],
      ['o1-preview', 'gpt'],
      ['o3-mini', 'gpt'],
      ['o4-mini', 'gpt'],
      ['qwen-max', 'qwen'],
      ['glm-4', null],
    ])('%s -> %s', (modelCode, family) => {
      expect(inferWireDefaults(input({ modelCode, endpointType: 'openai' })).nativeFamily).toBe(family)
    })
  })

  describe('geekai aggregator', () => {
    test('seedream image goes through aggregator_native seedream adapter', () => {
      expect(inferWireDefaults(input({
        providerTypeCode: 'geekai',
        modelCode: 'doubao-seedream-3.0-t2i',
        requestSchema: imageSchema,
      }))).toEqual({
        nativeFamily: 'seedream',
        channelProfile: 'aggregator_native',
        adapterKey: 'seedream.openai_images',
      })
    })

    test('non-seedream image uses unified openai.images adapter', () => {
      expect(inferWireDefaults(input({
        providerTypeCode: 'geekai',
        modelCode: 'gpt-image-1',
        endpointType: 'openai_image',
      }))).toEqual({
        nativeFamily: 'gpt_image',
        channelProfile: 'aggregator_unified',
        adapterKey: 'openai.images',
      })
    })

    test('chat uses geekai.openai_chat adapter', () => {
      expect(inferWireDefaults(input({
        providerTypeCode: 'geekai',
        modelCode: 'qwen3-235b-a22b',
        requestSchema: chatSchema,
      }))).toEqual({
        nativeFamily: 'qwen3',
        channelProfile: 'aggregator_unified',
        adapterKey: 'geekai.openai_chat',
      })
    })
  })

  describe('volcengine_ark direct', () => {
    test('seedream image uses volcengine_ark.openai_image adapter', () => {
      expect(inferWireDefaults(input({
        providerTypeCode: 'volcengine_ark',
        modelCode: 'doubao-seedream-5-0-260128',
        requestSchema: imageSchema,
      }))).toEqual({
        nativeFamily: 'seedream',
        channelProfile: 'direct',
        adapterKey: 'volcengine_ark.openai_image',
      })
    })

    test('non-seedream image falls back to openai.images', () => {
      expect(inferWireDefaults(input({
        providerTypeCode: 'volcengine_ark',
        modelCode: 'some-other-image-model',
        endpointType: 'openai_image',
      })).adapterKey).toBe('openai.images')
    })

    test('chat uses openai.chat direct', () => {
      expect(inferWireDefaults(input({
        providerTypeCode: 'volcengine_ark',
        modelCode: 'doubao-seed-2-0-pro',
        endpointType: 'openai',
      }))).toEqual({
        nativeFamily: null,
        channelProfile: 'direct',
        adapterKey: 'openai.chat',
      })
    })
  })

  describe('dashscope', () => {
    test('multimodal generation shape uses dashscope.multimodal_image', () => {
      expect(inferWireDefaults(input({
        providerTypeCode: 'dashscope',
        modelCode: 'qwen-image',
        requestSchema: { requestShape: 'dashscope_multimodal_generation' },
      }))).toEqual({
        nativeFamily: 'qwen',
        channelProfile: 'direct',
        adapterKey: 'dashscope.multimodal_image',
      })
    })

    test('dashscope_text2image endpointType also routes to dashscope.multimodal_image', () => {
      expect(inferWireDefaults(input({
        providerTypeCode: 'dashscope',
        modelCode: 'wanx-v1',
        endpointType: 'dashscope_text2image',
      })).adapterKey).toBe('dashscope.multimodal_image')
    })

    test('chat-compatible dashscope uses openai.chat', () => {
      expect(inferWireDefaults(input({
        providerTypeCode: 'dashscope',
        modelCode: 'qwen3-max',
        endpointType: 'openai',
      }))).toEqual({
        nativeFamily: 'qwen3',
        channelProfile: 'direct',
        adapterKey: 'openai.chat',
      })
    })
  })

  describe('generic fallback', () => {
    test('unknown provider with openai image shape uses direct openai.images', () => {
      expect(inferWireDefaults(input({
        providerTypeCode: 'custom_provider',
        modelCode: 'dall-e-3',
        requestSchema: imageSchema,
      }))).toEqual({
        nativeFamily: 'gpt_image',
        channelProfile: 'direct',
        adapterKey: 'openai.images',
      })
    })

    test('unknown provider with openai endpointType uses direct openai.chat', () => {
      expect(inferWireDefaults(input({
        providerTypeCode: 'custom_provider',
        modelCode: 'gpt-4o',
        endpointType: 'openai',
      }))).toEqual({
        nativeFamily: 'gpt',
        channelProfile: 'direct',
        adapterKey: 'openai.chat',
      })
    })

    test('unresolvable shape yields null profile and adapter', () => {
      expect(inferWireDefaults(input({
        providerTypeCode: 'custom_provider',
        modelCode: 'mystery-model',
        endpointType: 'grpc',
      }))).toEqual({
        nativeFamily: null,
        channelProfile: null,
        adapterKey: null,
      })
    })
  })
})
