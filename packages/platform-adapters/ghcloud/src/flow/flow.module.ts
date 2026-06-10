import { Module } from '@dangao/bun-server';
import {
  AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN,
  AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN,
} from '../tokens';
import { GhcloudFlowCatalogAdapter } from './flow-catalog.adapter';
import { GhcloudFlowInvokerAdapter } from './flow.adapter';

function sharedOpts(): {
  baseUrl: string;
  serviceToken: string;
  timeoutMs: number;
} {
  const baseUrl = process.env['AGENTIC_ENGINE_PLATFORM_API_BASE_URL'] ?? 'http://localhost:3100';
  const serviceToken = process.env['AGENTIC_ENGINE_PLATFORM_SERVICE_TOKEN'] ?? '';
  const timeoutMs = Number(process.env['AGENTIC_ENGINE_PLATFORM_FLOW_TIMEOUT_MS'] ?? '60000');
  return { baseUrl, serviceToken, timeoutMs };
}

function createInvokerAdapter(): GhcloudFlowInvokerAdapter {
  const { baseUrl, serviceToken, timeoutMs } = sharedOpts();
  return new GhcloudFlowInvokerAdapter({
    baseUrl,
    tokenProvider: async () => serviceToken,
    timeoutMs,
  });
}

function createCatalogAdapter(): GhcloudFlowCatalogAdapter {
  const { baseUrl, serviceToken, timeoutMs } = sharedOpts();
  return new GhcloudFlowCatalogAdapter({
    baseUrl,
    tokenProvider: async () => serviceToken,
    timeoutMs,
  });
}

@Module({
  providers: [
    {
      provide: AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN,
      useValue: createInvokerAdapter(),
    },
    {
      provide: AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN,
      useValue: createCatalogAdapter(),
    },
  ],
  exports: [AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN, AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN],
})
export class GhcloudFlowInvokerModule {}
