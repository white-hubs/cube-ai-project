import { ref, watch, toValue, type Ref, type MaybeRefOrGetter } from 'vue';
import type { AgenticClient } from '@cube-ai/agent-sdk-client';
import { AgenticClientError } from '@cube-ai/agent-sdk-client';
import type { Session } from '@cube-ai/contracts';

/**
 * Reactive accessor for a single session's **metadata** (title/status/...).
 *
 * 历史职责（消息流 + sendMessage + cancel）已移交至 `composables/assistant/*`：
 *   - 消息流：`useAssistantMessages` + `useAssistantReasoning`
 *   - 发消息：`AssistantInstance.send`（通过 `provideAssistant` 注入）
 *   - 取消：  `AssistantInstance.cancel`
 *
 * 本 composable 仅为业务侧"想要单独看某 session 元数据"的小场景留口子；
 * 大多数业务应直接用 `useAssistantSessions`。
 *
 * Ref: ADR-0008 §D6.
 */
export function useSession(
  sessionId: MaybeRefOrGetter<string | null>,
  client: AgenticClient,
): {
  session: Ref<Session | null>;
  loading: Ref<boolean>;
  error: Ref<AgenticClientError | null>;
  refetch: () => Promise<void>;
} {
  const session = ref<Session | null>(null);
  const loading = ref(false);
  const error = ref<AgenticClientError | null>(null);

  const refetch = async (): Promise<void> => {
    const id = toValue(sessionId);
    if (!id) {
      session.value = null;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      session.value = await client.sessions.get(id);
    } catch (e) {
      error.value =
        e instanceof AgenticClientError
          ? e
          : new AgenticClientError(null, null, String(e), null, null, Date.now());
    } finally {
      loading.value = false;
    }
  };

  watch(
    () => toValue(sessionId),
    () => {
      void refetch();
    },
    { immediate: true },
  );

  return {
    session: session as Ref<Session | null>,
    loading,
    error,
    refetch,
  };
}
