import 'reflect-metadata';
import { afterEach, describe, expect, test } from 'bun:test';
import { Controller, Global, Module, type Container, Test, type TestHttpClient } from '@dangao/bun-server';
import { AGENTIC_PLATFORM_LLM_CATALOG_TOKEN } from '@cube-ai/contracts/platform';
import { LlmCatalogHttpModule } from './llm-catalog-http.module';
import { LlmProvidersController } from './llm-providers.controller';
import {
  createEnvFallbackTenantResolver,
  LLM_HTTP_TENANT_RESOLVER_TOKEN,
} from './request-tenant';

// 复刻 apps/ai-center 的 applyDomainPrefixMounts()：装配前把消费面 base 改写成 /llm/providers。
Controller('/llm/providers')(LlmProvidersController as new (...args: never[]) => unknown);

/**
 * 复刻 apps/ai-center 的 AiCenterDomainHttpModule 装配形态：一个 @Global 模块
 * 在 import LlmCatalogHttpModule 的同时，也 provide + export 了
 * LLM_HTTP_TENANT_RESOLVER_TOKEN（带 container 参数的工厂，与真实形态一致）。
 */
@Global()
@Module({
  imports: [LlmCatalogHttpModule],
  providers: [
    {
      provide: LLM_HTTP_TENANT_RESOLVER_TOKEN,
      useFactory: (_c: Container) => createEnvFallbackTenantResolver(() => 58197260),
    },
  ],
  exports: [LLM_HTTP_TENANT_RESOLVER_TOKEN],
})
class FakeDomainModule {}

describe('LlmCatalogHttpModule 消费面装配', () => {
  let client: TestHttpClient | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  test('GET /llm/providers 能解析宿主 Global resolver 并返回列表（回归：this.resolve undefined → 500）', async () => {
    const seenTenants: number[] = [];
    const moduleRef = await Test.createTestingModule({
      imports: [FakeDomainModule],
      providers: [
        {
          provide: AGENTIC_PLATFORM_LLM_CATALOG_TOKEN,
          useValue: {
            listProviders: async (tenant: number) => {
              seenTenants.push(tenant);
              return [];
            },
          },
        },
      ],
    }).compile();

    client = await moduleRef.createHttpClient();
    const res = await client.get('/llm/providers');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    expect(seenTenants).toEqual([58197260]);
  });
});
