import { INTERCEPTOR_REGISTRY_TOKEN, InterceptorRegistry, type Container } from '@dangao/bun-server'
import { MOCK_METADATA_KEY } from './mock-metadata'
import { MockInterceptor } from './mock.interceptor'

/** 在 `Application` 构造后、`listen` 前调用；各服务还需 `import '<pkg>/mock'` 注册具体 handler。 */
export function registerMockInterceptor(container: Container, priority = 5): void {
  const registry = container.resolve(INTERCEPTOR_REGISTRY_TOKEN) as InterceptorRegistry
  registry.register(MOCK_METADATA_KEY, new MockInterceptor(), priority)
}
