import { describe, expect, test } from 'bun:test'
import { resolveWireSize } from './size-transform'

describe('resolveWireSize', () => {
  describe('seedream via aggregator_native', () => {
    const profile = { nativeFamily: 'seedream', channelProfile: 'aggregator_native' as const }

    test.each([
      ['1024x1024', '2K'],
      ['1024*1024', '2K'],
      ['1792x1024', '2K'],
      ['1024*1792', '2K'],
      ['2k', '2K'],
      ['4K', '4K'],
      ['1k', '1K'],
    ])('maps %s to %s', (input, expected) => {
      expect(resolveWireSize({ size: input }, profile)).toBe(expected)
    })

    test('passes through unknown sizes and defaults missing size to 2K', () => {
      expect(resolveWireSize({ size: '999x999' }, profile)).toBe('999x999')
      expect(resolveWireSize({}, profile)).toBe('2K')
    })
  })

  describe('seedream direct', () => {
    const profile = { nativeFamily: 'seedream', channelProfile: 'direct' as const }

    test.each([
      ['1024x1024', '2k'],
      ['2048*2048', '2k'],
      ['3072x3072', '3k'],
      ['4096x4096', '4k'],
      ['5120*5120', '5k'],
      ['2K', '2k'],
      ['5k', '5k'],
    ])('maps %s to %s', (input, expected) => {
      expect(resolveWireSize({ size: input }, profile)).toBe(expected)
    })

    test('lowercases unknown sizes and defaults missing size to 2k', () => {
      expect(resolveWireSize({ size: '999X999' }, profile)).toBe('999x999')
      expect(resolveWireSize({}, profile)).toBe('2k')
    })
  })

  describe('non-seedream profiles', () => {
    test('normalizes star separator to x', () => {
      expect(resolveWireSize({ size: '1024*1024' }, { nativeFamily: null, channelProfile: 'aggregator_unified' })).toBe('1024x1024')
      expect(resolveWireSize({ size: '512*768' }, { nativeFamily: 'gpt_image', channelProfile: 'direct' })).toBe('512x768')
    })

    test('trims whitespace and defaults empty size to 1024x1024', () => {
      expect(resolveWireSize({ size: ' 1792x1024 ' }, { nativeFamily: null, channelProfile: 'direct' })).toBe('1792x1024')
      expect(resolveWireSize({}, { nativeFamily: null, channelProfile: 'direct' })).toBe('1024x1024')
      expect(resolveWireSize({ size: '  ' }, { nativeFamily: null, channelProfile: 'direct' })).toBe('1024x1024')
    })

    test('seedream family on aggregator_unified uses passthrough path (no tier mapping)', () => {
      expect(resolveWireSize({ size: '1024x1024' }, { nativeFamily: 'seedream', channelProfile: 'aggregator_unified' })).toBe('1024x1024')
    })
  })
})
