import { Module } from '@dangao/bun-server';
import {
  AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN,
  AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN,
} from '@cube-ai/contracts/platform';
import { NoopFlowCatalogPort } from './noop-flow-catalog';
import { NoopFlowInvokerPort } from './noop-flow-invoker';

/** Flow ports remain noop until M4; knowledge wired separately in KbPlatformModule. */
@Module({
  providers: [
    { provide: AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN, useClass: NoopFlowInvokerPort },
    { provide: AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN, useClass: NoopFlowCatalogPort },
  ],
  exports: [AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN, AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN],
})
export class NoopFlowPlatformModule {}
