import { Module } from '@dangao/bun-server';
import {
  AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN,
  AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN,
} from '@cube-ai/contracts/platform';
import { FlowModule } from '../flow.module';
import { FlowCatalogPortImpl, FlowInvokerPortImpl } from './flow-platform-ports';

@Module({
  imports: [FlowModule],
  providers: [
    FlowInvokerPortImpl,
    FlowCatalogPortImpl,
    {
      provide: AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN,
      useExisting: FlowInvokerPortImpl,
    },
    {
      provide: AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN,
      useExisting: FlowCatalogPortImpl,
    },
  ],
  exports: [
    AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN,
    AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN,
    FlowInvokerPortImpl,
    FlowCatalogPortImpl,
  ],
})
export class FlowPlatformPortsModule {}
