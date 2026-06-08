import { onMounted, ref, type Ref } from 'vue';
import { AgenticClientError as AgenticError } from '@cube-ai/agent-sdk-client';
import { useAgenticClient } from './use-agentic-client';

export interface UseHealthState {
  loading: Ref<boolean>;
  status: Ref<'UP' | 'DOWN' | 'UNKNOWN'>;
  timestamp: Ref<number | null>;
  error: Ref<AgenticError | Error | null>;
  refresh: () => Promise<void>;
}

/**
 * Minimal composable demonstrating SDK-core → Vue glue. The M1.C Phase 3
 * release adds `useSession`, `useTurnStream`, `useGrantAck`, `useJob`.
 */
export function useHealthLive(): UseHealthState {
  const client = useAgenticClient();
  const loading = ref(false);
  const status = ref<'UP' | 'DOWN' | 'UNKNOWN'>('UNKNOWN');
  const timestamp = ref<number | null>(null);
  const error = ref<AgenticError | Error | null>(null);

  async function refresh(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const body = await client.healthLive();
      status.value = (body.status as 'UP' | 'DOWN') ?? 'UNKNOWN';
      timestamp.value = body.timestamp;
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
      status.value = 'DOWN';
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => {
    void refresh();
  });

  return { loading, status, timestamp, error, refresh };
}
