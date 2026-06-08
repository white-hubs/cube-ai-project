import { Module } from '@dangao/bun-server';
import {
  AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN,
  AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN,
  AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN,
} from '@cube-ai/contracts/platform';
import { NoopFlowCatalogPort } from './noop-flow-catalog';
import { NoopFlowInvokerPort } from './noop-flow-invoker';
import { NoopKnowledgeQueryPort } from './noop-knowledge-query';

@Module({
  providers: [
    { provide: AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN, useClass: NoopFlowInvokerPort },
    { provide: AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN, useClass: NoopFlowCatalogPort },
    { provide: AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN, useClass: NoopKnowledgeQueryPort },
  ],
  exports: [
    AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN,
    AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN,
    AGENTIC_PLATFORM_KNOWLEDGE_QUERY_TOKEN,
  ],
})
export class NoopPlatformPortsModule {}
