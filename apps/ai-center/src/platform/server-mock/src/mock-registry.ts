import type { Context } from '@dangao/bun-server'

export type MockHandlerFn = (
  context: Context | undefined,
  args: unknown[],
) => unknown | Promise<unknown>

export interface MockRegistryEntry {
  defaultOn: boolean
  handler: MockHandlerFn
}

/**
 * 全进程单例：由各包 `mock/handlers/*.mock.ts` 注册，{@link MockInterceptor} 消费。
 */
export class MockRegistry {
  private static readonly instance = new MockRegistry()
  private readonly entries = new Map<string, MockRegistryEntry>()

  static getInstance(): MockRegistry {
    return MockRegistry.instance
  }

  define(key: string, defaultOn: boolean, handler: MockHandlerFn): void {
    this.entries.set(key, { defaultOn, handler })
  }

  get(key: string): MockRegistryEntry | undefined {
    return this.entries.get(key)
  }
}
