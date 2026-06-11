import { describe, expect, test } from 'bun:test'
import { MockRegistry } from './mock-registry'

// MockRegistry 是进程级单例：用例统一使用 test-registry.* 前缀的独立 key，避免污染。
const uniqueKey = (suffix: string) => `test-registry.${suffix}-${Date.now()}`

describe('MockRegistry', () => {
  test('getInstance always returns the same singleton', () => {
    expect(MockRegistry.getInstance()).toBe(MockRegistry.getInstance())
  })

  test('returns undefined for unknown keys', () => {
    expect(MockRegistry.getInstance().get(uniqueKey('unknown'))).toBeUndefined()
  })

  test('define then get returns the registered entry', async () => {
    const registry = MockRegistry.getInstance()
    const key = uniqueKey('define')
    const handler = () => ({ mocked: true })

    registry.define(key, true, handler)

    const entry = registry.get(key)
    expect(entry?.defaultOn).toBe(true)
    expect(entry?.handler).toBe(handler)
    expect(await entry?.handler(undefined, [])).toEqual({ mocked: true })
  })

  test('redefining a key overrides the previous entry', () => {
    const registry = MockRegistry.getInstance()
    const key = uniqueKey('override')

    registry.define(key, true, () => 'first')
    registry.define(key, false, () => 'second')

    const entry = registry.get(key)
    expect(entry?.defaultOn).toBe(false)
    expect(entry?.handler(undefined, [])).toBe('second')
  })

  test('handler receives context and args from the interceptor', async () => {
    const registry = MockRegistry.getInstance()
    const key = uniqueKey('args')
    registry.define(key, true, (context, args) => ({ context, args }))

    const fakeContext = { path: '/api-keys' }
    const result = (await registry.get(key)?.handler(fakeContext as never, ['a', 1])) as {
      context: unknown
      args: unknown[]
    }

    expect(result.context).toBe(fakeContext)
    expect(result.args).toEqual(['a', 1])
  })
})
