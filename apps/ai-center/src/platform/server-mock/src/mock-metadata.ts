import "reflect-metadata";

/** 与 {@link MockInterceptor} 在 {@link InterceptorRegistry} 中注册的 metadataKey 一致 */
export const MOCK_METADATA_KEY = Symbol("@cube-ai/ai-center/platform/server-mock:mock-endpoint");

export interface MockEndpointMeta {
  /** 如 `api-keys.list`，用于 MockRegistry 与 CUBE_AI_MOCK_<GROUP> */
  key: string;
}

/**
 * 声明该方法支持通过 MockRegistry + 环境变量短路为 mock 实现（mock 本体在各服务的 `mock/handlers/*`）。
 */
export function MockableEndpoint(key: string): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const meta: MockEndpointMeta = { key };
    Reflect.defineMetadata(MOCK_METADATA_KEY, meta, target, propertyKey);
    return descriptor;
  };
}
