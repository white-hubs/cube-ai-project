import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { isMockEnabled } from './mock.config'

const ENV_KEYS = ['CUBE_AI_MOCK', 'CUBE_AI_MOCK_API_KEYS', 'CUBE_AI_MOCK_FLOWS'] as const

let snapshot: Record<string, string | undefined> = {}

beforeEach(() => {
  snapshot = {}
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = snapshot[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('isMockEnabled', () => {
  test('falls back to defaultOn when no env is set', () => {
    expect(isMockEnabled('api-keys.list', true)).toBe(true)
    expect(isMockEnabled('api-keys.list', false)).toBe(false)
  })

  test('global CUBE_AI_MOCK overrides defaultOn', () => {
    process.env.CUBE_AI_MOCK = '1'
    expect(isMockEnabled('api-keys.list', false)).toBe(true)

    process.env.CUBE_AI_MOCK = '0'
    expect(isMockEnabled('api-keys.list', true)).toBe(false)
  })

  test('group env CUBE_AI_MOCK_<GROUP> takes precedence over global', () => {
    process.env.CUBE_AI_MOCK = '1'
    process.env.CUBE_AI_MOCK_API_KEYS = '0'
    expect(isMockEnabled('api-keys.list', true)).toBe(false)

    process.env.CUBE_AI_MOCK = '0'
    process.env.CUBE_AI_MOCK_API_KEYS = 'true'
    expect(isMockEnabled('api-keys.list', false)).toBe(true)
  })

  test('derives group from first key segment with dashes mapped to underscores', () => {
    process.env.CUBE_AI_MOCK_API_KEYS = '1'
    expect(isMockEnabled('api-keys.list', false)).toBe(true)
    // 其他 group 不受影响
    expect(isMockEnabled('flows.run', false)).toBe(false)
  })

  test('accepts 1/true/yes (case-insensitive, trimmed) as truthy', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', ' Yes ', ' 1 ']) {
      process.env.CUBE_AI_MOCK_FLOWS = value
      expect(isMockEnabled('flows.run', false)).toBe(true)
    }
  })

  test('treats other defined values as falsy (including empty string)', () => {
    for (const value of ['0', 'false', 'no', 'off', '']) {
      process.env.CUBE_AI_MOCK_FLOWS = value
      expect(isMockEnabled('flows.run', true)).toBe(false)
    }
  })
})
