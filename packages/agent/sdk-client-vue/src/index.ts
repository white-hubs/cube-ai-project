export * from './use-agentic-client';
export * from './use-health';
export * from './composables/use-session';
export * from './composables/use-grants';
export * from './composables/use-tools';

/** Assistant application-domain composables — ADR-0008 §D6 */
export * from './composables/assistant';

/** Re-export sdk-assistant 类型 / 工具，业务侧零额外 import 即可 instanceof + 使用工具函数。 */
export * from '@cube-ai/agent-sdk-client-assistant';

/**
 * Re-export sdk-core 客户端构造与类型：业务侧组装 `provideAssistant` 时只需 import
 * 一个 `@cube-ai/agent-sdk-client-vue`，不必同时依赖 `@cube-ai/agent-sdk-client`。
 *  ADR-0008 §D6。
 */
export {
  createAgenticClient,
  AgenticClient,
  type AgenticClientConfig,
  type AgenticClientOptions,
  type SseEvent,
} from '@cube-ai/agent-sdk-client';

export const SDK_VUE_VERSION = '0.0.1-alpha.2';
