import { describe, expect, test } from 'bun:test'
import type { LlmRequestSchema, LlmSchemaField } from '@cube-ai/llm-core'
import {
  mergeExtraBodyFields,
  resolveEnableThinkingField,
  resolveEnableThinkingWirePath,
  resolveEnableThinkingWireTransform,
  supportsExtraBodyEnableThinking,
} from './extra-body-merge'

function schemaWith(fields: LlmSchemaField[]): LlmRequestSchema {
  return { requestShape: 'openai_chat_compatible', extraBodyFields: fields }
}

describe('resolveEnableThinkingWirePath', () => {
  test('normalizes extra_body.enable_thinking wirePath to top-level enable_thinking', () => {
    expect(resolveEnableThinkingWirePath({
      key: 'enable_thinking',
      type: 'boolean',
      wirePath: 'extra_body.enable_thinking',
    })).toBe('enable_thinking')
  })

  test('keeps thinking.type wirePath as-is', () => {
    expect(resolveEnableThinkingWirePath({
      key: 'enableThinking',
      type: 'boolean',
      wirePath: 'thinking.type',
    })).toBe('thinking.type')
  })

  test('falls back to key when wirePath is blank, normalizing camelCase', () => {
    expect(resolveEnableThinkingWirePath({ key: 'enableThinking', type: 'boolean', wirePath: '  ' })).toBe('enable_thinking')
    expect(resolveEnableThinkingWirePath({ key: 'thinking.type', type: 'boolean' })).toBe('thinking.type')
    expect(resolveEnableThinkingWirePath({ key: 'extra_body.enable_thinking', type: 'boolean' })).toBe('enable_thinking')
  })

  test('defaults to enable_thinking for null/unknown fields', () => {
    expect(resolveEnableThinkingWirePath(null)).toBe('enable_thinking')
    expect(resolveEnableThinkingWirePath(undefined)).toBe('enable_thinking')
    expect(resolveEnableThinkingWirePath({ key: 'something_else', type: 'boolean' })).toBe('enable_thinking')
  })
})

describe('resolveEnableThinkingWireTransform', () => {
  test('trims declared transform and defaults to empty string', () => {
    expect(resolveEnableThinkingWireTransform({
      key: 'enable_thinking',
      type: 'boolean',
      wireTransform: ' boolean:enabled_disabled ',
    })).toBe('boolean:enabled_disabled')
    expect(resolveEnableThinkingWireTransform({ key: 'enable_thinking', type: 'boolean' })).toBe('')
    expect(resolveEnableThinkingWireTransform(null)).toBe('')
  })
})

describe('resolveEnableThinkingField / supportsExtraBodyEnableThinking', () => {
  test('detects field by feature=thinking', () => {
    const schema = schemaWith([{ key: 'custom_switch', type: 'boolean', feature: 'thinking' }])
    expect(resolveEnableThinkingField(schema)?.key).toBe('custom_switch')
    expect(supportsExtraBodyEnableThinking(schema)).toBe(true)
  })

  test('detects field by known key or wirePath', () => {
    expect(supportsExtraBodyEnableThinking(schemaWith([{ key: 'enableThinking', type: 'boolean' }]))).toBe(true)
    expect(supportsExtraBodyEnableThinking(schemaWith([
      { key: 'switch', type: 'boolean', wirePath: 'thinking.type' },
    ]))).toBe(true)
  })

  test('ignores non-boolean fields and unrelated keys', () => {
    expect(supportsExtraBodyEnableThinking(schemaWith([{ key: 'enable_thinking', type: 'string' }]))).toBe(false)
    expect(supportsExtraBodyEnableThinking(schemaWith([{ key: 'stream', type: 'boolean' }]))).toBe(false)
    expect(supportsExtraBodyEnableThinking(null)).toBe(false)
    expect(supportsExtraBodyEnableThinking({ requestShape: 'openai_chat_compatible' })).toBe(false)
  })
})

describe('mergeExtraBodyFields', () => {
  test('writes boolean value to normalized top-level path without mutating the input body', () => {
    const body = { model: 'qwen3-235b-a22b' }
    const out = mergeExtraBodyFields(
      body,
      { enableThinking: true },
      schemaWith([{ key: 'enable_thinking', type: 'boolean', wirePath: 'extra_body.enable_thinking' }]),
    )
    expect(out).toEqual({ model: 'qwen3-235b-a22b', enable_thinking: true })
    expect(body).toEqual({ model: 'qwen3-235b-a22b' })
  })

  test('applies boolean:enabled_disabled transform and creates nested objects', () => {
    const out = mergeExtraBodyFields(
      { model: 'doubao' },
      { enable_thinking: false },
      schemaWith([{
        key: 'enableThinking',
        type: 'boolean',
        feature: 'thinking',
        wirePath: 'thinking.type',
        wireTransform: 'boolean:enabled_disabled',
      }]),
    )
    expect(out).toEqual({ model: 'doubao', thinking: { type: 'disabled' } })
  })

  test('enabled transform value for true', () => {
    const out = mergeExtraBodyFields(
      {},
      { enableThinking: true },
      schemaWith([{
        key: 'enableThinking',
        type: 'boolean',
        wirePath: 'thinking.type',
        wireTransform: 'boolean:enabled_disabled',
      }]),
    )
    expect(out).toEqual({ thinking: { type: 'enabled' } })
  })

  test('returns body unchanged when parameter is absent or non-boolean', () => {
    const schema = schemaWith([{ key: 'enable_thinking', type: 'boolean' }])
    expect(mergeExtraBodyFields({ a: 1 }, {}, schema)).toEqual({ a: 1 })
    expect(mergeExtraBodyFields({ a: 1 }, { enableThinking: 'yes' }, schema)).toEqual({ a: 1 })
  })

  test('returns body unchanged when schema has no extraBodyFields', () => {
    expect(mergeExtraBodyFields({ a: 1 }, { enableThinking: true }, null)).toEqual({ a: 1 })
    expect(mergeExtraBodyFields({ a: 1 }, { enableThinking: true }, { requestShape: 'openai_chat_compatible' })).toEqual({ a: 1 })
  })

  test('skips unrelated extraBodyFields entries', () => {
    const out = mergeExtraBodyFields(
      {},
      { enableThinking: true },
      schemaWith([
        { key: 'stream', type: 'boolean' },
        { key: 'enable_thinking', type: 'boolean' },
      ]),
    )
    expect(out).toEqual({ enable_thinking: true })
    expect(out.stream).toBeUndefined()
  })

  test('snake_case enable_thinking parameter is also honored', () => {
    const out = mergeExtraBodyFields(
      {},
      { enable_thinking: true },
      schemaWith([{ key: 'enable_thinking', type: 'boolean' }]),
    )
    expect(out).toEqual({ enable_thinking: true })
  })
})
