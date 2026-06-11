import 'reflect-metadata'
import { afterEach, describe, expect, test } from 'bun:test'
import type { Container, Context } from '@dangao/bun-server'
import { MockableEndpoint } from './mock-metadata'
import { MockRegistry } from './mock-registry'
import { MockInterceptor } from './mock.interceptor'

const KEY_ON = 'test-itc-on.endpoint'
const KEY_OFF = 'test-itc-off.endpoint'
const KEY_ENV = 'test-itc-env.endpoint'
const KEY_MISSING = 'test-itc-missing.endpoint'

class FakeController {
  @MockableEndpoint(KEY_ON)
  mockedOn(): string {
    return 'real'
  }

  @MockableEndpoint(KEY_OFF)
  mockedOff(): string {
    return 'real'
  }

  @MockableEndpoint(KEY_ENV)
  mockedViaEnv(): string {
    return 'real'
  }

  @MockableEndpoint(KEY_MISSING)
  noRegistryEntry(): string {
    return 'real'
  }

  plain(): string {
    return 'real'
  }
}

const container = {} as unknown as Container

function createOriginal(result: string) {
  const calls: unknown[][] = []
  const fn = (...args: unknown[]) => {
    calls.push(args)
    return result
  }
  return { fn, calls }
}

afterEach(() => {
  delete process.env.CUBE_AI_MOCK_TEST_ITC_ENV
})

describe('MockInterceptor', () => {
  test('calls original method when no @MockableEndpoint metadata', async () => {
    const interceptor = new MockInterceptor()
    const { fn, calls } = createOriginal('real')

    const result = await interceptor.execute(new FakeController(), 'plain', fn, [1, 2], container)

    expect(result).toBe('real')
    expect(calls).toEqual([[1, 2]])
  })

  test('calls original method when key has no registry entry', async () => {
    const interceptor = new MockInterceptor()
    const { fn, calls } = createOriginal('real')

    const result = await interceptor.execute(
      new FakeController(),
      'noRegistryEntry',
      fn,
      [],
      container,
    )

    expect(result).toBe('real')
    expect(calls.length).toBe(1)
  })

  test('calls original method when mock is registered but disabled', async () => {
    MockRegistry.getInstance().define(KEY_OFF, false, () => 'mocked')
    const interceptor = new MockInterceptor()
    const { fn, calls } = createOriginal('real')

    const result = await interceptor.execute(new FakeController(), 'mockedOff', fn, [], container)

    expect(result).toBe('real')
    expect(calls.length).toBe(1)
  })

  test('short-circuits to mock handler when defaultOn is true', async () => {
    let handlerArgs: unknown[] | undefined
    let handlerContext: Context | undefined
    MockRegistry.getInstance().define(KEY_ON, true, (context, args) => {
      handlerContext = context
      handlerArgs = args
      return 'mocked'
    })
    const interceptor = new MockInterceptor()
    const { fn, calls } = createOriginal('real')
    const fakeContext = { path: '/run/x' } as unknown as Context

    const result = await interceptor.execute(
      new FakeController(),
      'mockedOn',
      fn,
      ['arg-1', 2],
      container,
      fakeContext,
    )

    expect(result).toBe('mocked')
    expect(calls.length).toBe(0)
    expect(handlerContext).toBe(fakeContext)
    expect(handlerArgs).toEqual(['arg-1', 2])
  })

  test('env switch CUBE_AI_MOCK_<GROUP> enables a defaultOn=false mock', async () => {
    MockRegistry.getInstance().define(KEY_ENV, false, () => 'mocked-by-env')
    process.env.CUBE_AI_MOCK_TEST_ITC_ENV = '1'
    const interceptor = new MockInterceptor()
    const { fn, calls } = createOriginal('real')

    const result = await interceptor.execute(
      new FakeController(),
      'mockedViaEnv',
      fn,
      [],
      container,
    )

    expect(result).toBe('mocked-by-env')
    expect(calls.length).toBe(0)
  })

  test('awaits async mock handlers', async () => {
    const key = 'test-itc-on.async-endpoint'

    class AsyncController {
      @MockableEndpoint(key)
      target(): string {
        return 'real'
      }
    }

    MockRegistry.getInstance().define(key, true, async () => {
      await Promise.resolve()
      return { async: true }
    })
    const interceptor = new MockInterceptor()
    const { fn } = createOriginal('real')

    const result = await interceptor.execute(new AsyncController(), 'target', fn, [], container)

    expect(result).toEqual({ async: true })
  })
})
