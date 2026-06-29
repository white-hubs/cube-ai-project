import { BaseInterceptor, type Container, type Context } from "@dangao/bun-server";

import { MOCK_METADATA_KEY, type MockEndpointMeta } from "./mock-metadata";
import { MockRegistry } from "./mock-registry";
import { isMockEnabled } from "./mock.config";

/**
 * 在控制器方法执行前按 `@MockableEndpoint` + MockRegistry 决定是否短路为 mock。
 * 适配 @dangao/bun-server 2.x：`InterceptorChain` 传入的 `originalMethod` 为链上下一环（非裸业务方法）。
 */
export class MockInterceptor extends BaseInterceptor {
  async execute<T>(
    target: unknown,
    propertyKey: string | symbol,
    originalMethod: (...args: unknown[]) => T | Promise<T>,
    args: unknown[],
    container: Container,
    context?: Context,
  ): Promise<T> {
    void container;
    const meta = this.getMetadata<MockEndpointMeta>(target, propertyKey, MOCK_METADATA_KEY);
    if (!meta?.key) {
      return await Promise.resolve(originalMethod(...args));
    }

    const entry = MockRegistry.getInstance().get(meta.key);
    if (!entry) {
      return await Promise.resolve(originalMethod(...args));
    }

    if (!isMockEnabled(meta.key, entry.defaultOn)) {
      return await Promise.resolve(originalMethod(...args));
    }

    const out = await Promise.resolve(entry.handler(context, args));
    return out as T;
  }
}
