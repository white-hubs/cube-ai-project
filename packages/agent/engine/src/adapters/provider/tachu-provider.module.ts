import { Module, type Container } from '@dangao/bun-server';
import {
  AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN,
  type LlmProviderPort,
} from '@cube-ai/contracts';
import { AGENTIC_PROVIDER_TOKEN } from '../tokens';
import { LlmProviderPortBridge } from './llm-provider-port-bridge';
import { NoopLLMProviderAdapter } from './noop-tachu-provider';

const providerKind = process.env['AGENTIC_ENGINE_PROVIDER'] ?? 'llm-core';

@Module({
  providers: [
    {
      provide: AGENTIC_PROVIDER_TOKEN,
      useFactory: (c: Container) => {
        if (providerKind === 'noop') {
          return new NoopLLMProviderAdapter();
        }
        const llm = c.resolve(AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN) as LlmProviderPort;
        return new LlmProviderPortBridge(llm);
      },
    },
  ],
  exports: [AGENTIC_PROVIDER_TOKEN],
})
export class TachuProviderModule {}
