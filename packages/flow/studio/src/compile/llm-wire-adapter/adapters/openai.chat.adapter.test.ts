import { describe, expect, test } from 'bun:test'
import type { WireContext } from '../wire-context.types'
import { joinUrl, openAiChatAdapter } from './openai.chat.adapter'

function chatContext(partial: Partial<WireContext> = {}): WireContext {
  return {
    providerTypeCode: 'openai',
    providerCode: 'openai',
    modelCode: 'gpt-4o',
    apiBaseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    endpointType: 'openai',
    requestSchema: { requestShape: 'openai_chat_compatible' },
    responseSchema: { responseShape: 'openai_chat_completion' },
    nativeFamily: 'gpt',
    channelProfile: 'direct',
    adapterKey: 'openai.chat',
    ...partial,
  }
}

describe('joinUrl', () => {
  test('joins base and path with single slash', () => {
    expect(joinUrl('https://api.example.com/v1', '/chat/completions')).toBe('https://api.example.com/v1/chat/completions')
    expect(joinUrl('https://api.example.com/v1/', 'chat/completions')).toBe('https://api.example.com/v1/chat/completions')
  })

  test('strips trailing slashes and avoids duplicate suffix', () => {
    expect(joinUrl('https://api.example.com/v1///', '/chat/completions')).toBe('https://api.example.com/v1/chat/completions')
    expect(joinUrl('https://api.example.com/v1/chat/completions', '/chat/completions')).toBe('https://api.example.com/v1/chat/completions')
  })
})

describe('openAiChatAdapter.encodeRequest', () => {
  test('builds POST request with bearer auth and default endpoint path', () => {
    const encoded = openAiChatAdapter.encodeRequest({
      shape: 'chat',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      parameters: { temperature: 0.7, max_tokens: 128 },
    }, chatContext())

    expect(encoded.url).toBe('https://api.example.com/v1/chat/completions')
    expect(encoded.method).toBe('POST')
    expect(encoded.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test',
    })
    expect(encoded.body).toEqual({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      max_tokens: 128,
    })
  })

  test('honors schema endpointPath and method overrides', () => {
    const encoded = openAiChatAdapter.encodeRequest({
      shape: 'chat',
      model: 'gpt-4o',
      messages: [],
      parameters: {},
    }, chatContext({
      requestSchema: { requestShape: 'openai_chat_compatible', endpointPath: '/custom/chat', method: 'GET' },
    }))

    expect(encoded.url).toBe('https://api.example.com/v1/custom/chat')
    expect(encoded.method).toBe('GET')
  })

  test('strips enableThinking parameters from body unless schema declares a wire field', () => {
    const encoded = openAiChatAdapter.encodeRequest({
      shape: 'chat',
      model: 'gpt-4o',
      messages: [],
      parameters: { enableThinking: true, enable_thinking: true, temperature: 0.1 },
    }, chatContext())

    expect(encoded.body).toEqual({ model: 'gpt-4o', messages: [], temperature: 0.1 })
  })

  test('empty apiKey produces empty Authorization header', () => {
    const encoded = openAiChatAdapter.encodeRequest({
      shape: 'chat',
      model: 'gpt-4o',
      messages: [],
      parameters: {},
    }, chatContext({ apiKey: '' }))

    expect(encoded.headers.Authorization).toBe('')
  })

  test('rejects image-shaped input', () => {
    expect(() => openAiChatAdapter.encodeRequest({
      shape: 'image',
      model: 'gpt-image-1',
      prompt: 'cat',
    }, chatContext())).toThrow('openai.chat only supports chat requests')
  })
})

describe('openAiChatAdapter.decodeResponse', () => {
  const ctx = chatContext()

  test('extracts first choice message content', () => {
    expect(openAiChatAdapter.decodeResponse({
      choices: [{ message: { role: 'assistant', content: 'hello' } }],
    }, ctx)).toEqual({ text: 'hello' })
  })

  test('returns empty text for malformed payloads', () => {
    expect(openAiChatAdapter.decodeResponse(null, ctx)).toEqual({ text: '' })
    expect(openAiChatAdapter.decodeResponse('oops', ctx)).toEqual({ text: '' })
    expect(openAiChatAdapter.decodeResponse({ choices: [] }, ctx)).toEqual({ text: '' })
    expect(openAiChatAdapter.decodeResponse({ choices: [{ message: { content: 42 } }] }, ctx)).toEqual({ text: '' })
    expect(openAiChatAdapter.decodeResponse({ choices: [{}] }, ctx)).toEqual({ text: '' })
  })
})
