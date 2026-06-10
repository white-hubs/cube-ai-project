import { Module, type Container } from '@dangao/bun-server';
import {
  AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN,
  type LlmProviderPort,
} from '@cube-ai/contracts';
import { AGENTIC_PROVIDER_TOKEN } from '../tokens';
import { LlmProviderPortBridge } from './llm-provider-port-bridge';
import { NoopLLMProviderAdapter } from './noop-tachu-provider';
import { LoggerFactory } from '../../infra/observability/logger.factory';

// 与 llm-provider.module 保持一致：默认目录驱动，仅 'noop' 走空实现。
const providerKind = process.env['AGENTIC_ENGINE_PROVIDER'] ?? 'agentic-platform-llm-catalog';

@Module({
  providers: [
    {
      provide: AGENTIC_PROVIDER_TOKEN,
      useFactory: (c: Container) => {
        if (providerKind === 'noop') {
          return new NoopLLMProviderAdapter();
        }
        const llm = c.resolve(AGENTIC_PLATFORM_LLM_PROVIDER_TOKEN) as LlmProviderPort;
        let logger: ReturnType<LoggerFactory['getLogger']> | undefined;
        try {
          const loggerFactory = c.resolve(LoggerFactory) as LoggerFactory;
          logger = loggerFactory.getLogger('agentic.engine.provider.bridge');
        } catch {
          logger = undefined;
        }
        return new LlmProviderPortBridge(llm, logger);
      },
    },
  ],
  exports: [AGENTIC_PROVIDER_TOKEN],
})
export class TachuProviderModule {}
