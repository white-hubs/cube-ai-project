import 'reflect-metadata';

/** 与 MockInterceptor 在 InterceptorRegistry 中注册的 metadataKey 一致 */
export const MOCK_METADATA_KEY = Symbol('@cube-ai/server-mock:mock-endpoint');

export type MockHandlerFn = (...args: unknown[]) => unknown;
export type MockEndpointMeta = { key: string };
export type MockRegistryEntry = { key: string; handler: MockHandlerFn };

export function MockableEndpoint(key: string): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const meta: MockEndpointMeta = { key };
    Reflect.defineMetadata(MOCK_METADATA_KEY, meta, target, propertyKey);
    return descriptor;
  };
}

export function isMockEnabled(): boolean {
  return false;
}

export class MockRegistry {
  private static instance: MockRegistry | undefined;

  static getInstance(): MockRegistry {
    if (!MockRegistry.instance) {
      MockRegistry.instance = new MockRegistry();
    }
    return MockRegistry.instance;
  }

  define(_key: string, _enabled: boolean, _handler: MockHandlerFn): void {}

  static register(_key: string, _handler: MockHandlerFn): void {}

  static resolve(_key: string): MockRegistryEntry | undefined {
    return undefined;
  }
}

export class MockInterceptor {}

export function registerMockInterceptor(_app: unknown): void {}

export const INTERCEPTOR_REGISTRY_TOKEN = Symbol('MockInterceptorRegistry');
