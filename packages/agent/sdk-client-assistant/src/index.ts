/**
 * `@cube-ai/agent-sdk-client-assistant` — application-domain SDK for chatbot UIs.
 *
 * Public surface:
 *   - types：AssistantMessage / ReasoningTree / AssistantSessionSummary 等
 *   - utils（纯函数）：reasoning reducer / content flatten / 错误归一化 / 会话分组 / ...
 *   - reasoning-store：ReasoningStore + memory / indexedDB
 *   - port：AssistantEnginePort + createAgenticEnginePort(client)
 *   - store：AssistantStore + createAssistantStore(opts)
 *   - errors：re-export from sdk-core（SessionBusyError / StartTurnFailedError / ...）
 *
 * Ref: ADR-0008.
 */
export * from './types';
export * from './utils';
export * from './reasoning-store';
export * from './port';
export * from './engine-port';
export * from './store';

// Re-export sdk-core error types for one-stop instanceof check in business code.
export {
  AgenticClientError,
  SessionBusyError,
  StartTurnFailedError,
  StreamDisconnectedError,
  StoreDisposedError,
} from '@cube-ai/agent-sdk-client';

export const SDK_ASSISTANT_VERSION = '0.0.1-alpha.0';
