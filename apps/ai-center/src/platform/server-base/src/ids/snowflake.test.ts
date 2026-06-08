import { describe, expect, test, beforeEach } from 'bun:test'
import { _resetSnowflakeStateForTests, nextSnowflakeId } from './snowflake'

describe('nextSnowflakeId', () => {
  beforeEach(() => {
    _resetSnowflakeStateForTests()
  })

  test('returns decimal string only', () => {
    const id = nextSnowflakeId()
    expect(typeof id).toBe('string')
    expect(/^\d+$/.test(id)).toBe(true)
    expect(id.length).toBeGreaterThan(10)
  })

  test('monotonic within same process', () => {
    const a = nextSnowflakeId()
    const b = nextSnowflakeId()
    expect(BigInt(a) < BigInt(b)).toBe(true)
  })

  test('many ids are unique', () => {
    const set = new Set<string>()
    for (let i = 0; i < 5000; i++) {
      set.add(nextSnowflakeId())
    }
    expect(set.size).toBe(5000)
  })
})
